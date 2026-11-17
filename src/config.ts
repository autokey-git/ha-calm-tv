import * as v from 'valibot';
import { native } from './native';
import { DEVICE_TYPES } from './types';

/**
 * calm-tv.json: everything specific to one home, so the same app works anywhere.
 * See config/calm-tv.example.json for a complete example, and docs/configuration.md.
 *
 * Where it comes from:
 *  - On the TV: Home Assistant's www folder (http://<ha>/local/calm-tv.json), else a file
 *    pushed onto the TV with adb (android/.../ConfigFile.kt reads both).
 *  - In a desktop browser (npm run dev): calm-tv.json in the project folder.
 *  - Either way, the last good copy is kept, in case neither can be reached on a later start.
 *
 * The schemas below are the format's source of truth: the file is decoded with them, and the
 * types the rest of the app uses are derived from them.
 */

/** An entity id, like "light.kitchen". */
const EntityId = v.pipe(v.string(), v.regex(/^[a-z_]+\.[a-z0-9_]+$/, 'should be an entity id like "light.kitchen"'));

const DeviceSchema = v.object({
  type: v.picklist(DEVICE_TYPES, `should be one of ${DEVICE_TYPES.join(', ')}`),
  entity: EntityId,
  /** Shown name (defaults to the entity id). */
  name: v.optional(v.string()),
  /** Battery sensors; the lowest is shown (covers, locks). */
  batteries: v.optional(v.array(EntityId)),
  /** Lock: sensor saying how it was last locked. */
  operator: v.optional(EntityId),
  /** Lock: a keypad's battery sensor. */
  keypad: v.optional(EntityId),
  /** Sensor: what OK opens/closes in the ★ side panel, e.g. the garage door's "cover.left_garage_door". Only a cover. */
  control: v.optional(v.pipe(EntityId, v.startsWith('cover.', 'should be a cover, like "cover.garage_door"'))),
  /** Scene: a list of scenes to pick from, instead of a select entity (as rooms from Areas build it). */
  scenes: v.optional(v.array(EntityId)),
});

/**
 * How the album's colour shows behind the Music screen: not at all (the default: just the photo),
 * a glow around the cover, the screen washed in it, or a solid colour in place of the photo (as in
 * the Music panel). Settings steps through them in this order.
 */
export const MUSIC_BACKGROUNDS = ['none', 'glow', 'wash', 'solid'] as const;

export type MusicBackground = (typeof MUSIC_BACKGROUNDS)[number];

/** The screens, in their default order (↓ moves through them). */
/** A background's versions for the times of day (see variants.ts). */
const Outline = v.optional(v.array(v.tuple([v.number(), v.number()]), 'should be a list of [x, y] points'));
/** Where a background's sky, water and ground are, for the living sky's weather (sky-fx.ts). */
const SceneMapSchema = v.optional(
  v.object({ sky: Outline, water: Outline, ground: Outline, fog: v.optional(v.number()) }),
);
const PHASE_URLS = {
  dawn: v.optional(v.string()),
  day: v.optional(v.string()),
  dusk: v.optional(v.string()),
  night: v.optional(v.string()),
  map: SceneMapSchema,
};

export const SCREENS = ['apps', 'smarthome', 'music', 'calendar', 'weather'] as const;

export type ScreenName = (typeof SCREENS)[number];

export const ROOM_ICONS = ['couch', 'cutlery', 'desk', 'bed', 'stairs', 'house'] as const;

