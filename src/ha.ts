import {
  Auth,
  type AuthData,
  type Connection,
  type HassEntities,
  createConnection,
  createLongLivedTokenAuth,
  getAuth,
  subscribeEntities,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
} from 'home-assistant-js-websocket';
import * as v from 'valibot';
import { settings } from './config';

// Home Assistant's address comes from the TV's settings (or VITE_HA_URL in a browser): see config.ts.
const haUrl = () => settings.haUrl;

const TOKENS_KEY = 'ct.haTokens';

export type HaStatus = 'signed-out' | 'connecting' | 'connected' | 'offline';

/** The values this app passes to Home Assistant services (entity ids, options, levels). */
export type ServiceData = Record<string, string | number | boolean | string[]>;

/** The two calls the screens make on Home Assistant's websocket (also answered by demo mode's stand-in). */
export type HaLink = Pick<Connection, 'sendMessagePromise' | 'subscribeMessage'>;

/** Saved sign-in tokens, as home-assistant-js-websocket stores them. */
const AuthDataSchema = v.object({
  hassUrl: v.string(),
  clientId: v.nullable(v.string()),
  expires: v.number(),
  refresh_token: v.string(),
  access_token: v.string(),
  expires_in: v.number(),
});

type Listener = () => void;

const SIGNED_OUT_KEY = 'ct.haSignedOut';

