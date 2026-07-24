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

let nextEventId = 1;

export const useSeedrStore = defineStore('seedr', () => {
  const config = ref<AppConfig | null>(null);
  const configLoaded = ref(false);
  const status = ref<SeedrState | null>(null);
  const torrents = ref<TorrentInfo[]>([]);
  const clients = ref<string[]>([]);
  const events = ref<SeedrEvent[]>([]);
  const actionPending = ref(false);
  const versionInfo = ref<VersionInfo | null>(null);

  const { socket, connected } = useWebSocket();

  function addEvent(type: string, data: any) {
    events.value.unshift({ id: nextEventId++, type, data, time: Date.now() });
    if (events.value.length > 100) events.value.pop();
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
        infoHash: t.seedState?.infoHash || t.meta?.infoHash?.toString('hex') || '',
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

  socket.on('started', () => {
    addEvent('started', {});
    actionPending.value = false;
  });

  socket.on('announce:success', (data: any) => addEvent('announce:success', data));
  socket.on('announce:failure', (data: any) => addEvent('announce:failure', data));
  socket.on('torrent:added', (data: any) => {
    addEvent('torrent:added', data);
    fetchTorrents(); // Refresh torrent list when a new torrent is detected
  });
  socket.on('torrent:removed', (data: any) => {
    addEvent('torrent:removed', data);
    fetchTorrents(); // Refresh torrent list when a torrent is removed
  });
  socket.on('torrent:completed', (data: any) => addEvent('torrent:completed', data));

  socket.on('stopped', () => {
    addEvent('stopped', {});
    actionPending.value = false;
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
