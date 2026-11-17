import { isHeld } from './keys';

// The shared input layer for Calm TV's panels (a room, Settings, Music, the background picker…).
//
// A panel marks each thing you can land on with `data-focus="<id>"` and gives it a click listener
// for what it does. Everything else is here, the same for every panel:
//
//   - the remote's arrows move the focus to the nearest item that way, by where items are on screen;
//   - OK clicks the focused item, so OK and a tap (or a mouse click) always do the same thing;
//   - a tap or click first moves the focus there, and a mouse moves it by hovering;
//   - Back calls the panel's own `onBack`.
//
// So a panel built for the remote works by touch and mouse without any extra code, and the other
// way round. Ids are strings the panel chooses (e.g. "speaker-2"), so the focus survives a panel
// redrawing its markup: call paint() after a redraw.

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface FocusOptions {
  /** Back (or Escape / Backspace): close the panel, or go up a level. */
  onBack(): void;
  /**
   * Keys the panel handles itself before anything else, e.g. ←/→ on a dimmer. Return true when
   * handled. Gets the focused id (or null).
   */
  onKey?(e: KeyboardEvent, focused: string | null): boolean;
  /** After the focus moves, e.g. to scroll a shelf the panel moves itself. */
  onFocus?(id: string, el: HTMLElement): void;
  /** false when the panel brings the focused item into view itself (default true: the browser does). */
  scrollIntoView?: boolean;
  /**
   * At an edge, an arrow goes round to the far end of the same row or column (like the dock): true
   * for every arrow, 'sideways' for ← and → only. Not while the key is held, so holding it stops at
   * the end, and not from inside an element marked data-nowrap.
   */
  wrap?: boolean | 'sideways';
}

const ARROWS = new Map<string, Direction>([['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right']]);

/** The class that shows where the focus is. */
const FOCUS_CLASS = 'focus';

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export class FocusGroup {
  private focused: string | null = null;
  /** The last arrow move, so the opposite arrow goes back to where it came from (e.g. up to the close button and down again returns to the same column). */
  private lastMove: { from: string; dir: Direction } | null = null;

  constructor(private root: HTMLElement, private opts: FocusOptions) {
    // Clicks and taps: focus what was hit first, so a panel's click handler can rely on it.
    root.addEventListener('click', (e) => {
      const el = this.itemAt(e.target);

      if (el) this.set(el, false);
    }, true);
    // A mouse moves the focus by hovering (not a finger: it would light up whatever it brushes).
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = this.itemAt(e.target);

      if (el && el.dataset.focus !== this.focused) this.set(el, false);
    });
  }

  /** The focused item's id, or null. */
  get id(): string | null {
    return this.focused;
  }

  /** Moves the focus to the item `id` (or the first item, when it's missing). */
  focus(id: string | null): void {
    this.focused = id;
    this.lastMove = null;
    this.paint();
    const el = this.current();

    if (!el) return;
    this.reveal(el);

    if (this.focused) this.opts.onFocus?.(this.focused, el);
  }

  /** Re-applies the focus after the panel redrew its markup; falls back to the first item. */
  paint(): void {
    const items = this.items();

    // Nothing on show yet (e.g. the panel isn't visible): keep the wanted focus for later.
    if (!items.length) return;
    const el = items.find((i) => i.dataset.focus === this.focused) ?? items[0];
    this.focused = el.dataset.focus ?? null;
    items.forEach((i) => i.classList.toggle(FOCUS_CLASS, i === el));
  }

  /** The panel's keys: call from its handleKey. */
  handleKey(e: KeyboardEvent): void {
    const k = e.key;

    if (this.opts.onKey?.(e, this.focused)) return;

    if (k === 'Escape' || k === 'Backspace') {
      e.preventDefault();
      this.opts.onBack();

      return;
    }

    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      this.current()?.click();

      return;
    }

    const dir = ARROWS.get(k);

    if (!dir) return;
    e.preventDefault();
    this.move(dir, isHeld(e));
  }

  /** Moves the focus one step `dir`, to the nearest item that way; at an edge it stays put, or wraps (see `wrap`). */
  move(dir: Direction, held = false): void {
    const from = this.current();

    if (!from) {
      this.paint();

      return;
    }

    const others = this.items().filter((i) => i !== from);
    const back = this.lastMove && this.lastMove.dir === OPPOSITE[dir] ? others.find((i) => i.dataset.focus === this.lastMove?.from) : undefined;
    const next = back ?? nearest(from, others, dir) ?? (this.wraps(from, dir) && !held ? farthest(from, others, OPPOSITE[dir]) : null);

    if (!next) return;
    const fromId = this.focused;
    this.set(next, true);
    this.lastMove = fromId ? { from: fromId, dir } : null;
  }

  private wraps(from: HTMLElement, dir: Direction): boolean {
    const { wrap } = this.opts;

    if (!wrap || from.closest('[data-nowrap]')) return false;

    return wrap === true || dir === 'left' || dir === 'right';
  }

  private set(el: HTMLElement, reveal: boolean): void {
    this.lastMove = null;
    this.focused = el.dataset.focus ?? null;
    this.items().forEach((i) => i.classList.toggle(FOCUS_CLASS, i === el));

    if (reveal) this.reveal(el);

    if (this.focused) this.opts.onFocus?.(this.focused, el);
  }

  private reveal(el: HTMLElement): void {
    if (this.opts.scrollIntoView !== false) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private current(): HTMLElement | null {
    return this.items().find((i) => i.dataset.focus === this.focused) ?? null;
  }

  /** Items on show: in the markup, laid out, and not marked aria-disabled. */
  private items(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('[data-focus]')].filter(
      (el) => el.getAttribute('aria-disabled') !== 'true' && el.getClientRects().length > 0,
    );
  }

  private itemAt(target: EventTarget | null): HTMLElement | null {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-focus]') : null;

    return el && this.root.contains(el) && this.items().includes(el) ? el : null;
  }
}

