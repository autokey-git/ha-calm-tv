import * as v from 'valibot';
import { demoMode, settings } from './config';
import { native } from './native';

// An optional direct line to the Music Assistant server, only for what Home Assistant can't pass
// along: the whole queue (HA's music_assistant.get_queue gives what's playing and what's next).
// Set up on each TV in Settings → Home Assistant → Music Assistant: the server's address and a
// long-lived token made in Music Assistant (Settings → Profile). Both stay on this TV, never in
// calm-tv.json, which anyone on the network can read. Everything else keeps going through HA.

const URL_KEY = 'calmtv.maUrl';
const TOKEN_KEY = 'calmtv.maToken';

const maybeString = v.fallback(v.optional(v.string()), undefined);
const maybeNumber = v.fallback(v.optional(v.number()), undefined);

/** A picture Music Assistant knows of: a web address, or a path its image proxy serves. */
const MaImageSchema = v.object({
  type: maybeString,
  path: v.string(),
  provider: maybeString,
  remotely_accessible: v.fallback(v.optional(v.boolean()), undefined),
});

const maybeImage = v.fallback(v.optional(v.nullable(MaImageSchema)), undefined);
const NamedSchema = v.object({ name: maybeString });

/** One queue entry, as Music Assistant sends it (only the parts used here). */
const MaQueueItemSchema = v.object({
  queue_item_id: v.string(),
  name: v.fallback(v.string(), ''),
  duration: maybeNumber,
  image: maybeImage,
  media_item: v.fallback(v.optional(v.nullable(v.object({
    name: maybeString,
    artists: v.fallback(v.optional(v.array(NamedSchema)), undefined),
    metadata: v.fallback(v.optional(v.nullable(v.object({
      images: v.fallback(v.optional(v.nullable(v.array(MaImageSchema))), undefined),
    }))), undefined),
  }))), undefined),
  /** Demo mode only: a ready picture. */
  demoArt: maybeString,
});

export type MaQueueItem = v.InferOutput<typeof MaQueueItemSchema>;

/** A speaker's queue, as player_queues/all lists them. */
const MaQueueSchema = v.object({
  queue_id: v.string(),
  display_name: maybeString,
});

type MaQueue = v.InferOutput<typeof MaQueueSchema>;

/** The server's first message on a new connection. */
const ServerInfoSchema = v.object({
  server_id: v.string(),
  server_version: maybeString,
  schema_version: v.number(),
});

/** The answer to a command: a result (maybe in parts), or an error. */
const ResultSchema = v.object({
  message_id: v.string(),
  result: v.optional(v.unknown()),
  partial: v.fallback(v.optional(v.boolean()), undefined),
  error_code: maybeNumber,
  details: v.fallback(v.optional(v.nullable(v.string())), undefined),
});

/** What the TV app hands over from adb (see MainActivity.rememberMa). */
const HandoffSchema = v.object({ url: maybeString, token: maybeString });

const read = (key: string): string => {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
};

let handoffChecked = false;

/**
 * A token handed over with adb (see MainActivity.rememberMa): saved here once, since typing a
 * long token with adb's input text cuts it off.
 */
function takeHandoff(): void {
  if (handoffChecked) return;
  handoffChecked = true;
  const raw = native?.takeMaSetup?.();

  if (!raw) return;
  let given: v.InferOutput<typeof HandoffSchema>;

  try {
    given = v.parse(HandoffSchema, JSON.parse(raw));
  } catch {
    return;
  }

  const token = cleanToken(given.token ?? '');

  if (!token) return;

  try {
    localStorage.setItem(TOKEN_KEY, token);
    const url = cleanMaUrl(given.url ?? '') || localStorage.getItem(URL_KEY) || guessMaUrl();

    if (url) localStorage.setItem(URL_KEY, url);
  } catch { /* storage off */ }

  // Check it right away, so Settings says whether it worked.
  window.setTimeout(() => { ma.connect().catch(() => { /* Settings shows the problem */ }); }, 0);
}

/** The saved server address and token ("" when not set up). */
export const maSettings = () => {
  takeHandoff();

  return { url: read(URL_KEY), token: read(TOKEN_KEY) };
};

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

