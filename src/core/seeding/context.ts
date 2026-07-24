import type {
  AppConfig,
  SeedState,
  TorrentRuntimeState,
  AnnounceEvent,
  ClientProfile,
  EmulatorState,
} from '../../config/types.js';
import type { BandwidthDispatcher } from '../bandwidth-dispatcher.js';
import type { Scheduler } from '../scheduler.js';
import type { ConnectionHandler } from '../connection-handler.js';
import type { ConnectionContext } from '../connection-handler.js';

/**
 * The slice of SeedManager internals shared with the seeding modules. Each
 * module operates on this instead of importing SeedManager, which keeps the
 * dependency one-way and lets the modules be exercised with plain fakes.
 */
export interface SeedContext {
  config: AppConfig;
  state: SeedState;
  profile: ClientProfile;
  bandwidth: BandwidthDispatcher;
  scheduler: Scheduler;
  connection: ConnectionHandler;
  torrents: Map<string, TorrentRuntimeState>;
  emulatorStates: Map<string, EmulatorState>;
  announceLocks: Map<string, Promise<void>>;
  activatedAt: Map<string, number>;
  running: boolean;

  announceForTorrent(infoHash: string, event: AnnounceEvent): Promise<void>;
  createConnectionContext(): ConnectionContext;
  runPortCheck(): Promise<void>;
  startRotationTimer(): void;
  rebalanceActiveTorrents(): void;
  emit(event: string, ...args: unknown[]): boolean;
}
