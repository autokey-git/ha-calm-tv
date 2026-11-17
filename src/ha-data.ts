import * as v from 'valibot';
import type { HassEntity } from 'home-assistant-js-websocket';

// Home Assistant data, decoded where it enters the app. HA's entity attributes, forecasts and
// calendar events arrive untyped; each schema below turns them into the fields this app uses.
// A field that's missing, or arrives in an unexpected shape, comes back undefined instead of
// failing the whole entity, so one odd attribute never blanks a room.

const maybeNumber = v.fallback(v.optional(v.number()), undefined);
const maybeString = v.fallback(v.optional(v.string()), undefined);
const maybeStrings = v.fallback(v.optional(v.array(v.string())), undefined);

export const LightAttributes = v.object({
  supported_color_modes: maybeStrings,
  /** 0–255. */
  brightness: maybeNumber,
});

export const ClimateAttributes = v.object({
  current_temperature: maybeNumber,
  min_temp: maybeNumber,
  max_temp: maybeNumber,
  /** The single set point; absent while the thermostat holds a range. */
  temperature: maybeNumber,
  target_temp_low: maybeNumber,
  target_temp_high: maybeNumber,
  /** What it's doing right now: heating, cooling, idle, off... */
  hvac_action: maybeString,
});

export const CameraAttributes = v.object({
  /** Picture path on HA, including its access token. */
  entity_picture: maybeString,
  /** The token for HA's camera proxy (the doorbell window's quick picture). */
  access_token: maybeString,
});

/** A speaker (the Music panel): what it plays, its volume, and the speakers grouped with it. */
export const MediaPlayerAttributes = v.object({
  friendly_name: maybeString,
  media_title: maybeString,
  media_artist: maybeString,
  media_album_name: maybeString,
  /** Seconds. */
  media_duration: maybeNumber,
  /** Seconds, as of `media_position_updated_at`. */
  media_position: maybeNumber,
  media_position_updated_at: maybeString,
  /** 0–1. */
  volume_level: maybeNumber,
  /** Album art: a path on HA, or a full address. */
  entity_picture: maybeString,
  /** Speakers playing together, this one included (Music Assistant lists the whole group). */
  group_members: maybeStrings,
  /** Shuffle on. */
  shuffle: v.fallback(v.optional(v.boolean()), undefined),
});

export type MediaPlayerAttributes = v.InferOutput<typeof MediaPlayerAttributes>;

// ---------- Music Assistant's queue (music_assistant.get_queue) ----------

const maybeNullable = <T extends v.GenericSchema>(schema: T) => v.fallback(v.optional(v.nullable(schema)), undefined);

/** A song in the queue (only the parts the Music panel shows). */
const QueueEntrySchema = v.object({
  name: maybeString,
  /** Seconds. */
  duration: maybeNullable(v.number()),
  media_item: maybeNullable(v.object({
    name: maybeString,
    /** A path on HA, or a full address. */
    image: maybeNullable(v.string()),
    artists: v.fallback(v.optional(v.array(v.object({ name: maybeString }))), undefined),
    album: maybeNullable(v.object({ name: maybeString })),
  })),
});

/** A speaker's queue: what's playing, what's next and how many in all (not the whole list). */
const MusicQueueSchema = v.object({
  queue_id: maybeString,
  items: maybeNumber,
  current_index: maybeNullable(v.number()),
  shuffle_enabled: v.fallback(v.optional(v.boolean()), undefined),
  repeat_mode: maybeString,
  current_item: maybeNullable(QueueEntrySchema),
  next_item: maybeNullable(QueueEntrySchema),
});

/** get_queue's answer: one queue per speaker asked about. */
export const MusicQueueReplySchema = v.object({
  response: v.fallback(v.optional(v.record(v.string(), MusicQueueSchema)), undefined),
});

export type MusicQueue = v.InferOutput<typeof MusicQueueSchema>;

export type QueueEntry = v.InferOutput<typeof QueueEntrySchema>;

// ---------- the media browser (media_player/browse_media) ----------

const BrowseChildSchema = v.object({
  title: maybeString,
  media_content_id: maybeString,
  media_content_type: maybeString,
  can_play: v.fallback(v.optional(v.boolean()), undefined),
  can_expand: v.fallback(v.optional(v.boolean()), undefined),
  thumbnail: maybeString,
});

/** One folder of the media browser, with the folders and items in it. */
export const BrowseNodeSchema = v.object({
  ...BrowseChildSchema.entries,
  children: v.fallback(v.optional(v.array(BrowseChildSchema)), undefined),
});

export type BrowseChild = v.InferOutput<typeof BrowseChildSchema>;

export type BrowseNode = v.InferOutput<typeof BrowseNodeSchema>;

/** A `select` entity used as a scene picker. */
export const SelectAttributes = v.object({
  options: maybeStrings,
});

export const SensorAttributes = v.object({
  unit_of_measurement: maybeString,
  device_class: maybeString,
});

export const WeatherAttributes = v.object({
  temperature: maybeNumber,
});

