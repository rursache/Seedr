import { describe, it, expect, afterEach } from 'vitest';
import dgram from 'node:dgram';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PortMapper, parseProcRoutes } from '../src/utils/port-mapper.js';
import type { PortMapperOptions } from '../src/utils/port-mapper.js';

const PORT = 51413;

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

// ── Fake routers ──

interface FakeNatPmp {
  port: number;
  requests: Array<{ opcode: number; internalPort: number; externalPort: number; lifetime: number }>;
}

/** A NAT-PMP gateway on loopback. `result` and `assignExternalPort` shape its answers. */
async function fakeNatPmp(
  behaviour: { result?: number; assignExternalPort?: number; publicIp?: [number, number, number, number] } = {}
): Promise<FakeNatPmp> {
  const requests: FakeNatPmp['requests'] = [];
  const socket = dgram.createSocket('udp4');
  socket.on('message', (msg, rinfo) => {
    const opcode = msg[1]!;
    const result = behaviour.result ?? 0;
    if (opcode === 0) {
      const reply = Buffer.alloc(12);
      reply[1] = 128;
      reply.writeUInt16BE(result, 2);
      Buffer.from(behaviour.publicIp ?? [203, 0, 113, 7]).copy(reply, 8);
      socket.send(reply, rinfo.port, rinfo.address);
      return;
    }
    const request = {
      opcode,
      internalPort: msg.readUInt16BE(4),
      externalPort: msg.readUInt16BE(6),
      lifetime: msg.readUInt32BE(8),
    };
    requests.push(request);
    const reply = Buffer.alloc(16);
    reply[1] = 128 + opcode;
    reply.writeUInt16BE(result, 2);
    reply.writeUInt16BE(request.internalPort, 8);
    reply.writeUInt16BE(
      request.lifetime === 0 ? 0 : (behaviour.assignExternalPort ?? request.internalPort),
      10
    );
    reply.writeUInt32BE(request.lifetime, 12);
    socket.send(reply, rinfo.port, rinfo.address);
  });
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => socket.close(() => resolve())));
  return { port: socket.address().port, requests };
}

interface FakeIgd {
  ssdpPort: number;
  actions: Array<{ action: string; args: Record<string, string> }>;
}

/**
 * A UPnP Internet Gateway on loopback: an SSDP responder pointing at an HTTP
 * server that serves the description and takes SOAP calls.
 */