const RoomSchema = v.object({
  name: v.pipe(v.string(), v.nonEmpty('needs a name')),
  icon: v.optional(v.picklist(ROOM_ICONS, `should be one of ${ROOM_ICONS.join(', ')}`)),
  /** Summary when nothing is on (default "All off"). */
  whenIdle: v.optional(v.string()),
  /** Lock entities: the room turns amber if one is left unlocked for 10 minutes. */
  locks: v.optional(v.array(EntityId)),
  /** A sensor whose state is a short "needs attention" note (shown when nothing is urgent). */
  maintenance: v.optional(EntityId),
  /** A robot vacuum: entity id stems of the vacuum and its dock (Roborock integration naming). */
  vacuum: v.optional(v.object({ label: v.string(), vacuum: v.string(), dock: v.string() })),
  /** A binary sensor that becomes the room's urgent status while on, e.g. a garage door. */
  alert: v.optional(v.object({ entity: EntityId, text: v.string() })),
  groups: v.array(v.object({ title: v.string(), devices: v.optional(v.array(DeviceSchema), []) })),
});

const ConfigSchema = v.object({
  /**
   * The app dock, in order. `package` is the Android TV app. `icon` is a built-in icon's name from
   * src/icons/ (e.g. "netflix"), or your own file: "/local/calm-tv/icons/moonlight.svg" in Home
   * Assistant's www folder, or a full address.
   */
  apps: v.optional(
    v.array(
      v.object({
        name: v.string(),
        /** The Android TV app to open. */
        package: v.optional(v.string()),
        icon: v.optional(v.string()),
      }),
    ),
  ),
  /**
   * The Music screen and panel: `players` are the speakers, as { name, entity } (default: every
   * Music Assistant player), `library` names the media browser's top folders that get a button
   * (default: Music Assistant's Artists … Audiobooks), and `background` is how the album's colour
   * shows behind the Music screen (default "none"; each TV can change it in Settings).
   */
  music: v.optional(
    v.object({
      players: v.optional(v.array(v.object({ name: v.string(), entity: EntityId }))),
      library: v.optional(v.array(v.string())),
      background: v.optional(v.picklist(MUSIC_BACKGROUNDS, `should be one of ${MUSIC_BACKGROUNDS.join(', ')}`)),
      /** The wave under the time on the Music screen (default true). */
      wave: v.optional(v.boolean()),
    }),
  ),
  /** Weather entity for the Weather screen and the Smart Home "Outside" line. */
  weather: v.optional(EntityId),
  /**
   * The living sky (off unless present): the background follows the time of day from `sun`
   * (default sun.sun) and draws the weather from `weather` (default the Weather screen's entity).
   * `effects: false` keeps the time of day but draws no rain, snow or fog. `versionsOnly: true` leaves
   * backgrounds without their own dawn/day/dusk/night versions exactly as they are (no tint or stars).
   */
  sky: v.optional(
    v.object({
      sun: v.optional(EntityId),
      weather: v.optional(EntityId),
      effects: v.optional(v.boolean('should be true or false')),
      versionsOnly: v.optional(v.boolean('should be true or false')),
    }),
  ),
  /** Calendar entities: `events` fill the Calendar bar; `meals` (optional) gives "Dinner · …" from today's all-day event. */
  calendar: v.optional(v.object({ events: v.optional(EntityId), meals: v.optional(EntityId) })),
  /**
   * Doorbell video window (off unless `window` is true): its camera, and an input_boolean that is on while it rings.
   * `size` is the window's width as a percentage of the screen (default 34), `position` is "corner" (top right,
   * the default) or "center", `pause` pauses whatever is playing in another app when it rings, and `sound` plays the camera's
   * audio once live video starts.
   */
  doorbell: v.optional(
    v.object({
      window: v.optional(v.boolean()),
      camera: v.optional(EntityId),
      ringing: v.optional(EntityId),
      size: v.optional(v.pipe(v.number('should be a number, e.g. 75'), v.minValue(20), v.maxValue(100))),
      position: v.optional(v.picklist(['corner', 'center'], 'should be "corner" or "center"')),
      pause: v.optional(v.boolean()),
      sound: v.optional(v.boolean()),
    }),
  ),
  /**
   * A small pop-up in the corner when a door opens, even over other apps (it never pauses them):
   * an open door with the door's name for a few seconds. A door still open after `leftOpen` seconds
   * (default 10) pops up again with a red "!" and "Left open", until it closes. Off unless doors are listed.
   */
  doors: v.optional(
    v.object({
      popup: v.optional(v.boolean()),
      entities: v.optional(v.array(v.object({ name: v.string(), entity: EntityId }))),
      leftOpen: v.optional(v.pipe(v.number('should be a number of seconds, e.g. 10'), v.minValue(5))),
    }),
  ),
  /**
   * The screens to show, in order, e.g. ["apps", "smarthome", "weather"] for no Calendar. Apps is
   * always shown, and first (it holds Settings). Default: all four.
   */
  // A name this version doesn't know (a screen added in a newer one, or a typo) is skipped with a
  // warning, not an error: one unknown word mustn't make the whole file unreadable, so an older TV
  // or dashboard can still read a newer calm-tv.json.
  screens: v.optional(v.pipe(v.array(v.string()), v.transform((names) => names.filter((n): n is ScreenName => {
    const known = (SCREENS as readonly string[]).includes(n);

    if (!known) console.warn(`calm-tv.json: "screens" has "${n}", which this version doesn't know; skipped`);

    return known;
  })))),
  /** Rooms in the Smart Home bar, in order. */
  rooms: v.optional(v.array(RoomSchema)),
  /** Look options. */
  display: v.optional(
    v.object({
      /** The bars' glass: "blur" (frosted, the default) or "tint" (plain dark glass, no blur; lightest on the TV). */
      glass: v.optional(v.picklist(['blur', 'tint'], 'should be "blur" or "tint"')),
      /** false hides video backgrounds; only photos are offered (default true). */
      videos: v.optional(v.boolean('should be true or false')),
      /** How screens change: "fade" (the default) or "instant" (no animation; lightest on the TV). */
      transitions: v.optional(v.picklist(['fade', 'instant'], 'should be "fade" or "instant"')),
      /** After a few seconds without a key press, the screens' bars fade and only the essentials stay (default true). */
      fade: v.optional(v.boolean('should be true or false')),
    }),
  ),
  /** Extra backgrounds, e.g. files in Home Assistant's www folder ("/local/beach.jpg"). */
  backgrounds: v.optional(
    v.object({
      // Each can also have `dawn`, `dusk` and `night` versions (and `day`, if `url` isn't it), for the living sky.
      photos: v.optional(v.array(v.object({ name: v.string(), url: v.string(), ...PHASE_URLS }))),
      videos: v.optional(v.array(v.object({ name: v.string(), url: v.string(), thumb: v.optional(v.string()), ...PHASE_URLS }))),
    }),
  ),
});

