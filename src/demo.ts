import type { HassEntities, HassEntity, MessageBase } from 'home-assistant-js-websocket';
import * as v from 'valibot';
import exampleConfig from '../config/calm-tv.example.json?raw';
import doorbellView from './demo-media/doorbell-camera.mp4?url';
import { decodeConfig, settings, dashboardMode } from './config';
import { ha, type HaLink } from './ha';
import { demoCameras } from './camera-stream';
import type { BrowseNode, CalendarEvent, CalendarResponse, ForecastEntry, ForecastMessage } from './ha-data';
import { videos } from './videos';
import { wallpapers } from './wallpapers';
import { showRemote } from './demo-remote';
import { sky, PHASES } from './sky';
import { ma } from './music-assistant';
import artA from './demo-media/album-echoes.jpg?url';
import artB from './wallpapers/01-stylized-forest-brook.jpg?url';

/**
 * Demo mode (index.html?demo): the whole app against a made-up home, with no Home Assistant.
 * For trying Calm TV in a browser and for recording the README's animations.
 *
 *  - The home is config/calm-tv.example.json; its lights, scenes, curtains and thermostat respond.
 *  - Sample calendar events, tonight's dinner and a week of weather are made around today.
 *  - Cameras show a placeholder doorbell view (src/demo-media/) as their live view.
 *  - Only the backgrounds shipped in the repo are offered.
 *  - ?demo&at=2026-11-14T18:30 sets the clock (it keeps running from there), so recordings match.
 *  - On a touch screen, an on-screen remote (demo-remote.ts).
 *  - ?demo&sky=night&wx=rainy holds the living sky at a time of day and weather; so does
 *    ctDemo.sky('dusk', 'snowy') in the console (ctDemo.sky() follows the clock again).
 *  - In the browser console: ctDemo.ring() rings the doorbell; ctDemo.door('binary_sensor.front_door', true) opens a door; ctDemo.range() gives the thermostat a heat/cool range; ctDemo.caption('Title', 'detail')
 *    shows a label at the top (ctDemo.caption('') hides it), for recordings.
 */

/** The backgrounds made for the project (the only ones in the repo). */
const OWN_BACKGROUNDS = ['Mountain Lake Sunset', 'Stylized Forest Brook'];

/** Starts the clock at `at` (local time) and lets it run on from there. */
function setClock(at: string): void {
  const target = new Date(at).getTime();

  if (Number.isNaN(target)) return;
  const RealDate = Date;
  const offset = target - Date.now();

  const realNow = RealDate.now.bind(RealDate);
  RealDate.now = () => realNow() + offset;
  // new Date() starts from the moved "now"; dates built from a value or parts are unchanged.
  globalThis.Date = new Proxy(RealDate, {
    construct: (real, args, newTarget) => Reflect.construct(real, args.length ? args : [RealDate.now()], newTarget),
  });
}

// ---------- the home's states ----------

/** The attributes the made-up entities carry (the ones Calm TV reads; see ha-data.ts). */
interface DemoAttributes {
  supported_color_modes?: string[];
  brightness?: number;
  unit_of_measurement?: string;
  device_class?: string;
  current_temperature?: number;
  temperature?: number;
  target_temp_low?: number;
  target_temp_high?: number;
  min_temp?: number;
  max_temp?: number;
  options?: string[];
  // Media players (the Music panel)
  media_title?: string;
  media_artist?: string;
  media_album_name?: string;
  media_duration?: number;
  media_position?: number;
  media_position_updated_at?: string;
  volume_level?: number;
  entity_picture?: string;
  mass_player_type?: string;
  group_members?: string[];
  shuffle?: boolean;
}

interface DemoEntity {
  state: string;
  attributes: DemoAttributes;
  changed: string;
}

const DIMMABLE = ['brightness'];

const light = (on: boolean, pct = 100): [string, DemoAttributes] => [
  on ? 'on' : 'off',
  on ? { supported_color_modes: DIMMABLE, brightness: Math.round(pct * 2.55) } : { supported_color_modes: DIMMABLE },
];

