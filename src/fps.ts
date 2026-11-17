/**
 * A small frame-rate readout in the corner (Settings → Appearance → Show frame rate), for comparing
 * settings on the TV itself: frames in the last second, and the longest single frame in that second.
 * At 60 fps a frame takes about 17 ms; a stutter shows up as one long frame (e.g. "worst 50 ms").
 */

let el: HTMLElement | null = null;
let running = false;
let frames = 0;
let worst = 0;
let last = 0;
let windowStart = 0;

function tick(now: number): void {
  if (!running || !el) return;

  if (last) worst = Math.max(worst, now - last);
  last = now;
  frames++;

  if (now - windowStart >= 1000) {
    const fps = Math.round((frames * 1000) / (now - windowStart));
    el.textContent = `${fps} fps · worst ${Math.round(worst)} ms`;
    el.classList.toggle('slow', fps < 50 || worst > 34);
    frames = 0;
    worst = 0;
    windowStart = now;
  }

  requestAnimationFrame(tick);
}

/** Shows or hides the counter. */
export function fpsCounter(on: boolean): void {
  if (on === running) return;
  running = on;

  if (!on) {
    el?.remove();
    el = null;

    return;
  }

  el = document.createElement('div');
  el.className = 'fps';
  el.textContent = '… fps';
  (document.querySelector('#stage') ?? document.body).appendChild(el);
  last = 0;
  frames = 0;
  worst = 0;
  windowStart = performance.now();
  requestAnimationFrame(tick);
}
