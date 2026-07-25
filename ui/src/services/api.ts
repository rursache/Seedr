import type { AppConfig, SeedrEvent, SeedrState, TorrentInfo, VersionInfo } from '../types';

/** Every call throws on a non-2xx response; callers decide how to react. */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function send(url: string, method: string): Promise<void> {
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export const getConfig = () => getJson<AppConfig>('/api/config');

export async function putConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const getClients = () => getJson<string[]>('/api/config/clients');
export const getStatus = () => getJson<SeedrState>('/api/control/status');
export const getTorrents = () => getJson<TorrentInfo[]>('/api/torrents');
export const getVersion = () => getJson<VersionInfo>('/api/version');

export async function postTorrent(file: File): Promise<{ success?: boolean; error?: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/torrents', { method: 'POST', body: formData });
  return res.json();
}

export const postAnnounce = (infoHash: string) =>
  send(`/api/torrents/${infoHash}/announce`, 'POST');
export const deleteTorrent = (infoHash: string) => send(`/api/torrents/${infoHash}`, 'DELETE');
export const getEvents = () => getJson<SeedrEvent[]>('/api/events');
export const deleteEvents = () => send('/api/events', 'DELETE');
export const deleteEvent = (id: number) => send(`/api/events/${id}`, 'DELETE');

export const postStart = () => send('/api/control/start', 'POST');
export const postStop = () => send('/api/control/stop', 'POST');
export const postPortCheck = () => send('/api/control/port-check', 'POST');
