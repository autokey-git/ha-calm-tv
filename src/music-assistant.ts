import { demoMode, settings } from './config';

// An optional direct line to the Music Assistant server, only for what Home Assistant can't pass
// along: the whole queue (HA's music_assistant.get_queue gives what's playing and what's next).
// Set up on each TV in Settings → Home Assistant → Music Assistant: the server's address and a
// long-lived token made in Music Assistant (Settings → Profile). Both stay on this TV, never in
// calm-tv.json, which anyone on the network can read. Everything else keeps going through HA.

const URL_KEY = 'calmtv.maUrl';
const TOKEN_KEY = 'calmtv.maToken';

/** One queue entry, as Music Assistant sends it (only the parts used here). */
export interface MaQueueItem {
  queue_item_id: string;
  name: string;
  duration?: number | null;
  index?: number;
  image?: MaImage | null;
  media_item?: {
    name?: string;
    artists?: { name?: string }[];
    album?: { name?: string } | null;
    image?: MaImage | string | null;
    metadata?: { images?: MaImage[] | null } | null;
  } | null;
  /** Demo mode only: a ready picture. */
  demoArt?: string;
}

export interface MaImage {
  type?: string;
  path: string;
  provider?: string;
  remotely_accessible?: boolean;
}

export interface MaQueue {
  queue_id: string;
  display_name?: string;
  items?: number;
  current_index?: number | null;
  shuffle_enabled?: boolean;
  current_item?: { queue_item_id?: string } | null;
}

const read = (key: string): string => {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
};

/** The saved server address and token ("" when not set up). */
export const maSettings = () => ({ url: read(URL_KEY), token: read(TOKEN_KEY) });

/** True when this TV has Music Assistant set up (or in demo mode, which has a made-up queue). */
export const maConfigured = () => demoMode || (!!maSettings().url && !!maSettings().token);

/** Cleans up an address the way it's typed on a remote: "192.168.1.20" → "http://192.168.1.20:8095". */
export function cleanMaUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');

  if (!s) return '';

  if (!s.includes('://')) s = `http://${s}`;

  try {
    const u = new URL(s);

    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';

    if (!u.port && u.protocol === 'http:') u.port = '8095';

    return u.origin;
  } catch {
    return '';
  }
}