/** "http://ha:8123/" and "http://HA:8123" are the same Home Assistant. */
const sameHa = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/** Why the TV isn't signed in, kept so Settings can say what happened (and when). */
function noteSignedOut(why: string): void {
  console.warn(`[CalmTV] Not signed in to Home Assistant: ${why}`);

  try {
    localStorage.setItem(SIGNED_OUT_KEY, JSON.stringify({ why, at: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

const SignedOutSchema = v.object({ why: v.string(), at: v.number() });

/** The last reason the TV was found signed out, e.g. "Home Assistant refused the saved sign-in · Mon 10:42". */
export function lastSignedOut(): string {
  try {
    const r = v.safeParse(SignedOutSchema, JSON.parse(localStorage.getItem(SIGNED_OUT_KEY) ?? 'null'));

    if (!r.success) return '';
    const at = new Date(r.output.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

    return `${r.output.why} · ${at}`;
  } catch {
    return '';
  }
}

/** The saved sign-in, or null with the reason noted. */
function loadTokens(): AuthData | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);

    if (!raw) {
      noteSignedOut('no saved sign-in on this TV');

      return null;
    }
    const saved = v.safeParse(AuthDataSchema, JSON.parse(raw));

    if (!saved.success) {
      noteSignedOut('the saved sign-in couldn’t be read');

      return null;
    }

    // Tokens belong to one Home Assistant: not used if the address was changed.
    if (!sameHa(saved.output.hassUrl, settings.haUrl)) {
      noteSignedOut(`the saved sign-in is for ${saved.output.hassUrl}, not ${settings.haUrl}`);

      return null;
    }

    return saved.output;
  } catch {
    noteSignedOut('the saved sign-in couldn’t be read');

    return null;
  }
}

function saveTokens(data: AuthData | null): void {
  try {
    if (data) localStorage.setItem(TOKENS_KEY, JSON.stringify(data));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* storage unavailable: stays signed in until the page reloads */
  }
}

/**
 * The live link to Home Assistant. Signs in with HA's own login page (OAuth, so no token is
 * ever typed or pasted), keeps the tokens, and holds the latest state of every entity.
 * The library reconnects by itself after a drop; this also retries a failed first connect.
 */
class HomeAssistant {
  status: HaStatus = 'signed-out';
  entities: HassEntities = {};
  userName = '';
  private conn: Connection | null = null;
  /** What the screens use: the connection's messages, or demo mode's stand-in. */
  private link: HaLink | null = null;
  private auth: Auth | null = null;
  private retryTimer = 0;
  private retryDelay = 5000;
  private statusListeners: Listener[] = [];
  private entityListeners: Listener[] = [];
  private connectedListeners: ((c: HaLink) => void)[] = [];
  /** Demo mode (see demo.ts): a stand-in connection and its states, used by start() instead of signing in. */
  private demo: { link: HaLink; subscribe: (fn: (e: HassEntities) => void) => void } | null = null;

  onStatus(fn: Listener): void { this.statusListeners.push(fn); }
  onEntities(fn: Listener): void { this.entityListeners.push(fn); }
  /** Runs each time a connection is (re)established, e.g. to (re)subscribe to forecasts. */
  onConnected(fn: (c: HaLink) => void): void {
    this.connectedListeners.push(fn);

    if (this.link && this.status === 'connected') fn(this.link);
  }

  /** Demo mode: start() talks to `link` and takes its states from `subscribe`. */
  useDemo(link: HaLink, subscribe: (fn: (e: HassEntities) => void) => void): void {
    this.demo = { link, subscribe };
  }

  /** Connect if we have tokens or just came back from the sign-in page. Never redirects by itself. */
  async start(): Promise<void> {
    if (this.demo) {
      const { link, subscribe } = this.demo;
      this.link = link;
      this.userName = 'Demo';
      this.connected(link);
      subscribe((ents) => {
        this.entities = ents;
        this.entityListeners.forEach((fn) => fn());
      });

      return;
    }

    // Dev on the Mac only (see vite.config.ts): connect with the dev token when the server offers one.
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('devtoken')) {
      const r = await fetch('/__dev-token').catch(() => null);

      if (r?.ok) {
        this.auth = createLongLivedTokenAuth(haUrl(), await r.text());
        await this.connect();

        return;
      }
    }

    const callback = new URLSearchParams(location.search).has('auth_callback');

    if (!haUrl() || (!callback && !loadTokens())) {
      this.setStatus('signed-out');

      return;
    }

    await this.connect();
  }

  /** Opens Home Assistant's sign-in page; it returns to Calm TV when done. */
  async signIn(): Promise<void> {
    // Demo mode never leaves for a sign-in page (the hosted demo has no Home Assistant).
    if (this.demo) return;
    saveTokens(null);

    if (!haUrl()) return;
    await getAuth({ hassUrl: haUrl(), limitHassInstance: true, saveTokens, loadTokens: async () => null });
  }

  async signOut(): Promise<void> {
    if (this.demo) return;
    console.info('[CalmTV] Signed out of Home Assistant from Settings');
    const auth = this.auth;
    this.teardown();
    saveTokens(null);
    this.setStatus('signed-out');

    try { await auth?.revoke(); } catch { /* offline: the tokens are forgotten here anyway */ }
  }

  async call(domain: string, service: string, data: ServiceData): Promise<void> {
    if (!this.link) return;

    try {
      await this.link.sendMessagePromise({ type: 'call_service', domain, service, service_data: data });
    } catch (e) {
      console.warn('HA service call failed', domain, service, data, e);
    }
  }

  /** The live connection, when connected. */
  get connection(): HaLink | null {
    return this.status === 'connected' ? this.link : null;
  }

  /** A path on HA (e.g. a camera picture) as a full URL. */
  url(path: string): string {
    return path.startsWith('http') ? path : haUrl() + path;
  }

  private async connect(): Promise<void> {
    clearTimeout(this.retryTimer);
    this.setStatus('connecting');

    try {
      this.auth ??= await getAuth({ hassUrl: haUrl(), limitHassInstance: true, saveTokens, loadTokens: async () => loadTokens() });

      // Drop ?auth_callback=1&code=... from the address so a reload doesn't reuse the code.
      if (location.search.includes('auth_callback')) history.replaceState(null, '', location.pathname);
      const conn = await createConnection({ auth: this.auth });
      this.conn = conn;
      this.link = conn;
      this.retryDelay = 5000;
      conn.addEventListener('ready', () => this.connected(conn));
      conn.addEventListener('disconnected', () => this.setStatus('offline'));
      conn.addEventListener('reconnect-error', (_c, err) => {
        if (err === ERR_INVALID_AUTH) this.lostAuth('Home Assistant refused the saved sign-in while reconnecting');
      });
      subscribeEntities(conn, (ents) => {
        this.entities = ents;
        this.entityListeners.forEach((fn) => fn());
      });
      this.connected(conn);
      conn
        .sendMessagePromise<{ name: string }>({ type: 'auth/current_user' })
        .then((u) => { this.userName = u.name; this.statusListeners.forEach((fn) => fn()); })
        .catch(() => {});
    } catch (err) {
      const badCallback = location.search.includes('auth_callback');

      if (badCallback) history.replaceState(null, '', location.pathname);

      if (err === ERR_INVALID_AUTH || badCallback) {
        if (badCallback) console.warn('[CalmTV] Home Assistant sign-in callback failed', err);
        this.lostAuth(badCallback ? 'the sign-in page’s answer couldn’t be used' : 'Home Assistant refused the saved sign-in');
      } else {
        // ERR_CANNOT_CONNECT (HA or Tailscale down) or a network error: try again, backing off to 1 minute.
        if (err !== ERR_CANNOT_CONNECT) console.warn('HA connect failed', err);
        this.setStatus('offline');
        this.retryTimer = window.setTimeout(() => this.connect(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 60000);
      }
    }
  }

  private connected(link: HaLink): void {
    this.setStatus('connected');
    this.connectedListeners.forEach((fn) => fn(link));
  }

  /** The tokens were refused (e.g. the TV user was removed or signed out in HA). */
  private lostAuth(why: string): void {
    noteSignedOut(why);
    this.teardown();
    saveTokens(null);
    this.setStatus('signed-out');
  }

  private teardown(): void {
    clearTimeout(this.retryTimer);
    this.conn?.close();
    this.conn = null;
    this.link = null;
    this.auth = null;
    this.userName = '';
  }

  private setStatus(s: HaStatus): void {
    if (s !== this.status) console.info(`[CalmTV] Home Assistant: ${s}`);
    this.status = s;
    this.statusListeners.forEach((fn) => fn());
  }
}

export const ha = new HomeAssistant();