const plainLight = (on: boolean): [string, DemoAttributes] => [on ? 'on' : 'off', { supported_color_modes: ['onoff'] }];

const percent = (n: number): [string, DemoAttributes] => [String(n), { unit_of_measurement: '%', device_class: 'battery' }];

const just = (state: string): [string, DemoAttributes] => [state, {}];

function initialStates() {
  return new Map([
    // Living room
    ['light.living_room_floor_lamp', light(true, 60)],
    ['light.living_room_ceiling', light(false)],
    ['switch.living_room_string_lights', just('on')],
    ['cover.living_room_curtains', just('closed')],
    ['sensor.living_room_curtains_battery', percent(78)],
    ['lock.front_door', just('locked')],
    ['sensor.front_door_battery', percent(91)],
    ['sensor.front_door_operator', just('Keypad Lock')],
    ['sensor.living_room_maintenance', just('none')],
    // Kitchen
    ['climate.thermostat', ['heat', { current_temperature: 67, temperature: 68, min_temp: 50, max_temp: 90 }]],
    ['light.kitchen_main', light(true, 80)],
    ['light.kitchen_under_cabinet', light(true, 40)],
    ['lock.back_door', just('locked')],
    ['camera.back_door', just('idle')],
    ['sensor.kitchen_vacuum_status', just('charging')],
    ['sensor.kitchen_vacuum_battery', percent(84)],
    ['sensor.kitchen_vacuum_vacuum_error', just('none')],
    ['binary_sensor.kitchen_vacuum_water_shortage', just('off')],
    ['binary_sensor.kitchen_vacuum_dock_clean_water_box', just('off')],
    ['binary_sensor.kitchen_vacuum_dock_dirty_water_box', just('off')],
    ['binary_sensor.kitchen_vacuum_dock_cleaning_fluid', just('off')],
    ['sensor.kitchen_vacuum_dock_dock_error', just('ok')],
    // Office
    ['select.office_scene', ['unknown', { options: ['Focus', 'Bright', 'Relax', 'Nightlight'] }]],
    ['light.office_desk', light(false)],
    ['light.office_ceiling', light(false)],
    // Scenes, for rooms from Areas (?demo&areas): a scene's state is when it was last turned on.
    ['scene.office_focus', just('2026-11-14T08:00:00+00:00')],
    ['scene.office_relax', just('2026-11-14T17:30:00+00:00')],
    ['scene.office_nightlight', just('2026-11-13T22:00:00+00:00')],
    ['scene.bedroom_read', just('2026-11-13T21:00:00+00:00')],
    ['scene.bedroom_sunrise', just('2026-11-14T07:00:00+00:00')],
    // Bedroom
    ['select.bedroom_scene', ['unknown', { options: ['Relax', 'Read', 'Nightlight', 'Sunrise'] }]],
    ['light.bedroom_ceiling', light(false)],
    ['light.bedroom_left_lamp', light(false)],
    ['light.bedroom_right_lamp', light(false)],
    // Hallways
    ['light.upstairs_hallway', light(true, 30)],
    ['light.stairs', light(false)],
    // Outside
    ['light.porch', plainLight(true)],
    ['light.driveway', plainLight(false)],
    ['binary_sensor.garage_door', ['off', { device_class: 'garage_door' }]],
    ['cover.garage_door', ['closed', { device_class: 'garage' }]],
    ['binary_sensor.front_door', ['off', { device_class: 'door' }]],
    ['weather.home', ['partlycloudy', { temperature: 48 }]],
    ['binary_sensor.back_door', ['off', { device_class: 'door' }]],
    ['sensor.garage_temperature', ['54', { unit_of_measurement: '°F', device_class: 'temperature' }]],
    ['binary_sensor.garage_occupancy', ['off', { device_class: 'occupancy' }]],
    ['camera.front_door', just('idle')],
    ['camera.driveway', just('idle')],
    // Everything else
    ['calendar.family', just('off')],
    ['calendar.meal_plan', just('off')],
    ['input_boolean.doorbell_ringing', just('off')],
    // Speakers (the Music panel)
    ['media_player.living_room', speaker('playing', 0, 0.35)],
    ['media_player.kitchen', speaker('paused', 1, 0.2)],
    ['media_player.office', speaker('idle', -1, 0.25)],
    ['media_player.bedroom', speaker('idle', -1, 0.15)],
    ['media_player.dining_room', speaker('idle', -1, 0.2)],
    ['media_player.patio', speaker('idle', -1, 0.3)],
  ]);
}

