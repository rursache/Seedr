import net from 'node:net';
import { randomInt } from 'node:crypto';
import { resolveExternalIpv4, resolveExternalIpv6 } from '../utils/ip-resolver.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('connection');

const PORT_MIN = 49152;
const PORT_MAX = 65534;
const IP_REFRESH_INTERVAL = 90 * 60 * 1000; // 90 minutes

const BT_PROTOCOL = Buffer.from('BitTorrent protocol');
const BT_HANDSHAKE_LEN = 68; // 1 + 19 + 8 + 20 + 20
const BT_RESERVED = Buffer.alloc(8); // 8 zero bytes

/** Lookup interface for responding to BT handshakes. */
export interface ConnectionContext {
  /** Returns the set of info_hash hex strings for active torrents. */
  getInfoHashes(): Set<string>;
  /** Returns the 20-byte peer ID buffer for a torrent, or null if unknown. */
  getPeerId(infoHash: string): Buffer | null;
}

/**
 * Manages the TCP listening port and external IP resolution.
 * Responds to incoming BT handshakes with a proper protocol reply.
 */
export class ConnectionHandler {
  private server: net.Server | null = null;
  private _port: number = 0;
  private _externalIp: string | null = null;
  private _externalIpv6: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private context: ConnectionContext | null = null;

  get port(): number {
    return this._port;
  }

  get externalIp(): string | null {
    return this._externalIp;
  }

  get externalIpv6(): string | null {
    return this._externalIpv6;
  }

  /**
   * Provide torrent context so incoming handshakes can be answered.
   */
  setContext(ctx: ConnectionContext): void {
    this.context = ctx;
  }

  /**
   * Handle an incoming TCP connection. Buffers data until a full 68-byte
   * BT handshake is received, validates it, and responds if the info_hash
   * matches one of our active torrents.
   */
  private handleConnection(socket: net.Socket): void {
    socket.on('error', () => {}); // Ignore connection errors (ECONNRESET, etc.)
    socket.setTimeout(5000);

    let buffer = Buffer.alloc(0);

    const cleanup = () => {
      socket.removeAllListeners('data');
      socket.removeAllListeners('timeout');
    };

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length < BT_HANDSHAKE_LEN) return; // Wait for full handshake

      cleanup();

      // Parse the handshake
      const pstrlen = buffer[0]!;
      const pstr = buffer.subarray(1, 1 + pstrlen);
      const infoHashBuf = buffer.subarray(28, 48);

      // Validate protocol string
      if (pstrlen !== 19 || !pstr.equals(BT_PROTOCOL)) {
        socket.end();
        return;
      }

      const infoHash = infoHashBuf.toString('hex');

      // Check if we have context and this info_hash is ours
      if (!this.context) {
        socket.end();
        return;
      }

      const activeHashes = this.context.getInfoHashes();
      if (!activeHashes.has(infoHash)) {
        socket.end();
        return;
      }

      const peerId = this.context.getPeerId(infoHash);
      if (!peerId) {
        socket.end();
        return;
      }

      // Build our handshake response
      const response = Buffer.alloc(BT_HANDSHAKE_LEN);
      response[0] = 19;
      BT_PROTOCOL.copy(response, 1);
      BT_RESERVED.copy(response, 20);
      infoHashBuf.copy(response, 28);
      peerId.copy(response, 48);

      socket.write(response, () => {
        // Small delay before closing — looks like a real client deciding not to serve
        setTimeout(() => socket.end(), 100);
      });
    });

    socket.once('timeout', () => {
      cleanup();
      socket.end();
    });

    socket.once('close', () => {
      cleanup();
    });
  }

  /**
   * Bind a TCP port. If configuredPort is 0, pick a random one in the ephemeral range.
   * Retries up to 3 times on collision when using random ports.
   */
  async start(configuredPort: number): Promise<void> {
    const maxAttempts = configuredPort === 0 ? 3 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const port = configuredPort === 0 ? randomInt(PORT_MIN, PORT_MAX + 1) : configuredPort;

      this.server = net.createServer((socket) => this.handleConnection(socket));

      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: Error) => reject(err);
          this.server!.on('error', onError);
          this.server!.listen(port, () => {
            // Replace one-time startup handler with persistent runtime handler
            this.server!.removeListener('error', onError);
            this.server!.on('error', (err) => {
              logger.error({ err }, 'TCP server error');
            });
            this._port = port;
            logger.info({ port }, 'TCP port bound');
            resolve();
          });
        });
        break; // Success
      } catch (err: any) {
        this.server = null;
        if (err?.code === 'EADDRINUSE' && attempt < maxAttempts - 1) {
          logger.warn({ port, attempt: attempt + 1 }, 'Port in use, retrying with different port');
          continue;
        }
        throw err;
      }
    }

    // Resolve external IPs
    await this.refreshIps();

    // Periodically refresh IPs
    this.refreshTimer = setInterval(() => this.refreshIps(), IP_REFRESH_INTERVAL);
  }

  private async refreshIps(): Promise<void> {
    const [ipv4, ipv6] = await Promise.all([
      resolveExternalIpv4(),
      resolveExternalIpv6(),
    ]);

    this._externalIp = ipv4;
    this._externalIpv6 = ipv6;

    // If IPv4 failed, retry sooner (5 min instead of 90 min)
    if (!ipv4 && this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = setInterval(() => this.refreshIps(), 5 * 60 * 1000);
      logger.warn('IPv4 resolution failed — retrying in 5 minutes');
    } else if (ipv4 && this.refreshTimer) {
      // Restore normal interval if we recovered
      clearInterval(this.refreshTimer);
      this.refreshTimer = setInterval(() => this.refreshIps(), IP_REFRESH_INTERVAL);
    }

    logger.info({ ipv4, ipv6 }, 'External IPs resolved');
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.context = null;
    logger.info('Connection handler stopped');
  }
}