export type CalmTvConfig = v.InferOutput<typeof ConfigSchema>;

export type RoomConfig = v.InferOutput<typeof RoomSchema>;

export type DeviceConfig = v.InferOutput<typeof DeviceSchema>;

export type RoomIcon = (typeof ROOM_ICONS)[number];

/** What the TV app's loadConfig() returns: the file and where it came from, or why there's none. */
const NativeConfigResult = v.object({
  source: v.fallback(v.optional(v.string(), ''), ''),
  text: v.fallback(v.optional(v.string(), ''), ''),
  error: v.fallback(v.optional(v.string(), ''), ''),
});

/**
 * Demo mode (index.html?demo): a made-up home instead of Home Assistant (see demo.ts). The hosted
 * demo is built with VITE_DEMO_SITE=1, so it's always in demo mode.
 */
export const demoMode = import.meta.env.VITE_DEMO_SITE === '1' || new URLSearchParams(location.search).has('demo');

/**
 * Dashboard mode (index.html?dash): for a touch screen at arm's length, such as a docked tablet. A tab
 * bar under the screens replaces the Apps screen and the remote's arrows; everything can be tapped.
 */
export const dashboardMode = new URLSearchParams(location.search).has('dash');

/** True when this page is served by Home Assistant itself, from its www folder (/local/…). */
const servedByHa = !import.meta.env.DEV && location.pathname.startsWith('/local/');