/**
 * Made-up music, with covers made for the project: "Echoes of the Distant" by The Soundtracks
 * (src/demo-media/album-echoes.jpg) on the even tracks, and the forest background on the odd one.
 */
const DEMO_TRACKS = [
  { title: 'Slow Tide', artist: 'The Soundtracks', album: 'Echoes of the Distant', duration: 247 },
  { title: 'Paper Lanterns', artist: 'The Quiet Hours', album: 'Small Rooms', duration: 213 },
  { title: 'Northern Window', artist: 'The Soundtracks', album: 'Echoes of the Distant', duration: 198 },
];

/** The albums above, once each, with the cover of their first track. */
const DEMO_ALBUMS = DEMO_TRACKS.flatMap((t, i) => (DEMO_TRACKS.findIndex((x) => x.album === t.album) === i ? [{ name: t.album, art: i }] : []));

// Full addresses, so they aren't taken as paths on Home Assistant.
const demoArt = (i: number) => new URL(i % 2 ? artB : artA, location.href).href;

function speaker(state: string, track: number, volume: number): [string, DemoAttributes] {
  const t = DEMO_TRACKS[track];
  const base: DemoAttributes = { volume_level: volume, mass_player_type: 'player' };

  if (!t) return [state, base];

  return [state, { ...base, media_title: t.title, media_artist: t.artist, media_album_name: t.album, media_duration: t.duration,
    media_position: 64, media_position_updated_at: new Date().toISOString(), entity_picture: demoArt(track) }];
}

/** media_player/browse_media: a root with Playlists, and a few playlists in it. */
const DEMO_PLAYLISTS = ['Sunday Morning', 'Dinner Jazz', 'Focus', 'Road Trip', 'Rainy Day', 'Kids Mix', 'Evening Piano'];

const DEMO_ARTISTS = ['The Soundtracks', 'The Quiet Hours', 'Juniper Lane', 'Northbound', 'Ada Moss', 'Field Notes'];

const demoNode = (title: string, id: string, type: string, art: number, play = true, expand = false) =>
  ({ title, media_content_id: id, media_content_type: type, can_play: play, can_expand: expand, thumbnail: demoArt(art) });

function browseReply(id: string | undefined): BrowseNode {
  if (!id) return { title: 'Music Assistant', children: ['Artists', 'Albums', 'Tracks', 'Playlists', 'Radio', 'Podcasts', 'Audiobooks', 'Genres']
    .map((t) => ({ title: t, media_content_id: t.toLowerCase().split(' ')[0], media_content_type: t.toLowerCase(), can_expand: true })) };

  const [kind, n] = id.split('/');

  switch (kind) {
    case 'playlists': return { title: 'Playlists', children: DEMO_PLAYLISTS.map((name, i) => demoNode(name, `playlist/${i}`, 'playlist', i + 1, true, true)) };
    case 'artists': return { title: 'Artists', children: DEMO_ARTISTS.map((name, i) => demoNode(name, `artist/${i}`, 'artist', i, false, true)) };
    case 'albums': return { title: 'Albums', children: DEMO_ALBUMS.map((a, i) => demoNode(a.name, `album/${i}`, 'album', a.art, true, true)) };
    case 'tracks':
    case 'playlist':
    case 'album':
      return { title: kind, can_play: kind !== 'tracks', children: DEMO_TRACKS.map((t, i) => demoNode(t.title, `track/${i}`, 'track', i)) };
    case 'artist': return { title: DEMO_ARTISTS[Number(n)] ?? '', children: DEMO_ALBUMS.map((a, i) => demoNode(a.name, `album/${i}`, 'album', a.art, true, true)) };
    default: return { title: kind, children: [] };
  }
}

// ---------- Home Assistant's registries, for rooms from Areas (?demo&areas) ----------

