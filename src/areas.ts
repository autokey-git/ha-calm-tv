import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { ha, type HaLink } from './ha';
import type { DeviceConfig, RoomConfig, RoomIcon } from './config';
import type { DeviceType, Zone } from './types';
import { roomsFrom, setAreaRooms, shortName, zoneFrom } from './home-data';
import {
  AreaSchema, attributes, decodeList, DeviceRegistrySchema, EntityDisplaySchema, FloorSchema,
  LightGroupAttributes, SensorAttributes, type Area, type EntityDisplay, type Floor,
} from './ha-data';

// Rooms built from Home Assistant's Areas, for a calm-tv.json without "rooms": one room per Area,
// in floor order, holding what's useful from the couch. Home Assistant's own setup decides:
// a device is in the room its Area says, and something is left out by turning its entity's
// "Visible" off in Home Assistant, or giving the entity or its device the label "Hide in Calm TV".
//
// For controls, only a device's *main* entity counts (Home Assistant gives it no name of its own): a
// lamp's light, not its "Segment 3" or "Music mode"; a plug's switch, not a vacuum dock's "Dust
// emptying". Open/closed sensors are usually a named part of something else (a garage door opener's
// "Door", a lock's "Door"), so they count by their kind alone; so do scenes.

/** Home Assistant's id for a label named "Hide in Calm TV". */
export const HIDE_LABEL = 'hide_in_calm_tv';

/** The groups in a room, in this order, and their titles. */
const GROUPS: { type: DeviceType | 'scenes'; title: string }[] = [
  { type: 'light', title: 'Lights' },
  { type: 'scenes', title: 'Scenes' },
  { type: 'switch', title: 'Plugs' },
  { type: 'cover', title: 'Curtains & blinds' },
  { type: 'climate', title: 'Climate' },
  { type: 'sensor', title: 'Doors & windows' },
  { type: 'lock', title: 'Locks' },
  { type: 'camera', title: 'Cameras' },
];

/** Covers that are doors: a room panel moves a cover on one press, so these stay out (see the ★ panel's `control`). */
const DOOR_COVERS = ['garage', 'gate', 'door'];

/** Open/closed sensors shown in a room. */
const OPENINGS = ['door', 'garage_door', 'window', 'opening'];

/** The icon for a room, from its Area's icon or name. */
function iconFor(area: Area): RoomIcon {
  const s = `${area.icon ?? ''} ${area.name}`.toLowerCase();

  if (/sofa|couch|living|lounge|family|television|tv\b/.test(s)) return 'couch';
  if (/kitchen|dining|stove|food|silverware|pantry/.test(s)) return 'cutlery';
  if (/office|desk|study|monitor|laptop|library/.test(s)) return 'desk';
  if (/bed|nursery|guest|sleep/.test(s)) return 'bed';
  if (/hall|stair|landing|entry|foyer/.test(s)) return 'stairs';

  return 'house';
}

/** "master bedroom" → "Master bedroom". */
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** What a main entity is in a room, if anything. */
function kind(e: EntityDisplay, s: HassEntity | undefined): DeviceType | 'scenes' | null {
  const domain = e.ei.split('.')[0];
  const deviceClass = s ? attributes(s, SensorAttributes).device_class : undefined;

  switch (domain) {
    case 'light': {
      // A group (Hue room, HA light group) repeats its lamps: show the lamps.
      const g = s ? attributes(s, LightGroupAttributes) : undefined;

      return g?.entity_id?.length || g?.is_hue_group ? null : 'light';
    }

    case 'switch': return 'switch';
    case 'cover': return deviceClass && DOOR_COVERS.includes(deviceClass) ? null : 'cover';
    case 'climate': return 'climate';
    case 'binary_sensor': return deviceClass && OPENINGS.includes(deviceClass) ? 'sensor' : null;
    case 'lock': return 'lock';
    case 'camera': return 'camera';
    case 'scene': return 'scenes';
    default: return null;
  }
}

/** One message to Home Assistant (a refusal rejects). */
async function ask(link: HaLink, type: string): Promise<unknown> {
  return link.sendMessagePromise<unknown>({ type });
}

/** The rooms built from Areas, ready to show. */
export async function roomsFromAreas(link: HaLink, ents: HassEntities): Promise<Zone[]> {
  return (await areaRooms(link, ents)).map(zoneFrom);
}

/**
 * The rooms, one per Area that has anything to show, written as calm-tv.json would write them (so
 * the setup page can turn them into your own list). Throws when Home Assistant won't give the
 * lists (the caller says so on the Smart Home screen).
 */