const CACHE_KEY = 'ct.config';
/**
 * The copy of the setup kept in Home Assistant (see config-store.ts), as last received: it's
 * used from the start, before Home Assistant answers. Shared with the doorbell window and the ★
 * panel, which are pages of the same app.
 */
export const STORED_KEY = 'ct.configStored';
const HA_URL_KEY = 'ct.haUrl';

export const settings = {
  /** The loaded configuration ({} if none). */
  config: v.parse(ConfigSchema, {}),
  /** Where it came from: "Home Assistant", "this TV", "this project folder", "last saved copy", or "". */
  source: '',
  /** True when it's the copy kept in Home Assistant, not a calm-tv.json file. */
  stored: false,
  /** Why the newest copy couldn't be used, if it couldn't. */
  error: '',
  /** Home Assistant's address, e.g. "http://192.168.1.20:8123" ("" until it's set up). */
  haUrl: '',
};

/**
 * VITE_HA_URL from .env.local, for the browser preview only. Vite also reads .env.local for builds,
 * so it's ignored outside dev: a shared build must never carry someone's Home Assistant address.
 */
const devHaUrl = import.meta.env.DEV ? import.meta.env.VITE_HA_URL ?? '' : '';

/** Home Assistant's address: set on the TV (Settings or adb), or VITE_HA_URL / the saved one in a browser. */
function readHaUrl(): string {
  if (native?.getHaUrl) return native.getHaUrl();

  // The doorbell window and the ★ side panel over other apps have their own, smaller bridges.
  if (window.CalmTvDoorbell?.getHaUrl) return window.CalmTvDoorbell.getHaUrl();
  if (window.CalmTvPanel?.getHaUrl) return window.CalmTvPanel.getHaUrl();

  // Served from Home Assistant's www folder: Home Assistant is this page's own server.
  if (servedByHa) return location.origin;

  try {
    return devHaUrl || localStorage.getItem(HA_URL_KEY) || '';
  } catch {
    return devHaUrl;
  }
}

/** Saves Home Assistant's address; returns the cleaned-up address, or "" if it isn't valid. */
export function saveHaUrl(raw: string): string {
  if (native?.setHaUrl) return native.setHaUrl(raw);
  let s = raw.trim();

  if (!s) return '';

  if (!s.includes('://')) s = `http://${s}`;

  try {
    const u = new URL(s);

    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    localStorage.setItem(HA_URL_KEY, u.origin);

    return u.origin;
  } catch {
    return '';
  }
}

/** "rooms → 2 → groups" for an issue at rooms[1].groups (counted from 1, as people do). */
function where(issue: v.BaseIssue<unknown>): string {
  const keys = (issue.path ?? []).map((item) => (item.type === 'array' ? String(item.key + 1) : String(item.key)));

  return keys.length ? keys.join(' → ') : 'the file';
}

/**
 * Decodes the text of calm-tv.json. Throws an Error naming where the first problem is,
 * e.g. `rooms → 2 → groups: …`, so a typo shows up clearly in Settings instead of a blank screen.
 */
export function decodeConfig(text: string): CalmTvConfig {
  let json;

  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`isn't valid JSON (${e instanceof Error ? e.message : 'unreadable'})`);
  }

  const result = v.safeParse(ConfigSchema, json);

  if (result.success) return result.output;
  const first = result.issues[0];

  throw new Error(`${where(first)}: ${first.message}`);
}

/** calm-tv.json from `url`: the project folder in a browser, or Home Assistant's www folder. */
async function fetchConfigFile(url: string): Promise<string> {
  try {
    const r = await fetch(url, { cache: 'no-store' });

    // The dev server answers unknown paths with the page itself; only take real JSON.
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return await r.text();
  } catch {
    /* not there */
  }

  return '';
}