/** The example rooms as Areas on three floors, plus a few entities that must stay out of the rooms. */
function demoRegistry(type: string): unknown {
  const rooms = decodeConfig(exampleConfig).rooms ?? [];
  const areaId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const floorOf: Record<string, string> = { living_room: 'downstairs', kitchen: 'downstairs', office: 'upstairs', bedroom: 'upstairs', hallways: 'upstairs', outside: 'outside' };

  switch (type) {
    case 'config/floor_registry/list':
      return [{ floor_id: 'upstairs', name: 'Upstairs', level: 1 }, { floor_id: 'downstairs', name: 'Downstairs', level: 0 }, { floor_id: 'outside', name: 'Outside', level: 2 }];
    case 'config/area_registry/list':
      return rooms.map((r) => ({ area_id: areaId(r.name), name: r.name, floor_id: floorOf[areaId(r.name)], icon: null }));
    case 'config/device_registry/list':
      return [{ id: 'hidden_lamp', area_id: 'living_room', labels: ['hide_in_calm_tv'], disabled_by: null }];
    case 'config/entity_registry/list_for_display': {
      const entities: object[] = rooms.flatMap((r) => r.groups.flatMap((g) => g.devices)
        .filter((d) => !d.entity.startsWith('select.'))
        .map((d) => ({ ei: d.entity, ai: areaId(rooms.find((x) => x.groups.some((g) => g.devices.includes(d)))?.name ?? '') })));
      entities.push(
        { ei: 'scene.office_focus', ai: 'office', en: 'Focus' }, { ei: 'scene.office_relax', ai: 'office', en: 'Relax' },
        { ei: 'scene.office_nightlight', ai: 'office', en: 'Nightlight' },
        { ei: 'scene.bedroom_read', ai: 'bedroom', en: 'Read' }, { ei: 'scene.bedroom_sunrise', ai: 'bedroom', en: 'Sunrise' },
        // A lamp's feature, not a lamp: stays out.
        { ei: 'switch.living_room_floor_lamp_music_mode', ai: 'living_room', en: 'Music mode' },
        // Labelled "Hide in Calm TV" (on its device): stays out.
        { ei: 'light.hidden_lamp', di: 'hidden_lamp' },
        // The garage door's opener: a cover that's a door, so it stays out of the room.
        { ei: 'cover.garage_door', ai: 'outside' },
      );

      return { entity_categories: { 0: 'config', 1: 'diagnostic' }, entities };
    }

    default: return undefined;
  }
}

// ---------- weather ----------

interface Day {
  condition: string;
  high: number;
  low: number;
  rain: number;
}

const WEEK: Day[] = [
  { condition: 'partlycloudy', high: 61, low: 46, rain: 10 },
  { condition: 'sunny', high: 64, low: 45, rain: 0 },
  { condition: 'sunny', high: 66, low: 48, rain: 0 },
  { condition: 'cloudy', high: 59, low: 50, rain: 20 },
  { condition: 'rainy', high: 55, low: 47, rain: 80 },
  { condition: 'rainy', high: 53, low: 44, rain: 60 },
  { condition: 'partlycloudy', high: 57, low: 42, rain: 10 },
];

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Coolest at 6 AM, warmest at 3 PM. */
function tempAt(day: Day, hour: number): number {
  const t = hour >= 6 && hour <= 15 ? (hour - 6) / 9 : hour > 15 ? 1 - (hour - 15) / 15 : 1 - (hour + 9) / 15;

  return Math.round(day.low + (day.high - day.low) * (0.5 - 0.5 * Math.cos(Math.PI * t)));
}

function dailyForecast(): ForecastEntry[] {
  const today = midnight(new Date());

  return WEEK.map((d, i) => ({
    datetime: `${localDate(addDays(today, i))}T00:00:00+00:00`,
    condition: d.condition,
    temperature: d.high,
    templow: d.low,
    precipitation: undefined,
    precipitation_probability: d.rain,
  }));
}

