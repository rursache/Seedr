import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { createLogger } from './logger.js';

const logger = createLogger('port-mapper');

export type PortMappingState = 'disabled' | 'searching' | 'mapped' | 'limited' | 'failed';
export type PortMappingProtocol = 'UPnP' | 'NAT-PMP';

export interface PortMappingStatus {
  /**
   * `limited` means the router opened the port but reports a private address as
   * its own, so another router sits in front of it and has to forward it too.
   */
  state: PortMappingState;
  protocol: PortMappingProtocol | null;
  /** What was found, or why nothing could be opened. */
  detail: string | null;
}

export interface PortMapperOptions {
  /** Lifetime asked of the router; the mapping is renewed at half of it. */
  leaseSeconds?: number;
  /** How long a single router request may take. */
  requestTimeoutMs?: number;
  /** How long to listen for UPnP routers answering the search. */
  discoveryMs?: number;
  ssdpAddress?: string;
  ssdpPort?: number;
  natPmpPort?: number;
  /** Wait before each NAT-PMP attempt; its length is the number of attempts. */
  natPmpTimeoutsMs?: number[];
  /** Pause before searching again after a failure. */
  retryMs?: number;
  /** A mapping is renewed at half its lifetime, but never sooner than this. */
  minRenewMs?: number;
  gateways?: () => Promise<string[]>;
  localAddresses?: () => string[];
}

type ResolvedOptions = Required<PortMapperOptions>;

const DEFAULTS: ResolvedOptions = {
  leaseSeconds: 3600,
  requestTimeoutMs: 3000,
  discoveryMs: 2500,
  ssdpAddress: '239.255.255.250',
  ssdpPort: 1900,
  natPmpPort: 5351,
  natPmpTimeoutsMs: [250, 500, 1000],
  retryMs: 10 * 60 * 1000,
  minRenewMs: 60 * 1000,
  gateways: defaultGateways,
  localAddresses: localIPv4Addresses,
};

const RELEASE_TIMEOUT_MS = 3000;
const MAX_ROUTER_REPLY_BYTES = 256 * 1024;
const MAX_UPNP_CANDIDATES = 3;
const MAPPING_DESCRIPTION = 'Seedr';

const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
];
// Most specific first: v2 of WANIPConnection answers everything v1 does
const SERVICE_TYPES = [
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];

/** The router answered and said no, or is in a state where opening the port is pointless. */
class PortMappingError extends Error {}

class UpnpFault extends Error {
  constructor(readonly code: number | null, description: string) {
    super(description);
  }
}

interface ActiveMapping {
  protocol: PortMappingProtocol;
  externalIp: string | null;
  /** Lifetime granted by the router, 0 for a mapping that does not expire. */
  lifetimeSeconds: number;
  renew(): Promise<void>;
  release(): Promise<void>;
}

// ── Addresses ──

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
  );
}

function localIPv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function execText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 3000, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
  });
}

/** Default routes of a Linux /proc/net/route, as dotted gateway addresses. */
export function parseProcRoutes(table: string): string[] {
  const gateways: string[] = [];
  for (const line of table.split('\n').slice(1)) {
    const [, destination, gateway, flags] = line.trim().split(/\s+/);
    if (destination !== '00000000' || !gateway || !(parseInt(flags ?? '0', 16) & 2)) continue;
    // Little-endian hex: 0101A8C0 is 192.168.1.1
    gateways.push([6, 4, 2, 0].map((i) => parseInt(gateway.slice(i, i + 2), 16)).join('.'));
  }
  return gateways;
}

/** Default gateways of the machine, where a NAT-PMP router would be listening. */
export async function defaultGateways(): Promise<string[]> {
  try {
    if (process.platform === 'linux') return parseProcRoutes(await readFile('/proc/net/route', 'utf8'));
    if (process.platform === 'win32') {
      const out = await execText('route', ['print', '-4']);
      return [...out.matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/gm)].map((m) => m[1]!);
    }
    const out = await execText('netstat', ['-rn', '-f', 'inet']);
    return [...out.matchAll(/^default\s+(\d+\.\d+\.\d+\.\d+)/gm)].map((m) => m[1]!);
  } catch {
    return [];
  }
}

