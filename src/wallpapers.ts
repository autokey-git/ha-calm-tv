import type { Wallpaper } from './types';
import { groupByPhase } from './variants';

// Auto-discover every image dropped into src/wallpapers/.
// Add real photos there (jpg/png/webp) and they appear automatically — no code changes needed.
const modules = import.meta.glob<string>('./wallpapers/*.{jpg,jpeg,png,webp,avif,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
});

function prettyName(path: string): string {
  const file = path.split('/').pop() ?? path;

  const base = file
    .replace(/\.[^.]+$/, '') // extension
    .replace(/^\d+[-_\s]*/, '') // leading sort digits e.g. "01-"
    .replace(/[-_]+/g, ' ')
    .trim();

  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : file;
}

// Last-resort fallback so the app always has something to show.
const FALLBACK: Wallpaper = {
  name: 'Slate',
  url:
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#2c3e52'/><stop offset='1' stop-color='#141a20'/></linearGradient></defs><rect width='1920' height='1080' fill='url(#g)'/></svg>"
    ),
};

// "NN-name.dawn.jpg", "NN-name.night.jpg"…: one photo with a version per time of day (variants.ts).
const found: Wallpaper[] = groupByPhase(Object.keys(modules).sort(), (path) => modules[path]).map((s) => ({
  name: prettyName(s.key),
  url: s.url,
  variants: s.variants,
}));

export const wallpapers: Wallpaper[] = found.length > 0 ? found : [FALLBACK];