function hourlyForecast(): ForecastEntry[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const today = midnight(now);

  return Array.from({ length: 7 * 24 }, (_, i) => {
    const t = new Date(start.getTime() + i * 3600000);
    const day = WEEK[Math.min(WEEK.length - 1, Math.round((midnight(t).getTime() - today.getTime()) / 86400000))];
    const hour = t.getHours();
    const night = hour < 7 || hour >= 18;
    const condition = night && day.condition === 'sunny' ? 'clear-night' : day.condition;
    const rain = day.rain ? Math.max(0, Math.min(100, day.rain + Math.round(15 * Math.sin(hour / 3)))) : 0;

    return { datetime: t.toISOString(), condition, temperature: tempAt(day, hour), templow: undefined, precipitation: undefined, precipitation_probability: rain };
  });
}

// ---------- calendar ----------

function at(day: Date, hour: number, minute = 0): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString();
}

function familyEvents(): CalendarEvent[] {
  const now = new Date();
  const d = (n: number) => addDays(midnight(now), n);
  // Tonight's event starts on the next full hour, so there is always one "Today".
  const tonight = Math.min(22, now.getHours() + 1);

  return [
    { start: at(d(0), tonight), end: at(d(0), tonight + 2), summary: 'Movie night' },
    { start: at(d(1), 8, 30), end: at(d(1), 9, 30), summary: 'Dentist' },
    { start: at(d(1), 16), end: at(d(1), 17, 30), summary: 'Soccer practice' },
    { start: at(d(2), 18, 30), end: at(d(2), 20), summary: 'Book club' },
    { start: localDate(d(3)), end: localDate(d(4)), summary: 'Recycling day' },
    { start: at(d(4), 12), end: at(d(4), 13, 30), summary: 'Lunch with Sam' },
    { start: localDate(d(5)), end: localDate(d(8)), summary: 'Lake cabin weekend' },
    { start: at(d(9), 10), end: at(d(9), 12), summary: 'Farmers market' },
    { start: at(d(10), 19), end: at(d(10), 20), summary: 'Parent–teacher night' },
    { start: localDate(d(12)), end: localDate(d(13)), summary: 'Grandma’s birthday' },
  ];
}

function mealEvents(): CalendarEvent[] {
  const today = midnight(new Date());

  return [{ start: localDate(today), end: localDate(addDays(today, 1)), summary: 'Dinner: Lemon herb chicken' }];
}

// ---------- the stand-in connection ----------

/** The service calls Calm TV makes (ha.call, and calendar.get_events), as sent over the websocket. */
const ServiceCallSchema = v.object({
  type: v.literal('call_service'),
  domain: v.string(),
  service: v.string(),
  service_data: v.fallback(
    v.object({
      entity_id: v.optional(v.string()),
      brightness_pct: v.optional(v.number()),
      option: v.optional(v.string()),
      temperature: v.optional(v.number()),
      target_temp_low: v.optional(v.number()),
      target_temp_high: v.optional(v.number()),
      volume_level: v.optional(v.number()),
      media_content_id: v.optional(v.string()),
      group_members: v.optional(v.array(v.string())),
      shuffle: v.optional(v.boolean()),
    }),
    {},
  ),
  target: v.fallback(v.object({ entity_id: v.optional(v.string()) }), {}),
});

type ServiceCall = v.InferOutput<typeof ServiceCallSchema>;

/** The Music panel's media browser request; no id means the top level. */
const BrowseRequestSchema = v.object({
  type: v.literal('media_player/browse_media'),
  media_content_id: v.optional(v.string()),
});

const ForecastSubscriptionSchema = v.object({
  type: v.literal('weather/subscribe_forecast'),
  forecast_type: v.picklist(['daily', 'hourly']),
});

/** What the stand-in answers: calendar events, or nothing for other calls. */
type DemoReply = CalendarResponse | { done: true } | { response: { [entity: string]: object } };

/** Pretends to be Home Assistant: holds the made-up states and changes them as Calm TV asks. */
class DemoHome {
  private states = new Map<string, DemoEntity>();
  private listeners: ((e: HassEntities) => void)[] = [];
  private lastBrightness = new Map<string, number>();
  /** Covers on their way open or closed: the timer that finishes the move. */
  private moving = new Map<string, number>();

