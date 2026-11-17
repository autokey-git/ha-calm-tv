## What this changes

<!-- A sentence or two, and a screenshot if it changes what's on screen. -->

## Checklist

- [ ] Works with the remote: arrows, OK and Back. Try it in a browser at `localhost:5173/?demo`.
- [ ] Also works by touch, for the Home Assistant dashboard: try `localhost:5173/?demo&dash`.
      New panels get this for free by marking items with `data-focus` (see `src/focus.ts`);
      new hints that name a remote key go in `src/hints.ts`, with their touch wording.
- [ ] `npm test` passes (it also runs on this pull request).
- [ ] No personal details: entity ids, addresses, names, photos or clips from a real home.