/** The setup kept in Home Assistant, as last received ("" if none). */
export function storedConfigText(): string {
  try {
    return localStorage.getItem(STORED_KEY) ?? '';
  } catch {
    return '';
  }
}

/** calm-tv.json, wherever this page finds it: the TV app, Home Assistant's www folder, or the project folder. */
export async function readConfigFile(): Promise<{ text: string; source: string; error: string }> {
  let text = '';
  let source = '';
  let error = '';

  const nativeLoad = native?.loadConfig ? () => native!.loadConfig!()
    : window.CalmTvDoorbell?.loadConfig ? () => window.CalmTvDoorbell!.loadConfig!()
    : window.CalmTvPanel?.loadConfig ? () => window.CalmTvPanel!.loadConfig!() : null;

  if (nativeLoad) {
    let answer;

    try {
      answer = JSON.parse(nativeLoad());
    } catch {
      answer = null;
    }

    const r = v.safeParse(NativeConfigResult, answer);

    if (r.success) {
      text = r.output.text;
      source = r.output.source;
      error = r.output.error;
    } else {
      error = 'the TV app sent an unreadable answer';
    }
  } else if (servedByHa) {
    text = await fetchConfigFile('/local/calm-tv.json');
    source = text ? 'Home Assistant' : '';

    if (!text) error = 'no calm-tv.json in Home Assistant’s www folder';
  } else {
    text = await fetchConfigFile('calm-tv.json');
    source = text ? 'this project folder' : '';

    if (!text) error = 'no calm-tv.json in the project folder';
  }

  return { text, source, error };
}

/**
 * Loads Home Assistant's address and the home's setup. Call once, before the screens are built.
 * The copy kept in Home Assistant comes first, then calm-tv.json, then the last copy that worked.
 */
export async function loadConfig(): Promise<void> {
  settings.haUrl = readHaUrl();
  const stored = storedConfigText();

  if (stored) {
    try {
      settings.config = decodeConfig(stored);
      settings.source = 'Home Assistant';
      settings.stored = true;

      return;
    } catch (e) {
      // Not expected (it's checked before it's kept), but never a blank screen: use the file.
      settings.error = `the copy in Home Assistant: ${e instanceof Error ? e.message : 'unreadable'}`;
    }
  }

  const file = await readConfigFile();
  const { text, source } = file;

  if (!settings.error) settings.error = file.error;

  if (text) {
    try {
      settings.config = decodeConfig(text);
      settings.source = source;
      settings.error = '';

      try {
        localStorage.setItem(CACHE_KEY, text);
      } catch {
        /* storage full or off */
      }

      return;
    } catch (e) {
      settings.error = `calm-tv.json from ${source}: ${e instanceof Error ? e.message : 'unreadable'}`;
    }
  }

  // Fall back to the last copy that worked.
  try {
    const cached = localStorage.getItem(CACHE_KEY);

    if (cached) {
      settings.config = decodeConfig(cached);
      settings.source = 'last saved copy';
    }
  } catch {
    /* nothing usable */
  }
}

/**
 * The screens to show, in order: calm-tv.json's "screens" (or all four), always starting with Apps.
 * The dashboard has no Apps screen: a web page can't open other apps, and its tab bar holds Music and
 * Settings instead.
 */
export function screenOrder(): ScreenName[] {
  const listed = settings.config.screens ?? SCREENS;
  // The Music screen needs "music" in calm-tv.json (its speakers).
  const rest = [...new Set(listed.filter((s) => s !== 'apps' && (s !== 'music' || !!settings.config.music)))];

  if (dashboardMode) return rest.length ? rest : ['smarthome'];

  return ['apps', ...rest];
}

/** A path on Home Assistant ("/local/x.jpg") as a full address; full addresses are kept. */
export function haPath(url: string): string {
  return /^[a-z]+:/i.test(url) || !settings.haUrl ? url : settings.haUrl + (url.startsWith('/') ? '' : '/') + url;
}