  constructor() {
    // Changed "a while ago", so nothing counts as just changed.
    const earlier = new Date(Date.now() - 3 * 3600000).toISOString();

    for (const [id, [state, attributes]] of initialStates()) this.states.set(id, { state, attributes, changed: earlier });
  }

  entities(): HassEntities {
    const out: HassEntities = {};

    for (const [id, e] of this.states) out[id] = toHass(id, e);

    return out;
  }

  subscribe(fn: (e: HassEntities) => void): void {
    this.listeners.push(fn);
    fn(this.entities());
  }

  set(id: string, state: string, attributes: DemoAttributes = {}): void {
    const old = this.states.get(id);
    const changed = !old || old.state !== state ? new Date().toISOString() : old.changed;
    this.states.set(id, { state, attributes: { ...old?.attributes, ...attributes }, changed });
    const ents = this.entities();
    this.listeners.forEach((fn) => fn(ents));
  }

  /** Answers the screens' messages, as Home Assistant's websocket would. */
  readonly link: HaLink = {
    sendMessagePromise: <Result>(m: MessageBase) => {
      const browse = v.safeParse(BrowseRequestSchema, m);

      if (browse.success) {
        // SAFETY: the Music panel decodes this with BrowseNodeSchema, as it does HA's own answer.
        return Promise.resolve(browseReply(browse.output.media_content_id) as Result);
      }

      // Rooms from Areas (?demo&areas): Home Assistant's area, floor, device and entity lists.
      const registry = demoRegistry(m.type);

      if (registry !== undefined) {
        // SAFETY: areas.ts decodes each list with its schema, as it does Home Assistant's own answer.
        return Promise.resolve(registry as Result);
      }

      const call = v.safeParse(ServiceCallSchema, m);
      const reply: DemoReply = call.success ? this.callService(call.output) : { done: true };

      // SAFETY: each caller asks for the reply its message gets from Home Assistant: calendar events
      // for calendar.get_events (decoded again by calendarEvents), and nothing it reads otherwise.
      return Promise.resolve(reply as Result);
    },
    subscribeMessage: async <Result>(fn: (m: Result) => void, m: MessageBase) => {
      const sub = v.safeParse(ForecastSubscriptionSchema, m);
      const unsubscribe = async () => {};

      if (!sub.success) return unsubscribe;
      const forecast: ForecastMessage = { forecast: sub.output.forecast_type === 'hourly' ? hourlyForecast() : dailyForecast() };

      // SAFETY: the only subscription the screens make is weather/subscribe_forecast, whose
      // messages are ForecastMessage (decoded again by forecastEntries).
      fn(forecast as Result);

      return unsubscribe;
    },
  };

