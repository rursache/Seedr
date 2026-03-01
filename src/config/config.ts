import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppConfig, SeedState } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('config');

const configSchema = z.object({
  client: z.string().min(1),
  port: z.number().int().min(0).max(65535).default(49152),
  minUploadRate: z.number().min(0).default(100),
  maxUploadRate: z.number().min(0).default(500),
  simultaneousSeed: z.number().int().min(-1).refine((v) => v !== 0, { message: 'Must be -1 (unlimited) or >= 1' }).default(-1),
  keepTorrentWithZeroLeechers: z.boolean().default(true),
  skipIfNoPeers: z.boolean().default(true),
  minLeechers: z.number().int().min(0).default(1),
  minSeeders: z.number().int().min(0).default(0),
  uploadRatioTarget: z.number().default(-1),
});

const stateSchema = z.object({
  torrents: z.record(
    z.object({
      infoHash: z.string(),
      uploaded: z.number(),
      downloaded: z.number(),
      lastAnnounce: z.number(),
      announceCount: z.number(),
    })
  ),
  lastSaved: z.number(),
});

export const DATA_DIR = resolve(process.env['DATA_DIR'] || 'data');
export const CLIENTS_DIR = resolve(process.env['CLIENTS_DIR'] || join(DATA_DIR, 'clients'));
export const TORRENTS_DIR = resolve(process.env['TORRENTS_DIR'] || join(DATA_DIR, 'torrents'));
const CONFIG_PATH = join(DATA_DIR, 'config.json');
const STATE_PATH = join(DATA_DIR, 'state.json');

// Project-level clients directory (ships with the repo)
const PROJECT_CLIENTS_DIR = resolve('clients');

function ensureDataDirs(): void {
  for (const dir of [DATA_DIR, CLIENTS_DIR, TORRENTS_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function copyClientsOnFirstRun(): void {
  if (!existsSync(PROJECT_CLIENTS_DIR)) return;

  const projectClients = readdirSync(PROJECT_CLIENTS_DIR).filter((f) => f.endsWith('.client'));
  const existingClients = existsSync(CLIENTS_DIR)
    ? readdirSync(CLIENTS_DIR).filter((f) => f.endsWith('.client'))
    : [];

  if (existingClients.length === 0 && projectClients.length > 0) {
    logger.info('First run detected — copying client profiles to data directory');
    for (const file of projectClients) {
      copyFileSync(join(PROJECT_CLIENTS_DIR, file), join(CLIENTS_DIR, file));
    }
  }
}

export function listClientFiles(): string[] {
  if (!existsSync(CLIENTS_DIR)) return [];
  return readdirSync(CLIENTS_DIR)
    .filter((f) => f.endsWith('.client'))
    .sort();
}

function pickDefaultClient(): string {
  const clients = listClientFiles();
  const qb = clients.find((c) => c.startsWith('qbittorrent'));
  return qb || clients[0] || 'qbittorrent-5.1.4.client';
}

function defaultConfig(): AppConfig {
  return {
    client: pickDefaultClient(),
    port: 49152,
    minUploadRate: 100,
    maxUploadRate: 500,
    simultaneousSeed: -1,
    keepTorrentWithZeroLeechers: true,
    skipIfNoPeers: true,
    minLeechers: 1,
    minSeeders: 0,
    uploadRatioTarget: -1,
  };
}

export function loadConfig(): AppConfig {
  ensureDataDirs();
  copyClientsOnFirstRun();

  if (!existsSync(CONFIG_PATH)) {
    const cfg = defaultConfig();
    saveConfig(cfg);
    logger.info('Created default config.json');
    return cfg;
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    const result = configSchema.safeParse(raw);

    if (!result.success) {
      logger.warn({ errors: result.error.issues }, 'Invalid config.json — using defaults');
      const cfg = defaultConfig();
      saveConfig(cfg);
      return cfg;
    }

    return result.data as AppConfig;
  } catch {
    logger.warn('Could not parse config.json — using defaults');
    const cfg = defaultConfig();
    saveConfig(cfg);
    return cfg;
  }
}

/**
 * Validate a partial config update. Returns the validated partial or throws.
 */
export function validateConfigUpdate(updates: unknown): Partial<AppConfig> {
  const partialSchema = configSchema.partial();
  const result = partialSchema.safeParse(updates);
  if (!result.success) {
    throw new Error(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
  }
  // Only allow known keys
  const allowed = new Set(Object.keys(configSchema.shape));
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result.data)) {
    if (allowed.has(key)) clean[key] = value;
  }
  return clean as Partial<AppConfig>;
}

export function saveConfig(config: AppConfig): void {
  ensureDataDirs();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function loadState(): SeedState {
  if (!existsSync(STATE_PATH)) {
    return { torrents: {}, lastSaved: Date.now() };
  }

  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    const result = stateSchema.safeParse(raw);
    if (result.success) {
      return result.data as SeedState;
    }
    logger.warn('Invalid state.json — starting fresh');
  } catch {
    logger.warn('Could not parse state.json — starting fresh');
  }

  return { torrents: {}, lastSaved: Date.now() };
}

export function saveState(state: SeedState): void {
  ensureDataDirs();
  state.lastSaved = Date.now();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}
