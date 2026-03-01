import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

const transport = isDev
  ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
  : undefined;

const root = pino(
  {
    level: process.env['LOG_LEVEL'] || 'info',
  },
  transport
);

export function createLogger(name: string): pino.Logger {
  return root.child({ module: name });
}

export default root;
