import { ha } from './ha';
import { settings } from './config';
import { native } from './native';

// A small pop-up in the corner whenever a door opens: an open door and the door's name, for a few
// seconds, over whatever is on screen. Calm TV draws it itself while it's in front; over other apps
// the TV app draws it (see DoorPopups.kt), so the show keeps playing. A door still open after a
// while pops up again with a red "!" and "Left open". Doors come from calm-tv.json's "doors".

/** How long each pop-up stays, in ms. */
const SHOW_MS = 5000;

/** An open door: frame, the door swung towards you, and its handle. */
export const DOOR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 21.5h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M6 21.5V3.5h12v18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <path d="M6 3.5l8 2.2v17.3L6 21.5z" fill="currentColor"/>
  <circle cx="11.6" cy="13.6" r="1.1" fill="#15181b"/>
</svg>`;

interface Door {
  name: string;
  entity: string;
}

const doors = (): Door[] => (settings.config.doors?.popup === false ? [] : settings.config.doors?.entities ?? []);

/** Watches the doors and shows the pop-ups. `mount` is the page's stage, for pop-ups inside Calm TV. */
export function watchDoors(mount: HTMLElement): void {
  const stack = document.createElement('div');
  stack.className = 'door-pops';
  mount.appendChild(stack);

  const show = (door: Door, left: boolean) => {
    // Over another app, the TV app draws it (no pausing); if it can't, Calm TV shows it when back in front.
    if (native?.isInFront && !native.isInFront() && native.showDoor?.(JSON.stringify({ name: door.name, left }))) return;

    const el = document.createElement('div');
    el.className = `door-pop${left ? ' left' : ''}`;
    el.innerHTML = `<span class="door-pop-ico">${DOOR_ICON}${left ? '<b>!</b>' : ''}</span><span class="door-pop-text"><span class="door-pop-name"></span>${left ? '<span class="door-pop-sub">Left open</span>' : ''}</span>`;
    const name = el.querySelector('.door-pop-name');

    if (name) name.textContent = door.name;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    window.setTimeout(() => {
      el.classList.remove('in');
      window.setTimeout(() => el.remove(), 400);
    }, SHOW_MS);
  };

  /** Each door's last known state; a door only pops up when it changes to open (not when we connect). */
  const was = new Map<string, string>();
  const timers = new Map<string, number>();

  ha.onEntities(() => {
    if (ha.status !== 'connected') return;

    for (const door of doors()) {
      const state = ha.entities[door.entity]?.state;

      if (!state) continue;
      const before = was.get(door.entity);
      was.set(door.entity, state);

      if (before === undefined || before === state) continue;
      clearTimeout(timers.get(door.entity));
      timers.delete(door.entity);

      if (state !== 'on') continue;
      show(door, false);
      const after = (settings.config.doors?.leftOpen ?? 10) * 1000;
      timers.set(door.entity, window.setTimeout(() => {
        timers.delete(door.entity);
        if (ha.entities[door.entity]?.state === 'on') show(door, true);
      }, after));
    }
  });
}