/** Light: a group of lights (HA's light groups, Hue rooms) lists its members; a lamp doesn't. */
export const LightGroupAttributes = v.object({
  entity_id: maybeStrings,
  is_hue_group: v.fallback(v.optional(v.boolean()), undefined),
});

// ---------- registries: Home Assistant's areas, floors, devices and entities ----------
// For rooms built from Areas (areas.ts). Only the fields used here; an entry that doesn't match is
// dropped, not fatal.

export const AreaSchema = v.object({
  area_id: v.string(),
  name: v.string(),
  floor_id: v.fallback(v.nullish(v.string()), undefined),
  icon: v.fallback(v.nullish(v.string()), undefined),
});
export type Area = v.InferOutput<typeof AreaSchema>;

export const FloorSchema = v.object({
  floor_id: v.string(),
  name: v.string(),
  level: v.fallback(v.nullish(v.number()), undefined),
});
export type Floor = v.InferOutput<typeof FloorSchema>;

export const DeviceRegistrySchema = v.object({
  id: v.string(),
  area_id: v.fallback(v.nullish(v.string()), undefined),
  labels: v.fallback(v.array(v.string()), []),
  disabled_by: v.fallback(v.nullish(v.string()), undefined),
});
export type DeviceEntry = v.InferOutput<typeof DeviceRegistrySchema>;

/** config/entity_registry/list_for_display: short keys, to keep the answer small. */
export const EntityDisplaySchema = v.object({
  /** Entity id. */
  ei: v.string(),
  /** Area (the entity's own; else its device's). */
  ai: v.fallback(v.nullish(v.string()), undefined),
  /** Device id. */
  di: v.fallback(v.nullish(v.string()), undefined),
  /** Hidden ("Visible" off in HA). */
  hb: v.fallback(v.optional(v.boolean()), undefined),
  /** Entity category (config, diagnostic): set means it isn't a main control. */
  ec: v.fallback(v.optional(v.number()), undefined),
  /** The entity's own name; null/absent for a device's main entity ("Music mode", "Segment 1"… otherwise). */
  en: v.fallback(v.nullish(v.string()), undefined),
  /** Labels. */
  lb: v.fallback(v.array(v.string()), []),
});
export type EntityDisplay = v.InferOutput<typeof EntityDisplaySchema>;

/** A list where an entry that doesn't decode is skipped. */
export function decodeList<T>(raw: unknown, schema: v.GenericSchema<unknown, T>): T[] {
  return Array.isArray(raw) ? raw.flatMap((x) => { const r = v.safeParse(schema, x); return r.success ? [r.output] : []; }) : [];
}

/** An entity's attributes, decoded with `schema`. */
export function attributes<T>(entity: HassEntity, schema: v.GenericSchema<unknown, T>): T {
  return v.parse(schema, entity.attributes);
}

// ---------- weather forecasts (weather/subscribe_forecast) ----------

const ForecastEntrySchema = v.object({
  datetime: v.string(),
  condition: maybeString,
  temperature: maybeNumber,
  templow: maybeNumber,
  /** Inches (US units). */
  precipitation: maybeNumber,
  /** Percent. */
  precipitation_probability: maybeNumber,
});

export type ForecastEntry = v.InferOutput<typeof ForecastEntrySchema>;

const ForecastMessageSchema = v.object({
  forecast: v.fallback(v.nullish(v.array(v.unknown())), null),
});

/** A weather/subscribe_forecast message as HA sends it (decoded by forecastEntries). */
export type ForecastMessage = v.InferInput<typeof ForecastMessageSchema>;

/** The forecast entries in a weather/subscribe_forecast message; entries without a time are dropped. */
export function forecastEntries(message: ForecastMessage): ForecastEntry[] {
  const entries = v.parse(ForecastMessageSchema, message).forecast ?? [];

  return entries.flatMap((entry) => {
    const parsed = v.safeParse(ForecastEntrySchema, entry);

    return parsed.success ? [parsed.output] : [];
  });
}

// ---------- calendar events (calendar.get_events with return_response) ----------

const CalendarEventSchema = v.object({
  /** "2026-11-14" for all-day events, a full timestamp otherwise. */
  start: v.string(),
  /** All-day ends are exclusive. */
  end: v.string(),
  summary: v.fallback(v.optional(v.string(), ''), ''),
});

export type CalendarEvent = v.InferOutput<typeof CalendarEventSchema>;

const CalendarResponseSchema = v.object({
  response: v.record(v.string(), v.object({ events: v.array(v.unknown()) })),
});

/** A calendar.get_events response as HA sends it (decoded by calendarEvents). */
export type CalendarResponse = v.InferInput<typeof CalendarResponseSchema>;

/** The events for `entity` in a calendar.get_events response; malformed events are dropped. */
export function calendarEvents(result: CalendarResponse, entity: string): CalendarEvent[] {
  const events = v.parse(CalendarResponseSchema, result).response[entity]?.events ?? [];

  return events.flatMap((event) => {
    const parsed = v.safeParse(CalendarEventSchema, event);

    return parsed.success ? [parsed.output] : [];
  });
}