  private callService(call: ServiceCall): DemoReply {
    const data = call.service_data;
    const id = data.entity_id ?? call.target.entity_id ?? '';
    const s = this.states.get(id);

    if (call.domain === 'calendar' && call.service === 'get_events') {
      return { response: { [id]: { events: id === 'calendar.meal_plan' ? mealEvents() : familyEvents() } } };
    }

    if (!s) return { done: true };

    switch (`${call.domain}.${call.service}`) {
      case 'media_player.media_play':
        this.set(id, 'playing', { media_position_updated_at: new Date().toISOString() });

        return { done: true };
      case 'media_player.media_pause':
        this.set(id, 'paused');

        return { done: true };
      case 'media_player.volume_set':
        this.set(id, s.state, { volume_level: data.volume_level ?? 0.3 });

        return { done: true };
      case 'media_player.media_next_track':
      case 'media_player.media_previous_track': {
        const now = DEMO_TRACKS.findIndex((t) => t.title === s.attributes.media_title);
        const next = (now + (call.service === 'media_next_track' ? 1 : DEMO_TRACKS.length - 1)) % DEMO_TRACKS.length;
        const [, attrs] = speaker('playing', next, s.attributes.volume_level ?? 0.3);
        this.set(id, 'playing', { ...attrs, media_position: 0 });

        return { done: true };
      }

      case 'media_player.shuffle_set':
        this.set(id, s.state, { shuffle: data.shuffle ?? false });

        return { done: true };
      case 'music_assistant.get_queue': {
        const now = DEMO_TRACKS.findIndex((t) => t.title === s.attributes.media_title);
        const item = (i: number) => {
          const t = DEMO_TRACKS[i % DEMO_TRACKS.length];

          return { name: t.title, duration: t.duration, media_item: { name: t.title, image: demoArt(i % DEMO_TRACKS.length), artists: [{ name: t.artist }], album: { name: t.album } } };
        };

        return { response: { [id]: { queue_id: id, items: 14, current_index: 3, shuffle_enabled: !!s.attributes.shuffle, repeat_mode: 'off', current_item: now < 0 ? null : item(now), next_item: now < 0 ? null : item(now + 1) } } };
      }

      case 'media_player.join': {
        // Like Music Assistant: the leader and every member list the whole group.
        const group = [...new Set([id, ...(s.attributes.group_members ?? []), ...(data.group_members ?? [])])];

        for (const m of group) {
          const e = this.states.get(m);

          if (e) this.set(m, e.state, { group_members: group });
        }

        return { done: true };
      }

      case 'media_player.unjoin': {
        const rest = (s.attributes.group_members ?? []).filter((m) => m !== id);

        for (const m of rest) {
          const e = this.states.get(m);

          if (e) this.set(m, e.state, { group_members: rest.length > 1 ? rest : [] });
        }

        this.set(id, s.state, { group_members: [] });

        return { done: true };
      }

      case 'media_player.play_media': {
        const [, attrs] = speaker('playing', 0, s.attributes.volume_level ?? 0.3);
        const name = DEMO_PLAYLISTS[Number((data.media_content_id ?? '').split('/')[1]) || 0];
        this.set(id, 'playing', { ...attrs, media_album_name: name, media_position: 0 });

        return { done: true };
      }

      case 'light.turn_on': {
        const pct = data.brightness_pct ?? this.lastBrightness.get(id) ?? 100;
        const dims = s.attributes.supported_color_modes?.includes('brightness');
        this.set(id, 'on', dims ? { brightness: Math.round(pct * 2.55) } : {});
        break;
      }

      case 'light.turn_off':
        if (s.attributes.brightness !== undefined) this.lastBrightness.set(id, Math.round(s.attributes.brightness / 2.55));
        this.set(id, 'off');
        break;
      case 'switch.turn_on':
        this.set(id, 'on');
        break;
      case 'switch.turn_off':
        this.set(id, 'off');
        break;
      case 'cover.open_cover':
      case 'cover.close_cover': {
        const opening = call.service === 'open_cover';
        this.set(id, opening ? 'opening' : 'closing');
        window.clearTimeout(this.moving.get(id));
        this.moving.set(id, window.setTimeout(() => this.set(id, opening ? 'open' : 'closed'), 4000));

        // The garage door's open/closed sensor follows the door.
        if (id === 'cover.garage_door') this.set('binary_sensor.garage_door', opening ? 'on' : 'off');
        break;
      }

      // Stopped part-way, a cover reports itself open (as Home Assistant does).
      case 'cover.stop_cover':
        window.clearTimeout(this.moving.get(id));
        if (s.state === 'opening' || s.state === 'closing') this.set(id, 'open');
        break;

      case 'scene.turn_on':
        this.set(id, new Date().toISOString());
        break;

      case 'select.select_option':
        if (data.option) this.set(id, data.option);
        break;
      case 'climate.set_temperature':
        if (data.temperature !== undefined) this.set(id, s.state, { temperature: data.temperature });
        else if (data.target_temp_low !== undefined) this.set(id, s.state, { target_temp_low: data.target_temp_low, target_temp_high: data.target_temp_high });
        break;
    }

    return { done: true };
  }
}

function toHass(id: string, e: DemoEntity): HassEntity {
  return {
    entity_id: id,
    state: e.state,
    attributes: { ...e.attributes },
    last_changed: e.changed,
    last_updated: e.changed,
    context: { id: '', parent_id: null, user_id: null },
  };
}

let captionEl: HTMLElement | null = null;
let captionTimer = 0;

