import * as v from 'valibot';
import { ha } from './ha';
import { decodeConfig, demoMode, readConfigFile, STORED_KEY, storedConfigText } from './config';

// The home's setup kept in Home Assistant instead of the public www folder: Home Assistant's shared
// frontend storage ("system data", Home Assistant 2025.x and newer). Any signed-in user can read it
// (the TV's own user), only an admin can change it, it's in Home Assistant's backups, and changes
// arrive at once. calm-tv.json stays as the way in: Settings copies it into Home Assistant.

/** The key in Home Assistant's frontend system data. */
const KEY = 'calm_tv';

/** What's kept under the key: the setup, and when and by whom it was saved. */
const Stored = v.object({
  config: v.record(v.string(), v.unknown()),
  saved: v.fallback(v.optional(v.string(), ''), ''),
  by: v.fallback(v.optional(v.string(), ''), ''),
});

/** When and by whom the copy in Home Assistant was saved, once known. */
export const storedInfo = { saved: '', by: '', problem: '' };

/** Keeps the received copy for the next start (and the doorbell window and ★ panel); true if it changed. */
function keep(text: string): boolean {
  if (text === storedConfigText()) return false;

  try {
    if (text) localStorage.setItem(STORED_KEY, text);
    else localStorage.removeItem(STORED_KEY);
  } catch { /* storage off: it's used while this page is open */ }

  return true;
}

/**
 * Follows the copy in Home Assistant. When it's added, changed or removed, the app starts again
 * with it (the screens are built from the setup once). Call once, from the main page.
 */
export function watchStoredConfig(): void {
  if (demoMode) return;
  let subscribed = false;

  ha.onConnected((link) => {
    // The library subscribes again by itself after a reconnect.
    if (subscribed) return;
    subscribed = true;
    link.subscribeMessage<{ value: unknown }>((m) => {
      console.info(`[CalmTV] Setup kept in Home Assistant: ${m.value == null ? 'none' : 'found'}`);

      if (m.value == null) {
        storedInfo.saved = '';

        if (keep('')) location.reload();

        return;
      }

      const r = v.safeParse(Stored, m.value);

      if (!r.success) {
        storedInfo.problem = 'it isn’t in Calm TV’s format';

        return;
      }

      const text = JSON.stringify(r.output.config);
      Object.assign(storedInfo, { saved: r.output.saved, by: r.output.by, problem: '' });

      try {
        decodeConfig(text);
      } catch (e) {
        // Never swap a working setup for a broken one: say so in Settings instead.
        storedInfo.problem = e instanceof Error ? e.message : 'unreadable';

        return;
      }

      if (keep(text)) location.reload();
    }, { type: 'frontend/subscribe_system_data', key: KEY }).catch((e: unknown) => {
      console.info('[CalmTV] Setup kept in Home Assistant: can’t read it', e);
      // Home Assistant older than system data: calm-tv.json works as before.
      subscribed = false;
    });
  });
}

/**
 * Copies calm-tv.json into Home Assistant (admins only). The subscription above then starts the
 * app again with it. Throws with a short reason.
 */
export async function copyFileToHa(): Promise<void> {
  const link = ha.connection;

  if (!link) throw new Error('not connected');
  const file = await readConfigFile();

  if (!file.text) throw new Error(file.error || 'no calm-tv.json found');
  decodeConfig(file.text);
  await save({ config: JSON.parse(file.text), saved: new Date().toISOString(), by: ha.userName });
}

/** Saves edited setup text as the copy in Home Assistant (admins only). Throws with a short reason. */
export async function saveConfigText(text: string): Promise<void> {
  decodeConfig(text);
  await save({ config: JSON.parse(text), saved: new Date().toISOString(), by: ha.userName });
}

/** Stops using the copy in Home Assistant (admins only): back to calm-tv.json. */
export async function removeStoredConfig(): Promise<void> {
  await save(null);
}

async function save(value: unknown): Promise<void> {
  const link = ha.connection;

  if (!link) throw new Error('not connected');
  await link.sendMessagePromise({ type: 'frontend/set_system_data', key: KEY, value });
}