// ── NAT-PMP (RFC 6886) ──

const NAT_PMP_ERRORS: Record<number, string> = {
  1: 'unsupported version',
  2: 'not authorized or refused',
  3: 'network failure',
  4: 'out of resources',
  5: 'unsupported opcode',
};

/** One request/response round trip to the gateway, null if it never answers. */
function natPmpExchange(
  gateway: string,
  request: Buffer,
  replyLength: number,
  o: ResolvedOptions
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (reply: Buffer | null): void => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Already closed
      }
      resolve(reply);
    };

    socket.on('error', () => finish(null));
    socket.on('message', (msg, rinfo) => {
      if (rinfo.address !== gateway || rinfo.port !== o.natPmpPort) return;
      if (msg.length < replyLength || msg[0] !== 0 || msg[1] !== ((request[1] ?? 0) | 0x80)) return;
      finish(msg);
    });

    const send = (): void => {
      const wait = o.natPmpTimeoutsMs[attempt++];
      if (wait === undefined) return finish(null);
      socket.send(request, o.natPmpPort, gateway, (err) => {
        if (err) finish(null);
      });
      timer = setTimeout(send, wait);
    };
    socket.bind(0, send);
  });
}

function checkNatPmpReply(reply: Buffer, gateway: string): void {
  const code = reply.readUInt16BE(2);
  if (code !== 0) {
    throw new PortMappingError(
      `NAT-PMP router ${gateway} refused: ${NAT_PMP_ERRORS[code] ?? `error ${code}`}`
    );
  }
}

async function openNatPmp(
  gateway: string,
  port: number,
  lifetime: number,
  o: ResolvedOptions
): Promise<ActiveMapping | null> {
  const address = await natPmpExchange(gateway, Buffer.from([0, 0]), 12, o);
  if (!address) return null;
  checkNatPmpReply(address, gateway);
  const externalIp = Array.from(address.subarray(8, 12)).join('.');

  const map = async (seconds: number): Promise<{ externalPort: number; lifetime: number }> => {
    const request = Buffer.alloc(12);
    request[1] = 2; // map TCP
    request.writeUInt16BE(port, 4);
    // A lifetime of 0 with no suggested port deletes the mapping
    request.writeUInt16BE(seconds === 0 ? 0 : port, 6);
    request.writeUInt32BE(seconds, 8);
    const reply = await natPmpExchange(gateway, request, 16, o);
    if (!reply) throw new PortMappingError(`NAT-PMP router ${gateway} stopped answering`);
    checkNatPmpReply(reply, gateway);
    return { externalPort: reply.readUInt16BE(10), lifetime: reply.readUInt32BE(12) };
  };

  // Peers are told to connect to our port, so a router that picks another one is no use
  const wrongPort = async (granted: number): Promise<never> => {
    await map(0).catch(() => undefined);
    throw new PortMappingError(
      `NAT-PMP router ${gateway} offered port ${granted} instead of ${port}, which is already in use there`
    );
  };

  const first = await map(lifetime);
  if (first.externalPort !== port) await wrongPort(first.externalPort);

  return {
    protocol: 'NAT-PMP',
    externalIp,
    lifetimeSeconds: first.lifetime,
    renew: async () => {
      const again = await map(lifetime);
      if (again.externalPort !== port) await wrongPort(again.externalPort);
    },
    release: async () => {
      await map(0);
    },
  };
}

async function tryNatPmp(port: number, lifetime: number, o: ResolvedOptions): Promise<ActiveMapping | null> {
  for (const gateway of await o.gateways()) {
    const mapping = await openNatPmp(gateway, port, lifetime, o);
    if (mapping) return mapping;
  }
  return null;
}

// ── UPnP IGD ──

interface UpnpCandidate {
  location: URL;
  /** Address of the interface the router answered on: the one it should forward to. */
  localAddress: string;
}

interface UpnpControl {
  url: URL;
  serviceType: string;
}

function xmlTag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, 'i').exec(xml);
  return match ? match[1]!.replace(/&amp;/g, '&') : null;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Listens for IGD answers on every interface, since the router can be on any of them. */