/** Shows a label at the top of the screen (an empty title hides it), fading between labels. */
function caption(title: string, detail = ''): void {
  if (!captionEl) {
    captionEl = document.createElement('div');
    captionEl.className = 'demo-caption';
    captionEl.innerHTML = '<b></b><span></span>';
    (document.querySelector('#stage') ?? document.body).appendChild(captionEl);
  }

  const el = captionEl;
  const wasShown = el.classList.contains('show');
  el.classList.remove('show');
  clearTimeout(captionTimer);

  if (!title) return;
  // Swap the words while it's faded out, then fade back in.
  captionTimer = window.setTimeout(() => {
    const [b, span] = [el.querySelector('b'), el.querySelector('span')];

    if (b) b.textContent = title;

    if (span) span.textContent = detail;
    el.classList.add('show');
  }, wasShown ? 450 : 0);
}

/** Switches the app to the made-up home. Call before the screens are built. */
export function startDemo(): void {
  // A made-up Music Assistant for the Music panel's full queue: 14 songs, playing the 4th.
  const songs = ['Slow Tide', 'Paper Lanterns', 'Northern Window', 'Low Sun', 'Harbour Bells', 'Glass Garden', 'Still Water', 'Cedar Smoke', 'Morning Ferry', 'Long Shadows', 'Blue Hour', 'Salt Air', 'Quiet Streets', 'Last Light'];
  ma.demo = (command, args) => {
    if (command === 'player_queues/items') {
      const offset = Number(args.offset ?? 0);

      return songs.slice(offset, offset + Number(args.limit ?? 100)).map((name, j) => {
        const i = offset + j;
        const t = DEMO_TRACKS[i % DEMO_TRACKS.length];

        return { queue_item_id: `q${i}`, name, duration: 180 + ((i * 37) % 90), demoArt: demoArt(i), media_item: { name, artists: [{ name: t.artist }] } };
      });
    }

    return null;
  };
  const clock = new URLSearchParams(location.search).get('at');

  if (clock) setClock(clock);

  // The example home, with the doorbell window on (for ctDemo.ring) and no backgrounds from Home Assistant.
  const config = decodeConfig(exampleConfig);
  settings.config = { ...config, doorbell: { ...config.doorbell, window: true }, backgrounds: undefined, sky: config.sky ?? {} };

  // ?demo&areas: no "rooms", so they're built from the demo's Areas (see demoRegistry).
  if (new URLSearchParams(location.search).has('areas')) settings.config = { ...settings.config, rooms: undefined };
  settings.source = 'demo';
  settings.error = '';
  settings.haUrl = 'http://homeassistant.local:8123';

  for (const list of [videos, wallpapers]) {
    const own = list.filter((b) => OWN_BACKGROUNDS.includes(b.name));

    if (own.length) list.splice(0, list.length, ...own);
  }

  // Every camera shows the placeholder doorbell view (a still photo, as a short looping video).
  demoCameras.clip = () => doorbellView;

  const home = new DemoHome();

  ha.useDemo(home.link, (fn) => home.subscribe(fn));

  // Dashboard mode is made for touch, so it needs no on-screen remote.
  if (!dashboardMode) showRemote();

  window.ctDemo = {
    caption,
    sky: (phase, condition) => sky.setPreview(PHASES.find((p) => p === phase), condition || undefined),
    door: (id = 'binary_sensor.front_door', open = true) => home.set(id, open ? 'on' : 'off'),
    // The thermostat holding a range (heat/cool), as many do in auto mode.
    range: () => home.set('climate.thermostat', 'heat_cool', { temperature: undefined, target_temp_low: 66, target_temp_high: 74 }),
    ring: () => {
      home.set('input_boolean.doorbell_ringing', 'on');
      window.setTimeout(() => home.set('input_boolean.doorbell_ringing', 'off'), 20000);
    },
  };
}

declare global {
  interface Window {
    /** Demo mode only: ring the doorbell, or show a label at the top (see demo.ts). */
    ctDemo?: { ring(): void; caption(title: string, detail?: string): void; sky(phase?: string, condition?: string): void; door(id?: string, open?: boolean): void; range(): void };
  }
}
