// Backgrounds can come in four versions, one per time of day, named like
// "00-mountain-lake.dawn.jpg", "00-mountain-lake.day.jpg", "….dusk.jpg", "….night.jpg" (the same for
// videos). They're one background in the picker, and the living sky (sky.ts) shows the version for
// the time of day. A background without versions gets a code-only look instead.

export const PHASES = ['dawn', 'day', 'dusk', 'night'] as const;

export type Phase = (typeof PHASES)[number];

export type Variants = Partial<Record<Phase, string>>;

/** "dir/00-lake.night.jpg" → { key: "dir/00-lake.jpg", phase: "night" }; other names have no phase. */
export function splitPhase(path: string): { key: string; phase?: Phase } {
  const m = /^(.*)\.(dawn|day|dusk|night)(\.[^./]+)$/.exec(path);
  const phase = PHASES.find((p) => p === m?.[2]);

  return m && phase ? { key: m[1] + m[3], phase } : { key: path };
}

/**
 * Groups files into backgrounds: each key once, in order, with its versions. The plain file (or the
 * day version) is the background's main picture.
 */
export function groupByPhase(paths: string[], url: (path: string) => string): { key: string; url: string; variants?: Variants }[] {
  const out = new Map<string, { key: string; url: string; variants?: Variants }>();

  for (const path of paths) {
    const { key, phase } = splitPhase(path);
    const entry = out.get(key) ?? { key, url: '' };
    out.set(key, entry);

    if (!phase) {
      entry.url = url(path);
      continue;
    }

    entry.variants = { ...entry.variants, [phase]: url(path) };

    if (!entry.url || phase === 'day') entry.url = url(path);
  }

  return [...out.values()];
}