/** A pasted token without what tends to come along: spaces, line breaks, quotes, "Bearer ". */
const cleanToken = (raw: string) => raw.replace(/\s+/g, '').replace(/^["']|["']$/g, '').replace(/^Bearer/i, '');

/** A command's arguments. */
type Args = { [key: string]: string | number | boolean };

/** A command waiting for its answer, and the connection it went out on. */
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; partial: unknown[] | null; timer: number; ws: WebSocket };

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
  demo: ((command: string, args: Args) => unknown) | null = null;

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
      localStorage.setItem(TOKEN_KEY, cleanToken(token));
    } catch {
      return 'This TV couldn’t save it (storage is off).';
    }

    this.disconnect();

    try {
      await this.connect();

      return '';
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
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
      // The first outcome is the one reported: once signed in, timed out, unreachable or refused,
      // nothing later (such as the close that follows a timeout) can overwrite it.
      let settled = false;
      const done = (problem?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (problem === undefined) {
          this.connected = true;
          this.problem = '';
          resolve();
        } else reject(this.fail(problem));
      };
      const timer = window.setTimeout(() => {
        done('Music Assistant didn’t answer');
        ws.close();
      }, 8000);

      ws.onmessage = (ev) => {
        let data: unknown;

        try {
          data = JSON.parse(String(ev.data));
        } catch {
          return;
        }

        // The server speaks first, with its version; from schema 28 on it wants the token.
        const info = greeted ? null : v.safeParse(ServerInfoSchema, data);

        if (info?.success) {
          greeted = true;
          console.info('Music Assistant', info.output.server_version, 'schema', info.output.schema_version);

          if (info.output.schema_version < 28) {
            done();

            return;
          }

          this.send('auth', { token }, ws)
            .then(() => done())
            .catch((err: Error) => {
              // Say why, and how long the TV's token is (never any of it: it's shown on screen), so
              // a cut-off paste is easy to spot.
              done(`Music Assistant refused the token (${err.message}). The token on this TV is ${token.length} characters long.`);
              ws.close();
            });

          return;
        }

        const result = v.safeParse(ResultSchema, data);

        // Anything else (events) isn't needed here.
        if (result.success) this.onResult(result.output);
      };
      ws.onerror = () => done('Can’t reach Music Assistant at that address');
      ws.onclose = () => {
        done('Music Assistant closed the connection');

        // Only this socket's own commands fail. A socket replaced by a newer one (Settings saved a
        // new address or token) mustn't take the new connection, or its sign-in, down with it.
        for (const [id, p] of this.pending) {
          if (p.ws !== ws) continue;
          clearTimeout(p.timer);
          p.reject(new Error('Connection closed'));
          this.pending.delete(id);
        }

        if (this.ws !== ws) return;
        this.connected = false;
        this.ready = null;
        this.ws = null;
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

  private onResult(msg: v.InferOutput<typeof ResultSchema>): void {
    const p = this.pending.get(msg.message_id);

    if (!p) return;

    if (msg.error_code !== undefined) {
      this.pending.delete(msg.message_id);
      clearTimeout(p.timer);
      p.reject(new Error(msg.details ?? `error ${msg.error_code}`));

      return;
    }

    // Long answers (a big queue) can come in parts: lists to join.
    const part = Array.isArray(msg.result) ? msg.result : [];

    if (msg.partial) {
      p.partial = [...(p.partial ?? []), ...part];

      return;
    }

    this.pending.delete(msg.message_id);
    clearTimeout(p.timer);
    p.resolve(p.partial ? [...p.partial, ...part] : msg.result);
  }

  private send(command: string, args: Args, ws = this.ws): Promise<unknown> {
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected'));
    const message_id = `ct${++this.seq}`;

    return new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(message_id);
        reject(new Error('Music Assistant didn’t answer'));
      }, 10000);
      this.pending.set(message_id, { resolve, reject, partial: null, timer, ws });
      ws.send(JSON.stringify({ message_id, command, args }));
    });
  }

  /** Sends a command (to demo mode's made-up server in demo mode); the answer is decoded by the caller. */
  async command(command: string, args: Args = {}): Promise<unknown> {
    if (this.demo) return this.demo(command, args);
    await this.connect();

    return this.send(command, args);
  }

  /** Every queue, to find a speaker's by name when Home Assistant doesn't say which it is. */
  async queues(): Promise<MaQueue[]> {
    return v.parse(v.array(MaQueueSchema), await this.command('player_queues/all'));
  }

  /** A page of a queue's items. */
  async items(queueId: string, offset: number, limit: number): Promise<MaQueueItem[]> {
    return v.parse(v.array(MaQueueItemSchema), await this.command('player_queues/items', { queue_id: queueId, limit, offset }));
  }

  /** Jumps to an item in the queue. */
  async playIndex(queueId: string, queueItemId: string): Promise<void> {
    await this.command('player_queues/play_index', { queue_id: queueId, index: queueItemId });
  }

  /** A picture for a queue item: straight from the web when it can be, else through the server. */
  image(it: MaQueueItem): string {
    if (it.demoArt) return it.demoArt;
    const img = it.image ?? it.media_item?.metadata?.images?.find((i) => i.type === 'thumb') ?? null;

    if (!img) return '';

    if (img.remotely_accessible && /^https?:/.test(img.path)) return img.path;
    const { url } = maSettings();

    return url ? `${url}/imageproxy?path=${encodeURIComponent(img.path)}&provider=${encodeURIComponent(img.provider ?? '')}&size=200` : '';
  }
}

export const ma = new MusicAssistant();
