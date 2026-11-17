import * as v from 'valibot';
import type { App } from './types';
import { icon } from './icons';
import { installedApps, native } from './native';
import { demoMode, haPath, settings } from './config';

// The built-in dock lineup, used when calm-tv.json has no "apps", in order. Each `mark` is a brand SVG from src/icons/,
// recolored to white in CSS. `pkg` is the Android TV package the tile opens.
// Reorder or edit freely.
const lineup: App[] = [
  { name: 'YouTube', mark: icon('youtube'), pkg: 'com.google.android.youtube.tv' },
  { name: 'Netflix', mark: icon('netflix'), pkg: 'com.netflix.ninja' },
  { name: 'Prime Video', mark: icon('primevideo'), pkg: 'com.amazon.amazonvideo.livingroom' },
  { name: 'Disney+', mark: icon('disneyplus'), pkg: 'com.disney.disneyplus' },
  { name: 'Hulu', mark: icon('hulu'), pkg: 'com.hulu.livingroomplus' },
  { name: 'Apple TV+', mark: icon('appletv'), pkg: 'com.apple.atve.androidtv.appletv' },
  { name: 'Peacock', mark: icon('peacock'), pkg: 'com.peacocktv.peacockandroid' },
  { name: 'Google TV', mark: icon('googletv'), pkg: 'com.google.android.videos' },
  { name: 'HBO Max', mark: icon('hbomax'), pkg: 'com.wbd.stream' },
];

// Calm TV's own Settings, always last: off-screen until you scroll the dock to the end.
const settingsTile: App = { name: 'Settings', mark: icon('settings'), kind: 'settings' };

/**
 * Built-in icons by the package of the app they belong to, so an app chosen on the TV (Settings →
 * Arrange dock → Choose apps), or listed without an "icon", still gets its brand mark.
 */
const PKG_ICONS: Record<string, string> = {
  'com.google.android.youtube.tv': 'youtube',
  'com.google.android.youtube.tvkids': 'youtubekids',
  'com.google.android.youtube.tvmusic': 'youtubemusic',
  'com.netflix.ninja': 'netflix',
  'com.amazon.amazonvideo.livingroom': 'primevideo',
  'com.disney.disneyplus': 'disneyplus',
  'com.hulu.livingroomplus': 'hulu',
  'com.apple.atve.androidtv.appletv': 'appletv',
  'com.peacocktv.peacockandroid': 'peacock',
  'com.google.android.videos': 'googletv',
  'com.wbd.stream': 'hbomax',
  'com.cbs.ott': 'paramountplus',
  'com.crunchyroll.crunchyroid': 'crunchyroll',
  'com.tubitv': 'tubi',
  'tv.twitch.android.app': 'twitch',
  'com.plexapp.android': 'plex',
  'org.jellyfin.androidtv': 'jellyfin',
  'tv.emby.embyatv': 'emby',
  'org.xbmc.kodi': 'kodi',
  'com.spotify.tv.android': 'spotify',
  'com.aspiro.tidal': 'tidal',
  'com.valvesoftware.steamlink': 'steam',
  'com.nvidia.geforcenow': 'nvidia',
  'io.homeassistant.companion.android': 'homeassistant',
};

/** The dock: calm-tv.json's "apps" if it lists any, otherwise the lineup above, with this TV's own choices. */
export let apps: App[] = [];

/**
 * Call after loadConfig(), and again after Choose apps changes the dock. On the TV, apps that aren't
 * installed are hidden; in a browser, all show.
 */
export function loadApps(): void {
  const fromConfig = settings.config.apps
    ?.filter((a) => a.package)
    .map((a): App => ({ name: a.name, pkg: a.package, mark: markFor(a.name, a.icon, a.package) }));

  const listed = fromConfig?.length ? fromConfig : lineup;
  const choice = readChoice();
  // This TV's choices: apps taken off, and apps added (after the listed ones, in the order added).
  const list = [
    ...listed.filter((a) => !a.pkg || !choice.removed.includes(a.pkg)),
    ...choice.added
      .filter((x) => !listed.some((a) => a.pkg === x.pkg))
      .map((x): App => ({ name: x.name, pkg: x.pkg, mark: markFor(x.name, undefined, x.pkg) })),
  ];
  const installed = installedApps();
  const has = installed && new Set(installed.map((a) => a.pkg));
  apps = [...savedOrder(has ? list.filter((a) => !a.pkg || has.has(a.pkg)) : list), settingsTile];
}

// ---------- your own apps (Settings → Arrange dock → Choose apps), kept on this TV ----------

const CHOICE_KEY = demoMode ? 'calmtv.demo.dockChoice' : 'calmtv.dockChoice';

/** Apps this TV added to the dock (with their names) or took off it (by package), against calm-tv.json. */
const DockChoice = v.object({
  added: v.fallback(v.array(v.object({ pkg: v.string(), name: v.string() })), []),
  removed: v.fallback(v.array(v.string()), []),
});
type DockChoice = v.InferOutput<typeof DockChoice>;

