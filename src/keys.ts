// Is this key press a held-down key repeating, or a new press?
//
// Browsers mark a held key's repeats with `event.repeat`, but the TV's web view doesn't: a remote
// button held down arrives as a stream of ordinary key-downs. So this also remembers which keys are
// down: a key-down for a key that hasn't been let go since its last key-down is a repeat.
//
// Used wherever holding a button should behave differently from pressing it: rows and menus stop at
// their ends instead of wrapping round, and a held OK only counts once.

const down = new Set<string>();
let lastHeld = false;

// Capture phase on the document, so this runs before any panel's own key handling.
document.addEventListener('keydown', (e) => {
  lastHeld = e.repeat || down.has(e.key);
  down.add(e.key);
}, true);
document.addEventListener('keyup', (e) => { down.delete(e.key); }, true);
// A key let go while the app wasn't looking (another app, a dialog) would otherwise stay "down".
window.addEventListener('blur', () => down.clear());

/** True when `e` (the key-down being handled) is a held key repeating, not a new press. */
export function isHeld(e: KeyboardEvent): boolean {
  return e.repeat || lastHeld;
}