async function fakeIgd(
  behaviour: {
    externalIp?: string;
    addFault?: (call: number, lease: string) => number | null; // UPnP error code to answer with
    locationHost?: string; // what the SSDP answer claims the description lives at
    controlUrl?: string;
  } = {}
): Promise<FakeIgd> {
  const actions: FakeIgd['actions'] = [];
  let addCalls = 0;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/xml');
      res.end(
        '<?xml version="1.0"?><root><device><deviceList><device><deviceList><device><serviceList>' +
          '<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>' +
          `<controlURL>${behaviour.controlUrl ?? '/ctl/IPConn'}</controlURL></service>` +
          '</serviceList></device></deviceList></device></deviceList></device></root>'
      );
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const action = /#(\w+)"?$/.exec(String(req.headers['soapaction']))![1]!;
      const args: Record<string, string> = {};
      for (const m of body.matchAll(/<(New\w+)>([^<]*)<\/\1>/g)) args[m[1]!] = m[2]!;
      actions.push({ action, args });

      if (action === 'AddPortMapping') {
        const code = behaviour.addFault?.(++addCalls, args['NewLeaseDuration']!) ?? null;
        if (code !== null) {
          res.statusCode = 500;
          res.end(
            `<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode>` +
              '<errorDescription>fault</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>'
          );
          return;
        }
      }
      res.end(
        action === 'GetExternalIPAddress'
          ? `<s:Envelope><s:Body><u:Response><NewExternalIPAddress>${behaviour.externalIp ?? '203.0.113.7'}</NewExternalIPAddress></u:Response></s:Body></s:Envelope>`
          : '<s:Envelope><s:Body><u:Response/></s:Body></s:Envelope>'
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const httpPort = (server.address() as AddressInfo).port;

  const ssdp = dgram.createSocket('udp4');
  ssdp.on('message', (_msg, rinfo) => {
    const host = behaviour.locationHost ?? `127.0.0.1:${httpPort}`;
    ssdp.send(
      Buffer.from(`HTTP/1.1 200 OK\r\nLOCATION: http://${host}/rootDesc.xml\r\nST: upnp:rootdevice\r\n\r\n`),
      rinfo.port,
      rinfo.address
    );
  });
  await new Promise<void>((resolve) => ssdp.bind(0, '127.0.0.1', resolve));

  cleanups.push(async () => {
    await new Promise<void>((resolve) => ssdp.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { ssdpPort: ssdp.address().port, actions };
}

/** A port nobody listens on, for the protocol a test leaves out. */
async function unusedUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

async function mapper(
  routers: { natPmp?: FakeNatPmp; igd?: FakeIgd },
  extra: PortMapperOptions = {}
): Promise<PortMapper> {
  const instance = new PortMapper({
    gateways: async () => ['127.0.0.1'],
    localAddresses: () => ['127.0.0.1'],
    natPmpPort: routers.natPmp?.port ?? (await unusedUdpPort()),
    ssdpAddress: '127.0.0.1',
    ssdpPort: routers.igd?.ssdpPort ?? (await unusedUdpPort()),
    natPmpTimeoutsMs: [60, 60],
    discoveryMs: 400,
    requestTimeoutMs: 1000,
    ...extra,
  });
  cleanups.push(() => instance.stop());
  return instance;
}

describe('PortMapper over NAT-PMP', () => {
  it('maps the TCP port and reports the router as forwarding it', async () => {
    const natPmp = await fakeNatPmp();
    const status = await (await mapper({ natPmp })).start(PORT);

    expect(status).toMatchObject({ state: 'mapped', protocol: 'NAT-PMP' });
    expect(natPmp.requests).toEqual([{ opcode: 2, internalPort: PORT, externalPort: PORT, lifetime: 3600 }]);
  });

  it('deletes the mapping when stopped', async () => {
    const natPmp = await fakeNatPmp();
    const instance = await mapper({ natPmp });
    await instance.start(PORT);

    await instance.stop();

    expect(natPmp.requests.at(-1)).toMatchObject({ internalPort: PORT, externalPort: 0, lifetime: 0 });
    expect(instance.getStatus().state).toBe('disabled');
  });

  it('flags a router that sits behind another one', async () => {
    const natPmp = await fakeNatPmp({ publicIp: [192, 168, 1, 20] });
    const status = await (await mapper({ natPmp })).start(PORT);

    expect(status.state).toBe('limited');
    expect(status.detail).toContain('192.168.1.20');
  });

  it('fails when the router refuses', async () => {
    const natPmp = await fakeNatPmp({ result: 2 });
    const status = await (await mapper({ natPmp })).start(PORT);

    expect(status.state).toBe('failed');
    expect(status.detail).toContain('refused');
  });

  it('gives back a mapping on another port, which peers would not find', async () => {
    const natPmp = await fakeNatPmp({ assignExternalPort: 60000 });
    const status = await (await mapper({ natPmp })).start(PORT);

    expect(status.state).toBe('failed');
    expect(status.detail).toContain('60000');
    expect(natPmp.requests.at(-1)).toMatchObject({ lifetime: 0 });
  });

  it('renews the mapping before it expires', async () => {
    const natPmp = await fakeNatPmp();
    await (await mapper({ natPmp }, { leaseSeconds: 1, minRenewMs: 0 })).start(PORT);

    await expect
      .poll(() => natPmp.requests.filter((r) => r.lifetime > 0).length, { timeout: 3000 })
      .toBeGreaterThanOrEqual(2);
  });
});

describe('PortMapper over UPnP', () => {
  it('forwards the port to the interface the router answered on', async () => {
    const igd = await fakeIgd();
    const status = await (await mapper({ igd })).start(PORT);

    expect(status).toMatchObject({ state: 'mapped', protocol: 'UPnP' });
    const add = igd.actions.find((a) => a.action === 'AddPortMapping')!;
    expect(add.args).toMatchObject({
      NewExternalPort: String(PORT),
      NewInternalPort: String(PORT),
      NewProtocol: 'TCP',
      NewInternalClient: '127.0.0.1',
      NewEnabled: '1',
      NewLeaseDuration: '3600',
    });
  });

  it('removes the mapping when stopped', async () => {
    const igd = await fakeIgd();
    const instance = await mapper({ igd });
    await instance.start(PORT);

    await instance.stop();

    expect(igd.actions.at(-1)).toMatchObject({
      action: 'DeletePortMapping',
      args: { NewExternalPort: String(PORT), NewProtocol: 'TCP' },
    });
  });

  it('falls back to a permanent mapping when the router refuses leases', async () => {
    const igd = await fakeIgd({ addFault: (_call, lease) => (lease !== '0' ? 725 : null) });
    const status = await (await mapper({ igd })).start(PORT);

    expect(status.state).toBe('mapped');
    const leases = igd.actions.filter((a) => a.action === 'AddPortMapping').map((a) => a.args['NewLeaseDuration']);
    expect(leases).toEqual(['3600', '0']);
  });

  it('says so when the port is already forwarded to another device', async () => {
    const igd = await fakeIgd({ addFault: () => 718 });
    const status = await (await mapper({ igd })).start(PORT);

    expect(status.state).toBe('failed');
    expect(status.detail).toContain('already forwarded to another device');
  });

  it('flags a router that reports a private address', async () => {
    const igd = await fakeIgd({ externalIp: '10.20.30.40' });
    const status = await (await mapper({ igd })).start(PORT);

    expect(status.state).toBe('limited');
    expect(status.detail).toContain('10.20.30.40');
  });

  it('renews the mapping before it expires', async () => {
    const igd = await fakeIgd();
    await (await mapper({ igd }, { leaseSeconds: 1, minRenewMs: 0 })).start(PORT);

    await expect
      .poll(() => igd.actions.filter((a) => a.action === 'AddPortMapping').length, { timeout: 3000 })
      .toBeGreaterThanOrEqual(2);
  });

  it('ignores an answer that points the description at another host', async () => {
    const igd = await fakeIgd({ locationHost: '192.0.2.99:80' });
    const status = await (await mapper({ igd })).start(PORT);

    expect(status.state).toBe('failed');
    expect(igd.actions).toEqual([]);
  });

  it('will not send calls to a control URL on another host', async () => {
    const igd = await fakeIgd({ controlUrl: 'http://192.0.2.99/ctl' });
    const status = await (await mapper({ igd })).start(PORT);

    expect(status.state).toBe('failed');
    expect(igd.actions).toEqual([]);
  });
});

describe('PortMapper without a router', () => {
  it('ends as failed and does not throw', async () => {
    const status = await (await mapper({})).start(PORT);

    expect(status.state).toBe('failed');
    expect(status.protocol).toBeNull();
    expect(status.detail).toContain('No router answered');
  });

  it('prefers NAT-PMP when the router speaks both', async () => {
    const natPmp = await fakeNatPmp();
    const igd = await fakeIgd();
    const status = await (await mapper({ natPmp, igd })).start(PORT);

    expect(status.protocol).toBe('NAT-PMP');
    expect(igd.actions).toEqual([]);
  });

  it('releases a mapping that finished opening after it was stopped', async () => {
    const natPmp = await fakeNatPmp();
    const instance = await mapper({ natPmp });

    const starting = instance.start(PORT);
    await instance.stop();
    await starting;

    expect(instance.getStatus().state).toBe('disabled');
    const last = natPmp.requests.at(-1);
    expect(last === undefined || last.lifetime === 0).toBe(true);
  });
});

describe('parseProcRoutes', () => {
  it('reads the default gateway out of /proc/net/route', () => {
    const table = [
      'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
      'wlp5s0\t00000000\t011FA8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0',
      'wlp5s0\t001FA8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0',
      'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
    ].join('\n');

    expect(parseProcRoutes(table)).toEqual(['192.168.31.1']);
  });

  it('ignores routes without a gateway', () => {
    const table = 'Iface\tDestination\tGateway\tFlags\nlo\t00000000\t00000000\t0001\n';

    expect(parseProcRoutes(table)).toEqual([]);
  });
});