/** The item furthest from `from` towards `dir` in the same row or column (for wrapping round). */
function farthest(from: HTMLElement, items: HTMLElement[], dir: Direction): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const vertical = dir === 'up' || dir === 'down';
  let best: HTMLElement | null = null;
  let bestAlong = 0;

  for (const el of items) {
    const b = el.getBoundingClientRect();
    // Only the same row (for ← →) or column (for ↑ ↓): wrapping never jumps diagonally.
    const lined = vertical ? b.left < a.right && a.left < b.right : b.top < a.bottom && a.top < b.bottom;

    if (!lined) continue;
    const along = vertical
      ? (dir === 'down' ? b.top - a.top : a.top - b.top)
      : (dir === 'right' ? b.left - a.left : a.left - b.left);

    if (along > bestAlong) {
      bestAlong = along;
      best = el;
    }
  }

  return best;
}

/**
 * The nearest item from `from` towards `dir`. Items lined up with it (overlapping across the
 * direction of travel) always win over ones off to the side, so moving along a row stays in it, and
 * down a column too; only when nothing is lined up does the nearest one off to the side count.
 */
export function nearest(from: HTMLElement, items: HTMLElement[], dir: Direction): HTMLElement | null {
  const a = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of items) {
    const b = el.getBoundingClientRect();
    const vertical = dir === 'up' || dir === 'down';

    // Distance along the direction of travel, between the two centres.
    const along = vertical
      ? (dir === 'down' ? b.top + b.height / 2 - (a.top + a.height / 2) : a.top + a.height / 2 - (b.top + b.height / 2))
      : (dir === 'right' ? b.left + b.width / 2 - (a.left + a.width / 2) : a.left + a.width / 2 - (b.left + b.width / 2));

    if (along <= 1) continue; // not that way

    // Gap across the direction of travel (0 when they overlap).
    const across = vertical
      ? Math.max(0, b.left - a.right, a.left - b.right)
      : Math.max(0, b.top - a.bottom, a.top - b.bottom);

    // Lined up (overlapping across the way you move) always wins: → from the first button of a row
    // goes to the next one, never diagonally to a closer button on a staggered row below.
    const score = (across > 0 ? 100000 : 0) + along + across * 3;

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}