function readChoice(): DockChoice {
  try {
    const saved = v.safeParse(DockChoice, JSON.parse(localStorage.getItem(CHOICE_KEY) ?? '{}'));

    // Copies: a fallback's [] is one shared array, and toggleDockApp changes these.
    return saved.success ? { added: [...saved.output.added], removed: [...saved.output.removed] } : { added: [], removed: [] };
  } catch {
    return { added: [], removed: [] };
  }
}

function writeChoice(c: DockChoice): void {
  try {
    if (!c.added.length && !c.removed.length) localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
  } catch { /* storage off: the choice lasts until the app restarts */ }
}

/** The apps this TV can open, for Choose apps: name, package, its mark, and whether it's on the dock. */
export function dockChoices(): { pkg: string; name: string; label: string; mark: string; on: boolean }[] {
  const on = new Set(apps.map((a) => a.pkg).filter(Boolean));

  return (installedApps() ?? [])
    // Without an icon, a row shows the name's first letter (the whole name won't fit).
    .map((a) => ({ pkg: a.pkg, name: esc(a.label), label: a.label, mark: markFor(a.label.slice(0, 1), undefined, a.pkg), on: on.has(a.pkg) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Puts an app on the dock (at the end, before Settings) or takes it off, then rebuilds the dock. */
export function toggleDockApp(pkg: string, name: string): void {
  const c = readChoice();
  const listed = (settings.config.apps?.filter((a) => a.package).map((a) => a.package) ?? []);
  const base = listed.length ? listed : lineup.map((a) => a.pkg);
  const onDock = apps.some((a) => a.pkg === pkg);

  if (onDock) {
    c.added = c.added.filter((x) => x.pkg !== pkg);

    if (base.includes(pkg) && !c.removed.includes(pkg)) c.removed.push(pkg);
  } else {
    c.removed = c.removed.filter((p) => p !== pkg);

    if (!base.includes(pkg)) c.added.push({ pkg, name });
  }

  writeChoice(c);
  loadApps();
}

/** True if this TV changed which apps are on the dock. */
export function hasDockChoice(): boolean {
  const c = readChoice();

  return c.added.length > 0 || c.removed.length > 0;
}

// ---------- your own order (Settings → Arrange dock), kept on this TV ----------

// Demo mode keeps its own, like state.ts and look.ts, so trying the demo on a real TV leaves its dock alone.
const ORDER_KEY = demoMode ? 'calmtv.demo.dockOrder' : 'calmtv.dockOrder';

/** What identifies a tile in the saved order. */
export const tileKey = (a: App) => a.pkg ?? a.kind ?? a.name;

/** The saved order: tile keys, first to last. */
const SavedOrder = v.array(v.string());

function readOrder(): string[] {
  try {
    const saved = v.safeParse(SavedOrder, JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]'));

    return saved.success ? saved.output : [];
  } catch {
    return [];
  }
}

/** Tiles in the saved order; ones it doesn't know yet (newly added) go after them, as listed. */
function savedOrder(list: App[]): App[] {
  const order = readOrder();

  if (!order.length) return list;

  const at = (a: App) => {
    const i = order.indexOf(tileKey(a));

    return i < 0 ? order.length : i;
  };

  return list.map((a, i) => ({ a, i })).sort((x, y) => at(x.a) - at(y.a) || x.i - y.i).map((x) => x.a);
}

/** Remembers the dock as it is now (Settings stays last either way). */
export function saveDockOrder(): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(apps.filter((a) => a.kind !== 'settings').map(tileKey)));
  } catch { /* storage off: the order lasts until the app restarts */ }
}

/** Back to calm-tv.json's dock: its apps, in its order. */
export function resetDockOrder(): void {
  try {
    localStorage.removeItem(ORDER_KEY);
    localStorage.removeItem(CHOICE_KEY);
  } catch { /* nothing saved */ }
}

export const hasDockOrder = () => readOrder().length > 0;


const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** An icon given as a file rather than a built-in name: "/local/calm-tv/icons/kodi.svg", "https://…". */
const isFile = (iconName: string) => iconName.includes('/') || /\.(svg|png|webp)$/i.test(iconName);

/**
 * A tile's mark: a built-in icon by name, your own file (shown as a white silhouette, like the
 * built-in ones; an SVG loaded as an image can't run code), or the app's name. Without an "icon",
 * the built-in icon for its package, else (on the TV) the app's own icon in colour, else its name.
 */
function markFor(name: string, iconName?: string, pkg?: string): string {
  if (!iconName) {
    const builtIn = pkg ? PKG_ICONS[pkg] : undefined;

    if (builtIn) return icon(builtIn);
    const own = pkg ? appIcon(pkg) : '';

    return own?.startsWith('data:image/') ? `<img class="mark-app" src="${own}" alt="">` : textMark(name);
  }

  if (isFile(iconName)) return `<img class="mark-img" src="${esc(haPath(iconName))}" alt="">`;

  return icon(iconName) || textMark(name);
}

/** Android's icons, asked for once each (a PNG across the bridge). */
const appIcons = new Map<string, string>();

function appIcon(pkg: string): string {
  let url = appIcons.get(pkg);

  if (url === undefined) {
    url = native?.appIcon?.(pkg) ?? '';
    appIcons.set(pkg, url);
  }

  return url;
}

/** An app without an icon file shows its name instead. */
function textMark(name: string): string {
  return `<span class="mark-text">${esc(name)}</span>`;
}