async function discoverUpnpRouters(o: ResolvedOptions): Promise<UpnpCandidate[]> {
  const found = new Map<string, UpnpCandidate>();

  await Promise.all(
    o.localAddresses().map(
      (localAddress) =>
        new Promise<void>((resolve) => {
          const socket = dgram.createSocket('udp4');
          const timers: Array<ReturnType<typeof setTimeout>> = [];
          const done = (): void => {
            timers.forEach(clearTimeout);
            try {
              socket.close();
            } catch {
              // Already closed
            }
            resolve();
          };

          socket.on('error', done);
          socket.on('message', (msg, rinfo) => {
            const location = /^location:\s*(\S+)/im.exec(msg.toString('utf8'))?.[1];
            if (!location) return;
            let url: URL;
            try {
              url = new URL(location);
            } catch {
              return;
            }
            // The description is fetched from wherever the answer points, so it
            // has to point back at the device that sent it, on a local network.
            if (url.protocol !== 'http:' || url.hostname !== rinfo.address || !isPrivateIPv4(rinfo.address)) {
              return;
            }
            found.set(url.href, { location: url, localAddress });
          });

          socket.bind({ address: localAddress, port: 0 }, () => {
            try {
              socket.setMulticastInterface(localAddress);
            } catch {
              // Not needed when the search is addressed to a single host
            }
            const search = (): void => {
              for (const target of SEARCH_TARGETS) {
                const message = Buffer.from(
                  'M-SEARCH * HTTP/1.1\r\n' +
                    `HOST: ${o.ssdpAddress}:${o.ssdpPort}\r\n` +
                    'MAN: "ssdp:discover"\r\nMX: 2\r\n' +
                    `ST: ${target}\r\n\r\n`
                );
                socket.send(message, o.ssdpPort, o.ssdpAddress, () => undefined);
              }
            };
            search();
            // UDP gets lost, and routers are slow to answer the first search
            timers.push(setTimeout(search, 500));
            timers.push(setTimeout(done, o.discoveryMs));
          });
        })
    )
  );

  return [...found.values()];
}

async function fetchText(url: URL, init: RequestInit, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  return { ok: res.ok, status: res.status, text: (await res.text()).slice(0, MAX_ROUTER_REPLY_BYTES) };
}

async function describeUpnpRouter(location: URL, timeoutMs: number): Promise<UpnpControl | null> {
  const { ok, text } = await fetchText(location, {}, timeoutMs);
  if (!ok) return null;

  const urlBase = xmlTag(text, 'URLBase');
  let base = location;
  if (urlBase) {
    try {
      const parsed = new URL(urlBase);
      if (parsed.hostname === location.hostname) base = parsed;
    } catch {
      // Keep the location as the base
    }
  }

  const services = [...text.matchAll(/<service>([\s\S]*?)<\/service>/gi)].map((m) => ({
    type: xmlTag(m[1]!, 'serviceType'),
    control: xmlTag(m[1]!, 'controlURL'),
  }));
  for (const type of SERVICE_TYPES) {
    const service = services.find((s) => s.type === type && s.control);
    if (!service) continue;
    try {
      const url = new URL(service.control!, base);
      // Same host as the description: a router cannot send us elsewhere
      if (url.protocol === 'http:' && url.hostname === location.hostname) return { url, serviceType: type };
    } catch {
      // Try the next service
    }
  }
  return null;
}

async function soap(
  control: UpnpControl,
  action: string,
  args: Record<string, string | number>,
  timeoutMs: number
): Promise<string> {
  const body =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action} xmlns:u="${control.serviceType}">` +
    Object.entries(args)
      .map(([name, value]) => `<${name}>${escapeXml(String(value))}</${name}>`)
      .join('') +
    `</u:${action}></s:Body></s:Envelope>`;

  const { ok, text } = await fetchText(
    control.url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${control.serviceType}#${action}"`,
      },
      body,
    },
    timeoutMs
  );
  if (!ok) {
    const code = xmlTag(text, 'errorCode');
    throw new UpnpFault(code ? Number(code) : null, xmlTag(text, 'errorDescription') ?? 'request failed');
  }
  return text;
}

