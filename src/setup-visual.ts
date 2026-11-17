import { ROOM_ICONS, SCREENS, type RoomConfig, type ScreenName } from './config';
import { areaRooms } from './areas';
import { ha } from './ha';

// The setup editor's "Screens & rooms" tab (setup-editor.ts): the parts of the setup that are
// easier to arrange than to type. It changes the same JSON as the Text tab.

/** The setup being edited, as plain JSON. */
export type SetupJson = Record<string, unknown> & { screens?: string[]; rooms?: RoomConfig[]; music?: unknown };

const SCREEN_NAMES: Record<Exclude<ScreenName, 'apps'>, string> = {
  smarthome: 'Smart Home', music: 'Music', calendar: 'Calendar', weather: 'Weather',
};

const ICON_NAMES: Record<(typeof ROOM_ICONS)[number], string> = {
  couch: 'Sofa', cutlery: 'Kitchen', desk: 'Desk', bed: 'Bed', stairs: 'Stairs', house: 'House',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Devices in a room, for its summary line. */
const deviceCount = (r: RoomConfig) => {
  const n = r.groups.reduce((sum, g) => sum + (g.devices?.length ?? 0), 0);

  return `${n} device${n === 1 ? '' : 's'}`;
};

/**
 * Draws the tab into `el` for `setup`, calling `changed` after each change (the caller then
 * rewrites the text). Returns a function that draws it again.
 */
export function visualSetup(el: HTMLElement, setup: () => SetupJson, changed: () => void): () => void {
  /** Rooms built from the Areas, once asked for (to show, or to start your own list from). */
  let areas: RoomConfig[] | null = null;
  let areasProblem = '';
  /** Your own list while trying "From my areas", so switching back doesn't lose it. */
  let stash: RoomConfig[] | null = null;

  const loadAreas = () => {
    const link = ha.connection;

    if (areas || !link) return;
    areaRooms(link, ha.entities)
      .then((r) => { areas = r; })
      .catch(() => { areasProblem = 'Home Assistant didn’t share its areas'; })
      .finally(draw);
  };

  // ---------- screens ----------
  const screenOrder = (s: SetupJson): { name: Exclude<ScreenName, 'apps'>; on: boolean }[] => {
    const all = SCREENS.filter((n): n is Exclude<ScreenName, 'apps'> => n !== 'apps');
    const listed = (s.screens ?? SCREENS).filter((n): n is Exclude<ScreenName, 'apps'> => (all as string[]).includes(n));

    return [...new Set(listed)].map((name) => ({ name, on: true }))
      .concat(all.filter((n) => !listed.includes(n)).map((name) => ({ name, on: false })));
  };

  const setScreens = (list: { name: string; on: boolean }[]) => {
    const s = setup();
    const on = list.filter((x) => x.on).map((x) => x.name);
    const isDefault = on.join() === SCREENS.filter((n) => n !== 'apps').join();

    if (isDefault) delete s.screens;
    else s.screens = ['apps', ...on];
    changed();
  };

  // ---------- rooms ----------
  const setRooms = (rooms: RoomConfig[] | undefined) => {
    const s = setup();

    if (rooms) s.rooms = rooms;
    else delete s.rooms;
    changed();
  };

  const move = <T>(list: T[], i: number, by: number): T[] => {
    const j = i + by;

    if (j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];

    return out;
  };

  function draw(): void {
    const s = setup();
    const screens = screenOrder(s);
    const own = Array.isArray(s.rooms);
    const rooms = own ? s.rooms ?? [] : [];

    loadAreas();
    const fromAreas = areas ?? [];
    const notListed = fromAreas.filter((a) => !rooms.some((r) => r.name === a.name));

    el.innerHTML = `
      <section class="vs-card vs-screens">
        <div class="vs-title">Screens</div>
        <div class="vs-note">In this order, under Apps. Tap to turn one on or off.</div>
        ${screens.map((x, i) => `
          <div class="vs-row${x.on ? '' : ' off'}">
            <label class="vs-check"><input type="checkbox" data-screen="${i}"${x.on ? ' checked' : ''}>
              <span>${SCREEN_NAMES[x.name]}${x.name === 'music' && !s.music ? '<em>needs "music" in the setup</em>' : ''}</span></label>
            <button class="vs-mini" data-screen-up="${i}" aria-label="Up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button class="vs-mini" data-screen-down="${i}" aria-label="Down"${i === screens.length - 1 ? ' disabled' : ''}>↓</button>
          </div>`).join('')}
      </section>
      <section class="vs-card vs-rooms">
        <div class="vs-title">Rooms</div>
        <div class="vs-switch">
          <button data-rooms="areas" class="${own ? '' : 'on'}">From my areas</button>
          <button data-rooms="own" class="${own ? 'on' : ''}">My own list</button>
        </div>
        ${own ? `
          <div class="vs-note">Reorder, rename or remove rooms. What's in each room is in the Text tab.</div>
          <div class="vs-list">
            ${rooms.map((r, i) => `
              <div class="vs-row">
                <select class="vs-icon" data-room-icon="${i}" aria-label="Icon">
                  ${ROOM_ICONS.map((ic) => `<option value="${ic}"${(r.icon ?? 'house') === ic ? ' selected' : ''}>${ICON_NAMES[ic]}</option>`).join('')}
                </select>
                <input class="vs-name" data-room-name="${i}" value="${esc(r.name)}" aria-label="Name">
                <span class="vs-count">${deviceCount(r)}</span>
                <button class="vs-mini" data-room-up="${i}" aria-label="Up"${i === 0 ? ' disabled' : ''}>↑</button>
                <button class="vs-mini" data-room-down="${i}" aria-label="Down"${i === rooms.length - 1 ? ' disabled' : ''}>↓</button>
                <button class="vs-mini" data-room-remove="${i}" aria-label="Remove">✕</button>
              </div>`).join('') || '<div class="vs-note">No rooms yet.</div>'}
          </div>
          ${notListed.length ? `
            <div class="vs-add">
              <select data-add-area aria-label="Area">${notListed.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join('')}</select>
              <button class="vs-btn" data-add>Add this area as a room</button>
            </div>` : ''}` : `
          <div class="vs-note">One room per Home Assistant area, with its main controls and scenes. Tidy them in Home Assistant: rename or reorder areas, turn an entity's Visible off, or give it the label "Hide in Calm TV".</div>
          <div class="vs-list">
            ${areasProblem ? `<div class="vs-note">${areasProblem}</div>` : !areas ? '<div class="vs-note">Asking Home Assistant…</div>'
              : fromAreas.map((r) => `<div class="vs-row"><span class="vs-name ro">${esc(r.name)}</span><span class="vs-count">${deviceCount(r)}</span></div>`).join('')}
          </div>`}
      </section>`;
  }

  // Inputs change the setup without drawing again (so typing a name keeps its place).
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;

    if (t.dataset.roomName !== undefined) {
      const rooms = setup().rooms;
      const r = rooms?.[Number(t.dataset.roomName)];

      if (r && t.value.trim()) {
        r.name = t.value;
        changed();
      }
    }
  });

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement & HTMLSelectElement;
    const s = setup();

    if (t.dataset.screen !== undefined) {
      const list = screenOrder(s);
      list[Number(t.dataset.screen)].on = t.checked;
      setScreens(list);
      draw();
    } else if (t.dataset.roomIcon !== undefined && s.rooms) {
      s.rooms[Number(t.dataset.roomIcon)].icon = t.value as RoomConfig['icon'];
      changed();
    }
  });

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');

    if (!b) return;
    const s = setup();
    const d = b.dataset;
    const rooms = s.rooms ?? [];

    if (d.screenUp !== undefined) setScreens(move(screenOrder(s), Number(d.screenUp), -1));
    else if (d.screenDown !== undefined) setScreens(move(screenOrder(s), Number(d.screenDown), 1));
    else if (d.roomUp !== undefined) setRooms(move(rooms, Number(d.roomUp), -1));
    else if (d.roomDown !== undefined) setRooms(move(rooms, Number(d.roomDown), 1));
    else if (d.roomRemove !== undefined) setRooms(rooms.filter((_, i) => i !== Number(d.roomRemove)));
    else if (d.add !== undefined) {
      const pick = el.querySelector<HTMLSelectElement>('[data-add-area]');
      const notListed = (areas ?? []).filter((a) => !rooms.some((r) => r.name === a.name));
      const area = notListed[Number(pick?.value ?? -1)];

      if (area) setRooms([...rooms, structuredClone(area)]);
    } else if (d.rooms === 'areas' && Array.isArray(s.rooms)) {
      stash = s.rooms;
      setRooms(undefined);
    } else if (d.rooms === 'own' && !Array.isArray(s.rooms)) {
      // Back to the list you had, or start one from your areas, as they are now.
      if (stash) setRooms(stash);
      else if (areas) setRooms(structuredClone(areas));
      else return;
    } else return;

    draw();
  });

  return draw;
}
