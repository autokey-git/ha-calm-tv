import { dashboardMode } from './config';

// How a screen's row of cards (rooms, calendar events, forecast days) slides.
//
// With the remote, the row is clipped and its track is moved by the focus: the screen keeps the
// focused card in view, one step at a time, which is what arrow keys expect.
//
// On a touch screen (the Home Assistant dashboard) a row is something you grab and throw: here it
// becomes a real scrolling strip, so it follows the finger, keeps its momentum and slows down by
// itself, all done by the browser. A focused card is only scrolled into view when it's off screen.

const prepared = new WeakSet<HTMLElement>();

/** The fades at the row's ends follow the scroll position on a touch screen. */
function paintFades(shelf: HTMLElement): void {
  const canLeft = shelf.scrollLeft > 2;
  const canRight = shelf.scrollLeft + shelf.clientWidth < shelf.scrollWidth - 2;
  shelf.classList.toggle('fade-lr', canLeft && canRight);
  shelf.classList.toggle('fade-r', canRight && !canLeft);
}

function prepare(shelf: HTMLElement): void {
  if (prepared.has(shelf)) return;
  prepared.add(shelf);
  shelf.classList.add('touch-row');
  shelf.addEventListener('scroll', () => paintFades(shelf), { passive: true });
}

/**
 * Places a row: `tx` is where the remote's layout would move the track (negative = scrolled,
 * zero or more = centred because everything fits), and `focused` the focused card, if any.
 * Call it where a section would otherwise set the track's transform.
 */
export function slideRow(shelf: HTMLElement, track: HTMLElement, tx: number, focused?: HTMLElement): void {
  if (!dashboardMode) {
    track.style.transform = `translateX(${tx}px)`;

    return;
  }

  prepare(shelf);

  track.style.transform = 'none';

  // Everything fits: keep the remote layout's centring, nothing to scroll.
  if (shelf.scrollWidth <= shelf.clientWidth + 1) {
    track.style.transform = `translateX(${Math.max(0, tx)}px)`;
    shelf.scrollLeft = 0;
  } else {
    // Otherwise the finger owns the position; only bring the focused card into view if it's off screen.
    if (focused) {
      const left = focused.offsetLeft;
      const right = left + focused.offsetWidth;

      if (left < shelf.scrollLeft) shelf.scrollTo({ left, behavior: 'smooth' });
      else if (right > shelf.scrollLeft + shelf.clientWidth) shelf.scrollTo({ left: right - shelf.clientWidth, behavior: 'smooth' });
    }
  }

  // After the section's own fade classes (some set them after placing the track).
  requestAnimationFrame(() => paintFades(shelf));
}