async function openUpnp(
  control: UpnpControl,
  localAddress: string,
  port: number,
  lifetime: number,
  o: ResolvedOptions
): Promise<ActiveMapping> {
  const host = control.url.hostname;
  const add = (seconds: number): Promise<string> =>
    soap(
      control,
      'AddPortMapping',
      {
        NewRemoteHost: '',
        NewExternalPort: port,
        NewProtocol: 'TCP',
        NewInternalPort: port,
        NewInternalClient: localAddress,
        NewEnabled: 1,
        NewPortMappingDescription: MAPPING_DESCRIPTION,
        NewLeaseDuration: seconds,
      },
      o.requestTimeoutMs
    );

  const explain = (err: unknown): PortMappingError => {
    if (err instanceof UpnpFault) {
      if (err.code === 718) {
        return new PortMappingError(`UPnP router ${host}: port ${port} is already forwarded to another device`);
      }
      return new PortMappingError(`UPnP router ${host} refused (${err.code ?? 'error'}: ${err.message})`);
    }
    return new PortMappingError(`UPnP router ${host} did not answer`);
  };

  let granted = lifetime;
  try {
    await add(granted);
  } catch (err) {
    // 725: the router only takes mappings that never expire
    if (err instanceof UpnpFault && err.code === 725) {
      granted = 0;
      await add(0).catch((e: unknown) => {
        throw explain(e);
      });
    } else {
      throw explain(err);
    }
  }

  let externalIp: string | null = null;
  try {
    externalIp = xmlTag(
      await soap(control, 'GetExternalIPAddress', {}, o.requestTimeoutMs),
      'NewExternalIPAddress'
    );
  } catch {
    // Only used to tell whether another router sits in front of this one
  }

  return {
    protocol: 'UPnP',
    externalIp: externalIp || null,
    lifetimeSeconds: granted,
    renew: async () => {
      await add(granted).catch((e: unknown) => {
        throw explain(e);
      });
    },
    release: async () => {
      await soap(
        control,
        'DeletePortMapping',
        { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' },
        o.requestTimeoutMs
      );
    },
  };
}

async function tryUpnp(port: number, lifetime: number, o: ResolvedOptions): Promise<ActiveMapping | null> {
  const candidates = await discoverUpnpRouters(o);
  if (candidates.length === 0) return null;

  let failure: PortMappingError | null = null;
  for (const candidate of candidates.slice(0, MAX_UPNP_CANDIDATES)) {
    try {
      const control = await describeUpnpRouter(candidate.location, o.requestTimeoutMs);
      if (!control) {
        failure ??= new PortMappingError(`UPnP device ${candidate.location.hostname} has no port mapping service`);
        continue;
      }
      return await openUpnp(control, candidate.localAddress, port, lifetime, o);
    } catch (err) {
      failure = err instanceof PortMappingError
        ? err
        : new PortMappingError(`UPnP router ${candidate.location.hostname} did not answer`);
    }
  }
  throw failure ?? new PortMappingError('UPnP routers answered but none could be used');
}

// ── Lifecycle ──

/**
 * Asks the router to forward the BitTorrent port, over NAT-PMP first and UPnP
 * if that finds nothing, and keeps the mapping alive until stopped. It never
 * throws: a network without such a router is the usual case, and ends as a
 * `failed` status for the UI to show.
 */
export class PortMapper {
  private readonly options: ResolvedOptions;
  private status: PortMappingStatus = { state: 'disabled', protocol: null, detail: null };
  private active: ActiveMapping | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private port = 0;
  // Bumped by every start and stop, so an attempt still in flight can tell it was overtaken
  private generation = 0;

  constructor(options: PortMapperOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  getStatus(): PortMappingStatus {
    return { ...this.status };
  }

  /** Resolves once the first attempt has finished, whichever way it went. */
  async start(port: number): Promise<PortMappingStatus> {
    // Everything up to the first await is synchronous, so a stop() right after
    // this call already finds the new generation to cancel
    const generation = ++this.generation;
    this.clearTimer();
    const previous = this.active;
    const previousPort = this.port;
    this.active = null;
    this.port = port;
    this.status = { state: 'searching', protocol: null, detail: null };

    if (previous) await this.release(previous, previousPort);
    if (generation !== this.generation) return this.getStatus();

    await this.establish(generation);
    return this.getStatus();
  }

  async stop(): Promise<void> {
    this.generation++;
    this.clearTimer();
    const mapping = this.active;
    this.active = null;
    this.status = { state: 'disabled', protocol: null, detail: null };
    if (mapping) await this.release(mapping, this.port);
  }

  private async release(mapping: ActiveMapping, port: number): Promise<void> {
    try {
      await Promise.race([
        mapping.release(),
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('timed out')), RELEASE_TIMEOUT_MS).unref();
        }),
      ]);
      logger.info({ port, protocol: mapping.protocol }, 'Port mapping removed');
    } catch (err) {
      // The lease runs out on its own, unless the router only does permanent ones
      logger.warn({ err, protocol: mapping.protocol }, 'Could not remove the port mapping');
    }
  }

  private async openMapping(): Promise<ActiveMapping | null> {
    const failures: string[] = [];
    const attempts = [
      () => tryNatPmp(this.port, this.options.leaseSeconds, this.options),
      () => tryUpnp(this.port, this.options.leaseSeconds, this.options),
    ];
    for (const attempt of attempts) {
      try {
        const mapping = await attempt();
        if (mapping) return mapping;
      } catch (err) {
        if (!(err instanceof PortMappingError)) throw err;
        failures.push(err.message);
      }
    }
    if (failures.length > 0) throw new PortMappingError(failures.join('; '));
    return null;
  }

  private async establish(generation: number): Promise<void> {
    const port = this.port;
    this.status = { state: 'searching', protocol: null, detail: null };

    let mapping: ActiveMapping | null = null;
    let failure = 'No router answered UPnP or NAT-PMP: they may be turned off on it, or it may sit behind another router';
    try {
      mapping = await this.openMapping();
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }

    // Stopped or restarted while searching: undo what was just opened
    if (generation !== this.generation) {
      if (mapping) await this.release(mapping, port);
      return;
    }

    if (!mapping) {
      this.active = null;
      this.status = { state: 'failed', protocol: null, detail: failure };
      logger.info({ port: this.port, reason: failure }, 'Could not open the port on the router');
      this.schedule(generation, this.options.retryMs, () => this.establish(generation));
      return;
    }

    this.active = mapping;
    const behindNat = mapping.externalIp !== null && isPrivateIPv4(mapping.externalIp);
    this.status = behindNat
      ? {
          state: 'limited',
          protocol: mapping.protocol,
          detail:
            `Port ${this.port} is open on the router, which reports the private address ${mapping.externalIp}: ` +
            'it sits behind another router that has to forward the port too',
        }
      : {
          state: 'mapped',
          protocol: mapping.protocol,
          detail: `Port ${this.port} forwarded by the router (${mapping.protocol})`,
        };
    logger.info(
      { port: this.port, protocol: mapping.protocol, routerAddress: mapping.externalIp, state: this.status.state },
      this.status.detail ?? 'Port mapped'
    );

    this.scheduleRenewal(generation, mapping);
  }

  private async renew(generation: number): Promise<void> {
    const mapping = this.active;
    if (!mapping) return;
    try {
      await mapping.renew();
    } catch (err) {
      if (generation !== this.generation) return;
      logger.warn({ err }, 'Could not renew the port mapping, searching again');
      this.active = null;
      await this.establish(generation);
      return;
    }
    if (generation !== this.generation) return;
    this.scheduleRenewal(generation, mapping);
  }

  private scheduleRenewal(generation: number, mapping: ActiveMapping): void {
    // A mapping that never expires has nothing to renew
    if (mapping.lifetimeSeconds <= 0) return;
    const delayMs = Math.max(this.options.minRenewMs, mapping.lifetimeSeconds * 500);
    this.schedule(generation, delayMs, () => this.renew(generation));
  }

  private schedule(generation: number, delayMs: number, task: () => Promise<void>): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation !== this.generation) return;
      task().catch((err) => logger.error({ err }, 'Port mapping task failed'));
    }, delayMs);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
