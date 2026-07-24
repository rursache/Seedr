import { readFileSync, existsSync } from 'node:fs';
import type { ClientProfile } from '../../config/types.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('client-emulator');

export function loadClientProfile(filePath: string): ClientProfile {
  if (!existsSync(filePath)) {
    throw new Error(`Client profile not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const profile = JSON.parse(raw) as ClientProfile;

  logger.info({ file: filePath }, 'Loaded client profile');
  return profile;
}
