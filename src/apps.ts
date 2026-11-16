import type { App } from './types';
import { icon } from './icons';
import { installedPackages } from './native';
import { haPath, settings } from './config';

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

/** The dock: calm-tv.json's "apps" if it lists any, otherwise the lineup above. */
export let apps: App[] = [];

/** Call after loadConfig(). On the TV, apps that aren't installed are hidden; in a browser, all show. */
export function loadApps(): void {
  const fromConfig = settings.config.apps
    ?.filter((a) => a.package || a.open)
    .map((a): App => (a.open === 'music' ? { ...musicTile, name: a.name, mark: a.icon ? markFor(a.name, a.icon) : musicTile.mark } : { name: a.name, pkg: a.package, mark: markFor(a.name, a.icon) }));
  let list = fromConfig?.length ? fromConfig : lineup;

  // With "music" in calm-tv.json, the Music tile comes first unless "apps" places it.
  if (settings.config.music && !list.some((a) => a.kind === 'music')) list = [musicTile, ...list];
  const installed = installedPackages();
  apps = [...(installed ? list.filter((a) => !a.pkg || installed.has(a.pkg)) : list), settingsTile];
}

/** Calm TV's Music panel (sections/music-panel.ts). */
const musicTile: App = { name: 'Music', mark: icon('music'), kind: 'music' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** An icon given as a file rather than a built-in name: "/local/calm-tv/icons/kodi.svg", "https://…". */
const isFile = (iconName: string) => iconName.includes('/') || /\.(svg|png|webp)$/i.test(iconName);

/**
 * A tile's mark: a built-in icon by name, your own file (shown as a white silhouette, like the
 * built-in ones; an SVG loaded as an image can't run code), or the app's name.
 */
function markFor(name: string, iconName?: string): string {
  if (!iconName) return textMark(name);

  if (isFile(iconName)) return `<img class="mark-img" src="${esc(haPath(iconName))}" alt="">`;

  return icon(iconName) || textMark(name);
}

/** An app without an icon file shows its name instead. */
function textMark(name: string): string {
  return `<span class="mark-text">${esc(name)}</span>`;
}
