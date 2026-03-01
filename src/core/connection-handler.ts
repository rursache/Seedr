import net from 'node:net';
import { randomInt } from 'node:crypto';
import { resolveExternalIpv4, resolveExternalIpv6 } from '../utils/ip-resolver.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('connection');

const PORT_MIN = 49152;
const PORT_MAX = 65534;
const IP_REFRESH_INTERVAL = 90 * 60 * 1000; // 90 minutes

/**
 * Manages the TCP listening port and external IP resolution.
 */
export class ConnectionHandler {
  private server: net.Server | null = null;
  private _port: number = 0;
  private _externalIp: string | null = null;
  private _externalIpv6: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

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
   * Bind a TCP port. If configuredPort is 0, pick a random one in the ephemeral range.
   * Retries up to 3 times on collision when using random ports.
   */
  async start(configuredPort: number): Promise<void> {
    const maxAttempts = configuredPort === 0 ? 3 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const port = configuredPort === 0 ? randomInt(PORT_MIN, PORT_MAX + 1) : configuredPort;

      this.server = net.createServer((socket) => {
        // Accept and immediately close — we're not actually serving data
        socket.end();
      });

      try {
        await new Promise<void>((resolve, reject) => {
          this.server!.on('error', reject);
          this.server!.listen(port, () => {
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

    logger.info('Connection handler stopped');
  }
}
