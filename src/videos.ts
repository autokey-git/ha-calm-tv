import type { SceneMap } from './sky-fx';
import { groupByPhase, type Variants } from './variants';

// Auto-discover every looping clip dropped into src/videos/ (1080p mp4, no audio, ideally under ~20 MB:
// each clip is loaded whole into memory to loop smoothly). A .jpg with the same name is its thumbnail
// in the background picker. They ship inside the TV app like the photos; nothing is hosted anywhere.
const clips = import.meta.glob<string>('./videos/*.{mp4,webm}', { eager: true, query: '?url', import: 'default' });
const thumbs = import.meta.glob<string>('./videos/*.jpg', { eager: true, query: '?url', import: 'default' });

export interface Clip {
  name: string;
  url: string;
  /** Versions for the times of day (NN-name.night.mp4 …), if it has them; see variants.ts. */
  variants?: Variants;
  /** Where its sky, water and ground are, for the weather (see sky-fx.ts). */
  map?: SceneMap;
  /** Small still for the picker ('' if there isn't one). */
  thumb: string;
}

function prettyName(path: string): string {
  const file = path.split('/').pop() ?? path;
  const base = file.replace(/\.[^.]+$/, '').replace(/^\d+[-_\s]*/, '').replace(/[-_]+/g, ' ').trim();

  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : file;
}

/** Bundled clips, then any listed in calm-tv.json (added by main.ts). */
export const videos: Clip[] = groupByPhase(Object.keys(clips).sort(), (path) => clips[path]).map((s) => ({
  name: prettyName(s.key),
  url: s.url,
  variants: s.variants,
  thumb: thumbs[s.key.replace(/\.[^.]+$/, '.jpg')] ?? '',
}));
