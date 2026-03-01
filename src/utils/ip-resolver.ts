import { createLogger } from './logger.js';

const logger = createLogger('ip-resolver');

const IPV4_PROVIDERS = [
  'https://api.ipify.org',
  'https://ifconfig.me/ip',
  'https://icanhazip.com',
  'https://checkip.amazonaws.com',
];

const IPV6_PROVIDERS = [
  'https://api6.ipify.org',
  'https://v6.ident.me',
];

async function fetchIp(url: string, timeout = 5000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function resolveExternalIpv4(): Promise<string | null> {
  for (const provider of IPV4_PROVIDERS) {
    const ip = await fetchIp(provider);
    if (ip) {
      logger.debug({ ip, provider }, 'Resolved external IPv4');
      return ip;
    }
  }
  logger.warn('Could not resolve external IPv4 address');
  return null;
}

export async function resolveExternalIpv6(): Promise<string | null> {
  for (const provider of IPV6_PROVIDERS) {
    const ip = await fetchIp(provider);
    if (ip && ip.includes(':')) {
      logger.debug({ ip, provider }, 'Resolved external IPv6');
      return ip;
    }
  }
  logger.debug('No IPv6 address available');
  return null;
}