export async function areaRooms(link: HaLink, ents: HassEntities): Promise<RoomConfig[]> {
  const [areasRaw, floorsRaw, devicesRaw, displayRaw] = await Promise.all([
    ask(link, 'config/area_registry/list'),
    // Older Home Assistant has no floors: then areas keep their own order.
    ask(link, 'config/floor_registry/list').catch(() => []),
    ask(link, 'config/device_registry/list'),
    ask(link, 'config/entity_registry/list_for_display'),
  ]);
  const areas = decodeList(areasRaw, AreaSchema);
  const floors = decodeList(floorsRaw, FloorSchema);
  const devices = new Map(decodeList(devicesRaw, DeviceRegistrySchema).map((d) => [d.id, d]));
  const listed = displayRaw && typeof displayRaw === 'object' && 'entities' in displayRaw ? displayRaw.entities : [];
  const entities = decodeList(listed, EntityDisplaySchema);

  // What each Area holds, by kind.
  const byArea = new Map<string, Map<DeviceType | 'scenes', string[]>>();

  for (const e of entities) {
    const device = e.di ? devices.get(e.di) : undefined;

    if (e.hb || e.ec !== undefined || device?.disabled_by) continue;

    if (e.lb.includes(HIDE_LABEL) || device?.labels.includes(HIDE_LABEL)) continue;

    const area = e.ai ?? device?.area_id;

    if (!area) continue;
    const k = kind(e, ents[e.ei]);

    if (!k) continue;

    // Controls: a device's main entity only (it has no name of its own).
    if (e.en && k !== 'sensor' && k !== 'scenes') continue;
    const kinds = byArea.get(area) ?? new Map<DeviceType | 'scenes', string[]>();
    kinds.set(k, [...(kinds.get(k) ?? []), e.ei]);
    byArea.set(area, kinds);
  }

  return sortAreas(areas, floors).flatMap((area) => {
    const kinds = byArea.get(area.area_id);

    if (!kinds) return [];
    const room = capFirst(area.name);
    const byName = (a: DeviceConfig, b: DeviceConfig) => (a.name ?? '').localeCompare(b.name ?? '');
    const groups = GROUPS.flatMap(({ type, title }) => {
      const ids = kinds.get(type) ?? [];

      if (!ids.length) return [];

      if (type === 'scenes') {
        const scenes = ids.map((id) => ({ id, name: shortName(ents[id], id, room) })).sort((a, b) => a.name.localeCompare(b.name));

        return [{
          title,
          devices: [{ type: 'scene' as const, entity: `scenes.${area.area_id}`, name: 'Scene', scenes: scenes.map((x) => x.id) }],
        }];
      }

      return [{ title, devices: ids.map((id): DeviceConfig => ({ type, entity: id, name: shortName(ents[id], id, room) })).sort(byName) }];
    });
    const locks = groups.flatMap((g) => g.devices).filter((d) => d.type === 'lock').map((d) => d.entity);

    return [{ name: room, icon: iconFor(area), ...(locks.length ? { locks } : {}), groups }];
  });
}

/** Areas by floor (lowest level first; areas without a floor last), each floor's in Home Assistant's order. */
function sortAreas(areas: Area[], floors: Floor[]): Area[] {
  const rank = new Map(floors.map((f, i) => [f.floor_id, [f.level ?? 1e6, i]]));
  const key = (a: Area) => (a.floor_id ? rank.get(a.floor_id) : undefined) ?? [2e6, 0];

  return areas
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const [lx, ix] = key(x.a);
      const [ly, iy] = key(y.a);

      return lx - ly || ix - iy || x.i - y.i;
    })
    .map((x) => x.a);
}

/**
 * Without "rooms" in calm-tv.json: builds the rooms from Areas once connected (and the states are
 * in, for names and device classes), and again after each reconnect, so a device moved to another
 * Area in Home Assistant moves here too. Screens follow with onZonesChange (home-data.ts).
 */
export function watchAreaRooms(): void {
  if (roomsFrom !== 'areas') return;
  let waiting: HaLink | null = null;
  const build = (link: HaLink) => {
    roomsFromAreas(link, ha.entities)
      .then((rooms) => setAreaRooms(rooms))
      .catch((e: unknown) => {
        console.warn('Rooms from Areas', e);
        setAreaRooms([], 'Home Assistant didn’t share its areas with this user');
      });
  };

  ha.onConnected((link) => {
    if (Object.keys(ha.entities).length) build(link);
    else waiting = link;
  });
  ha.onEntities(() => {
    if (!waiting || !Object.keys(ha.entities).length) return;
    const link = waiting;
    waiting = null;
    build(link);
  });
}
