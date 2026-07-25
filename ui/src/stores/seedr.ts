import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useWebSocket } from '../composables/useWebSocket';
import * as api from '../services/api';
import type {
  AppConfig,
  PortCheckStatus,
  SeedrEvent,
  SeedrState,
  TorrentInfo,
  VersionInfo,
} from '../types';

export type { TorrentInfo, SeedrEvent } from '../types';

export type TorrentStatusFilter = 'seeding' | 'error' | 'waiting' | 'completed' | null;

const MAX_EVENTS = 500; // matches the server's cap

export const useSeedrStore = defineStore('seedr', () => {
  const config = ref<AppConfig | null>(null);
  const configLoaded = ref(false);
  const status = ref<SeedrState | null>(null);
  const torrents = ref<TorrentInfo[]>([]);
  const clients = ref<string[]>([]);
  const events = ref<SeedrEvent[]>([]);
  const actionPending = ref(false);
  /** Which status the torrent list is narrowed to, or null for everything. */
  const statusFilter = ref<TorrentStatusFilter>(null);
  const versionInfo = ref<VersionInfo | null>(null);

  const { socket, connected } = useWebSocket();

  async function clearEvents() {
    const previous = events.value;
    events.value = [];
    try {
      await api.deleteEvents();
    } catch {
      events.value = previous; // put them back if the server refused
    }
  }

  async function dismissEvent(id: number) {
    const previous = events.value;
    events.value = events.value.filter((e) => e.id !== id);
    try {
      await api.deleteEvent(id);
    } catch {
      events.value = previous;
    }
  }

  async function fetchEvents() {
    try {
      events.value = await api.getEvents();
    } catch (e) {
      console.error('Failed to fetch events:', e);
    }
  }

  async function checkPort() {
    try {
      await api.postPortCheck();
    } catch { /* state broadcast will update UI */ }
  }

  socket.on('state', (data: SeedrState) => {
    status.value = data;
    if (data.torrents) {
      torrents.value = data.torrents.map((t: any, i: number) => ({
        infoHash: t.seedState?.infoHash || t.meta?.infoHash || '',
        name: t.meta?.name || 'Unknown',
        fileName: (t.meta?.filePath || '').split('/').pop() || '',
        size: t.meta?.totalSize || 0,
        uploaded: t.seedState?.uploaded || 0,
        reportedUploaded: t.reportedUploaded || 0,
        seeders: t.seeders || 0,
        leechers: t.leechers || 0,
        active: t.active,
        seeding: t.seeding || false,
        completed: t.completed || false,
        lastFailureTransient: t.lastFailureTransient || false,
        tracker: t.currentTracker || '',
        uploadRate: t.uploadRate || 0,
        consecutiveFailures: t.consecutiveFailures || 0,
        addedIndex: i,
      }));
    }
    actionPending.value = false;
  });

  // Domain events drive behaviour only. The log is fed separately by
  // events:snapshot and event:new, so a reconnect cannot duplicate history.
  socket.on('started', () => { actionPending.value = false; });
  socket.on('stopped', () => { actionPending.value = false; });
  socket.on('torrent:added', () => fetchTorrents());
  socket.on('torrent:removed', () => fetchTorrents());

  socket.on('events:snapshot', (records: SeedrEvent[]) => {
    events.value = records;
  });

  socket.on('event:new', (record: SeedrEvent) => {
    events.value.unshift(record);
    if (events.value.length > MAX_EVENTS) events.value.pop();
  });

  // The backend broadcasts this after any config change, so a setting altered in
  // another tab or through the API applies here without a reload — which is what
  // makes the theme and colour style follow immediately everywhere.
  socket.on('config:updated', (cfg: AppConfig) => {
    config.value = cfg;
    configLoaded.value = true;
  });

  socket.on('disconnect', () => {
    status.value = null;
    torrents.value = [];
  });

  // REST API calls — see services/api.ts for the transport
  async function fetchConfig() {
    try {
      config.value = await api.getConfig();
      configLoaded.value = true;
    } catch (e) {
      console.error('Failed to fetch config:', e);
    }
  }

  async function updateConfig(updates: Partial<AppConfig>) {
    config.value = await api.putConfig(updates);
  }

  async function fetchVersion() {
    try {
      versionInfo.value = await api.getVersion();
    } catch (e) {
      console.error('Failed to fetch version:', e);
    }
  }

  async function fetchClients() {
    try {
      clients.value = await api.getClients();
    } catch (e) {
      console.error('Failed to fetch clients:', e);
    }
  }

  async function fetchStatus() {
    try {
      status.value = await api.getStatus();
    } catch (e) {
      console.error('Failed to fetch status:', e);
    }
  }

  async function fetchTorrents() {
    try {
      torrents.value = await api.getTorrents();
    } catch (e) {
      console.error('Failed to fetch torrents:', e);
    }
  }

  async function uploadTorrent(file: File): Promise<{ success?: boolean; error?: string }> {
    const result = await api.postTorrent(file);
    await fetchTorrents();
    return result;
  }

  async function forceAnnounce(infoHash: string) {
    try {
      await api.postAnnounce(infoHash);
    } catch {
      // Silently fail — result will show in events
    }
  }

  async function removeTorrent(infoHash: string) {
    torrents.value = torrents.value.filter((t) => t.infoHash !== infoHash);
    try {
      await api.deleteTorrent(infoHash);
    } catch {
      await fetchTorrents();
    }
  }

  async function startSeeding() {
    actionPending.value = true;
    try {
      await api.postStart();
    } catch {
      actionPending.value = false;
    }
  }

  async function stopSeeding() {
    actionPending.value = true;
    try {
      await api.postStop();
    } catch {
      actionPending.value = false;
    }
  }

  /** Clicking the active status again clears it, and picking another replaces it. */
  function toggleStatusFilter(status: Exclude<TorrentStatusFilter, null>) {
    statusFilter.value = statusFilter.value === status ? null : status;
  }

  function matchesStatus(t: TorrentInfo, status: Exclude<TorrentStatusFilter, null>): boolean {
    if (status === 'seeding') return t.seeding && isTorrentEligible(t);
    if (status === 'waiting') return t.seeding && !isTorrentEligible(t) && !t.completed;
    if (status === 'error') return t.consecutiveFailures > 0 && !t.seeding;
    return t.completed;
  }

  function isTorrentEligible(t: TorrentInfo): boolean {
    const cfg = config.value;
    if (!cfg) return true; // Config not loaded yet — assume eligible
    if (t.completed) return false;
    if (cfg.skipIfNoPeers && t.seeders + t.leechers === 0) return false;
    if (!cfg.keepTorrentWithZeroLeechers && t.leechers === 0) return false;
    if (t.leechers < cfg.minLeechers) return false;
    if (t.seeders < cfg.minSeeders) return false;
    return true;
  }

  const activeCount = computed(() =>
    torrents.value.filter((t) => t.active).length
  );

  const seedingCount = computed(() =>
    torrents.value.filter((t) => t.seeding && isTorrentEligible(t)).length
  );

  const waitingCount = computed(() =>
    torrents.value.filter((t) => t.seeding && !isTorrentEligible(t) && !t.completed).length
  );

  const errorCount = computed(() =>
    torrents.value.filter((t) => t.consecutiveFailures > 0 && !t.seeding).length
  );

  const completedCount = computed(() =>
    torrents.value.filter((t) => t.completed).length
  );

  const isSeeding = computed(() =>
    !!(status.value?.running && seedingCount.value > 0)
  );

  const portCheck = computed<PortCheckStatus>(() =>
    status.value?.portCheck || { checking: false, result: null, error: null }
  );

  return {
    config,
    configLoaded,
    status,
    torrents,
    clients,
    events,
    connected,
    statusFilter,
    toggleStatusFilter,
    matchesStatus,
    activeCount,
    seedingCount,
    waitingCount,
    errorCount,
    completedCount,
    isSeeding,
    isTorrentEligible,
    actionPending,
    portCheck,
    versionInfo,
    clearEvents,
    dismissEvent,
    fetchEvents,
    fetchConfig,
    updateConfig,
    fetchVersion,
    fetchClients,
    fetchStatus,
    fetchTorrents,
    uploadTorrent,
    forceAnnounce,
    removeTorrent,
    startSeeding,
    stopSeeding,
    checkPort,
  };
});
