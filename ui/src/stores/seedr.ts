import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useWebSocket } from '../composables/useWebSocket';

interface TorrentInfo {
  infoHash: string;
  name: string;
  size: number;
  uploaded: number;
  reportedUploaded: number;
  seeders: number;
  leechers: number;
  active: boolean;
  seeding: boolean;
  completed: boolean;
  tracker: string;
  uploadRate?: number;
  addedIndex: number; // insertion order from backend
}

interface AppConfig {
  client: string;
  port: number;
  minUploadRate: number;
  maxUploadRate: number;
  simultaneousSeed: number;
  keepTorrentWithZeroLeechers: boolean;
  skipIfNoPeers: boolean;
  minLeechers: number;
  uploadRatioTarget: number;
}

interface PortCheckStatus {
  checking: boolean;
  result: { reachable: boolean; nodes: Array<{ location: string; success: boolean; time?: number; error?: string }> } | null;
  error: string | null;
}

interface SeedrState {
  running: boolean;
  externalIp: string | null;
  externalIpv6: string | null;
  port: number;
  client: string;
  globalUploadRate: number;
  actualUploadRate: number;
  torrents: any[];
  uptime: number;
  portCheck: PortCheckStatus;
}

export interface SeedrEvent {
  id: number;
  type: string;
  data: any;
  time: number;
}

let nextEventId = 1;

export const useSeedrStore = defineStore('seedr', () => {
  const config = ref<AppConfig | null>(null);
  const configLoaded = ref(false);
  const status = ref<SeedrState | null>(null);
  const torrents = ref<TorrentInfo[]>([]);
  const clients = ref<string[]>([]);
  const events = ref<SeedrEvent[]>([]);
  const actionPending = ref(false);

  const { socket, connected } = useWebSocket();

  function addEvent(type: string, data: any) {
    events.value.unshift({ id: nextEventId++, type, data, time: Date.now() });
    if (events.value.length > 100) events.value.pop();
  }

  async function checkPort() {
    try {
      await fetch('/api/control/port-check', { method: 'POST' });
    } catch { /* state broadcast will update UI */ }
  }

  socket.on('state', (data: SeedrState) => {
    status.value = data;
    if (data.torrents) {
      torrents.value = data.torrents.map((t: any, i: number) => ({
        infoHash: t.seedState?.infoHash || t.meta?.infoHash?.toString('hex') || '',
        name: t.meta?.name || 'Unknown',
        size: t.meta?.totalSize || 0,
        uploaded: t.seedState?.uploaded || 0,
        reportedUploaded: t.reportedUploaded || 0,
        seeders: t.seeders || 0,
        leechers: t.leechers || 0,
        active: t.active,
        seeding: t.seeding || false,
        completed: t.completed || false,
        tracker: t.currentTracker || '',
        uploadRate: t.uploadRate || 0,
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

  // REST API calls
  async function fetchConfig() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      config.value = await res.json();
      configLoaded.value = true;
    } catch (e) {
      console.error('Failed to fetch config:', e);
    }
  }

  async function updateConfig(updates: Partial<AppConfig>) {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config.value = await res.json();
  }

  async function fetchClients() {
    try {
      const res = await fetch('/api/config/clients');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      clients.value = await res.json();
    } catch (e) {
      console.error('Failed to fetch clients:', e);
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch('/api/control/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status.value = await res.json();
    } catch (e) {
      console.error('Failed to fetch status:', e);
    }
  }

  async function fetchTorrents() {
    try {
      const res = await fetch('/api/torrents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      torrents.value = await res.json();
    } catch (e) {
      console.error('Failed to fetch torrents:', e);
    }
  }

  async function uploadTorrent(file: File): Promise<{ success?: boolean; error?: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/torrents', { method: 'POST', body: formData });
    const result = await res.json();
    await fetchTorrents();
    return result;
  }

  async function forceAnnounce(infoHash: string) {
    try {
      await fetch(`/api/torrents/${infoHash}/announce`, { method: 'POST' });
    } catch {
      // Silently fail — result will show in events
    }
  }

  async function removeTorrent(infoHash: string) {
    torrents.value = torrents.value.filter((t) => t.infoHash !== infoHash);
    try {
      const res = await fetch(`/api/torrents/${infoHash}`, { method: 'DELETE' });
      if (!res.ok) await fetchTorrents();
    } catch {
      await fetchTorrents();
    }
  }

  async function startSeeding() {
    actionPending.value = true;
    try {
      await fetch('/api/control/start', { method: 'POST' });
    } catch {
      actionPending.value = false;
    }
  }

  async function stopSeeding() {
    actionPending.value = true;
    try {
      await fetch('/api/control/stop', { method: 'POST' });
    } catch {
      actionPending.value = false;
    }
  }

  const activeCount = computed(() =>
    torrents.value.filter((t) => t.active).length
  );

  const seedingCount = computed(() =>
    torrents.value.filter((t) => t.seeding).length
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
    isSeeding,
    actionPending,
    portCheck,
    fetchConfig,
    updateConfig,
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
