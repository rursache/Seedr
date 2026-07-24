import type {
  KeyGenerator,
  PeerIdGenerator,
  AnnounceEvent,
  EmulatorState,
} from '../../config/types.js';

export function shouldRefreshKey(
  gen: KeyGenerator,
  state: EmulatorState,
  event: AnnounceEvent
): boolean {
  switch (gen.refreshOn) {
    case 'NEVER':
      return false;
    case 'ALWAYS':
      return true;
    case 'TIMED':
      return (
        gen.refreshEvery !== undefined &&
        state.announceCount > 0 &&
        state.announceCount % gen.refreshEvery === 0
      );
    case 'TORRENT_PERSISTENT':
      return false; // Generated once per torrent, never refreshed
    case 'TORRENT_VOLATILE':
      return false; // Generated once per torrent session
    case 'TIMED_OR_AFTER_STARTED_ANNOUNCE':
      if (event === 'started') return true;
      return (
        gen.refreshEvery !== undefined &&
        state.announceCount > 0 &&
        state.announceCount % gen.refreshEvery === 0
      );
    default:
      return false;
  }
}

export function shouldRefreshPeerId(
  gen: PeerIdGenerator,
  _state: EmulatorState,
  event: AnnounceEvent
): boolean {
  switch (gen.refreshOn) {
    case 'NEVER':
      return false;
    case 'ALWAYS':
      return true;
    case 'TORRENT_VOLATILE':
      return event === 'started';
    case 'TORRENT_PERSISTENT':
      return false;
    default:
      return false;
  }
}
