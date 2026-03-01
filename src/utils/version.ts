import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface VersionInfo {
  version: string;
  commit: string;
  buildDate: string;
}

let cached: VersionInfo | null = null;

export function getVersionInfo(): VersionInfo {
  if (cached) return cached;

  try {
    // version.json is in src/ at dev time, but at dist/ at runtime
    // Try multiple paths to handle both cases
    const paths = [
      join(dirname(fileURLToPath(import.meta.url)), '..', 'version.json'),  // dist/utils/ -> dist/version.json
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'version.json'),  // fallback to src/
    ];

    for (const p of paths) {
      try {
        const data = JSON.parse(readFileSync(p, 'utf-8'));
        cached = { version: data.version, commit: data.commit, buildDate: data.buildDate };
        return cached;
      } catch { /* try next */ }
    }
  } catch { /* fallback below */ }

  cached = { version: 'dev', commit: 'unknown', buildDate: 'unknown' };
  return cached;
}
