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
});

export const CameraAttributes = v.object({
  /** Picture path on HA, including its access token. */
  entity_picture: maybeString,
});

/** A `select` entity used as a scene picker. */
export const SelectAttributes = v.object({
  options: maybeStrings,
});

export const SensorAttributes = v.object({
  unit_of_measurement: maybeString,
  device_class: maybeString,
});

export const MediaPlayerAttributes = v.object({
  media_title: maybeString,
  media_artist: maybeString,
  entity_picture: maybeString,
  friendly_name: maybeString,
  /** The group's leader first, then the speakers following it. */
  group_members: maybeStrings,
});

export const WeatherAttributes = v.object({
  temperature: maybeNumber,
});

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