/** A first guess for the address: Music Assistant's usual port on Home Assistant's machine. */
export function guessMaUrl(): string {
  try {
    return settings.haUrl ? `http://${new URL(settings.haUrl).hostname}:8095` : '';
  } catch {
    return '';
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; partial: unknown[] | null; timer: number };

class MusicAssistant {
  private ws: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  /** The last connection problem, for Settings ("" when fine or not tried). */
  problem = '';
  /** Connected and signed in. */
  connected = false;
  /** Demo mode's made-up server (set by demo.ts). */
  demo: ((command: string, args: Record<string, unknown>) => unknown) | null = null;

  /** Saves the address and token, then checks them. Resolves to "" when it works, or what went wrong. */
  async save(rawUrl: string, token: string): Promise<string> {
    const url = cleanMaUrl(rawUrl);

    if (!rawUrl.trim()) {
      this.forget();

      return '';
    }

    if (!url) return 'That doesn’t look like an address. Example: http://192.168.1.20:8095';

    if (!token.trim()) return 'Paste a long-lived token from Music Assistant (Settings → Profile).';

    try {
      localStorage.setItem(URL_KEY, url);
      localStorage.setItem(TOKEN_KEY, token.trim());
    } catch {
      return 'This TV couldn’t save it (storage is off).';
    }

    this.disconnect();

    try {
      await this.connect();

      return '';
    } catch (e) {
      return (e as Error).message;
    }
  }

  /** Turns the direct line off and forgets the address and token. */
  forget(): void {
    try {
      localStorage.removeItem(URL_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch { /* nothing saved */ }
    this.disconnect();
    this.problem = '';
  }

  private disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.ready = null;
    this.connected = false;
  }

  /** Opens the connection and signs in, once; later calls share it. */
  connect(): Promise<void> {
    if (this.ready) return this.ready;
    const { url, token } = maSettings();

    if (!url || !token) return Promise.reject(new Error('Music Assistant isn’t set up on this TV'));

    this.ready = new Promise<void>((resolve, reject) => {
      let ws: WebSocket;

      try {
        ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`);
      } catch {
        reject(this.fail('Can’t reach Music Assistant at that address'));

        return;
      }

      this.ws = ws;
      let greeted = false;
      const timer = window.setTimeout(() => { ws.close(); reject(this.fail('Music Assistant didn’t answer')); }, 8000);

      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;

        try { msg = JSON.parse(String(ev.data)); } catch { return; }

        // The server speaks first, with its version; from schema 28 on it wants the token.
        if (!greeted && 'server_id' in msg) {
          greeted = true;

          if (Number(msg.schema_version) < 28) {
            clearTimeout(timer);
            this.connected = true;
            this.problem = '';
            resolve();

            return;
          }

          this.send('auth', { token }, ws)
            .then(() => {
              clearTimeout(timer);
              this.connected = true;
              this.problem = '';
              resolve();
            })
            .catch(() => {
              clearTimeout(timer);
              ws.close();
              reject(this.fail('Music Assistant refused the token'));
            });

          return;
        }

        this.onResult(msg);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(this.fail('Can’t reach Music Assistant at that address'));
      };
      ws.onclose = () => {
        this.connected = false;
        this.ready = null;
        this.ws = null;

        for (const p of this.pending.values()) p.reject(new Error('Connection closed'));
        this.pending.clear();
      };
    });

    // A failed try can be tried again later.
    this.ready.catch(() => { this.ready = null; });

    return this.ready;
  }

  private fail(problem: string): Error {
    this.problem = problem;
    this.connected = false;

    return new Error(problem);
  }

  private onResult(msg: Record<string, unknown>): void {
    const id = typeof msg.message_id === 'string' ? msg.message_id : '';
    const p = id ? this.pending.get(id) : undefined;

    if (!p) return;

    if ('error_code' in msg) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.reject(new Error(String(msg.details ?? 'Music Assistant error')));

      return;
    }

    // Long answers can come in parts.
    if (msg.partial) {
      p.partial = [...(p.partial ?? []), ...(Array.isArray(msg.result) ? msg.result : [])];

      return;
    }

    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(p.partial ? [...p.partial, ...(Array.isArray(msg.result) ? msg.result : [])] : msg.result);
  }

  private send<T>(command: string, args: Record<string, unknown>, ws = this.ws): Promise<T> {
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected'));
    const message_id = `ct${++this.seq}`;

    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(message_id);
        reject(new Error('Music Assistant didn’t answer'));
      }, 10000);
      this.pending.set(message_id, { resolve: resolve as (v: unknown) => void, reject, partial: null, timer });
      ws.send(JSON.stringify({ message_id, command, args }));
    });
  }

  async command<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.demo) return this.demo(command, args) as T;
    await this.connect();

    return this.send<T>(command, args);
  }

  /** Every queue, to find a speaker's by name when Home Assistant doesn't say which it is. */
  queues(): Promise<MaQueue[]> {
    return this.command<MaQueue[]>('player_queues/all');
  }

  /** A page of a queue's items. */
  items(queueId: string, offset: number, limit: number): Promise<MaQueueItem[]> {
    return this.command<MaQueueItem[]>('player_queues/items', { queue_id: queueId, limit, offset });
  }

  /** Jumps to an item in the queue. */
  playIndex(queueId: string, queueItemId: string): Promise<unknown> {
    return this.command('player_queues/play_index', { queue_id: queueId, index: queueItemId });
  }

  /** A picture for a queue item: straight from the web when it can be, else through the server. */
  image(it: MaQueueItem): string {
    if (it.demoArt) return it.demoArt;
    const m = it.media_item;
    const img = it.image
      ?? (m?.image && typeof m.image === 'object' ? m.image : null)
      ?? m?.metadata?.images?.find((i) => i.type === 'thumb')
      ?? null;

    if (!img?.path) return typeof m?.image === 'string' ? m.image : '';

    if (img.remotely_accessible && /^https?:/.test(img.path)) return img.path;
    const { url } = maSettings();

    return url ? `${url}/imageproxy?path=${encodeURIComponent(img.path)}&provider=${encodeURIComponent(img.provider ?? '')}&size=200` : '';
  }
}

export const ma = new MusicAssistant();
