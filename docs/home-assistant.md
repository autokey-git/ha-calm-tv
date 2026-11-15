# What Home Assistant needs

Calm TV talks to Home Assistant directly over its websocket API, the same way HA's own app
does. Nothing needs installing in HA for the basics. This page covers each feature's requirements.

Built and tested against Home Assistant **2026.11** (HA OS).

## 1. Reachable from the TV

The TV must reach Home Assistant at an address like `http://192.168.1.20:8123`, either on your home
network or over a VPN. The original runs HA on an isolated machine reached only through **Tailscale**,
with the Tailscale app on the TV and HA at its Tailscale IP. Plain `http` is fine: the app's page is
deliberately served over http so it may talk to an http Home Assistant. `https` works too.

No ports need to be opened to the internet.

## 2. A user for the TV (recommended)

Create a separate, **non-administrator** user for the TV, for example "Living room TV", under
Settings → People → Add person → *Allow person to login*. Then on the TV, go to Calm TV →
Settings → **Home Assistant** → OK. HA's own login page opens, and you sign in there with the remote.

- The TV holds only refreshable tokens from that sign-in (OAuth), stored in the app.
  No password or long-lived token is ever put into the app or the config file.
- A non-admin user can still read states, control lights, read calendars and play cameras. It
  can't change HA's configuration. To cut the TV off, remove the user or its refresh token in HA.

## 3. Entities for each feature

| Feature | What HA needs | Notes |
| --- | --- | --- |
| Rooms | Whatever entities you list in `calm-tv.json` | See [configuration.md](configuration.md) |
| Thermostat | A `climate.*` entity in a room | The first one is shown large on the Smart Home screen |
| Weather | A weather entity; **Open-Meteo** recommended | Add Open-Meteo under Settings → Devices & services. It has no key or account, and gives ~7 days of hourly forecast |
| Calendar | Any `calendar.*` entity | Read with `calendar.get_events` |
| Dinner line | A calendar whose all-day events are meals ("Dinner: Tacos") | Optional |
| Cameras | `camera.*` with **WebRTC** support | Nest cameras (Google Nest integration) work. RTSP cameras work through HA's built-in go2rtc. Cameras that only offer snapshots/MJPEG don't play yet |
| Scenes | A `select.*` entity whose options are scene names | Some integrations create these per room. Picking one calls `select.select_option` |
| Locks | `lock.*`, plus optional battery/operator sensors | Status only by design |
| Vacuum | Roborock-style sensors | Optional |
| Maintenance notes | A text `sensor.*` per room | Optional; see the template example below |
| Doorbell window | A doorbell camera + an `input_boolean` + an automation | Optional; see below |

## 4. Calendars that refresh slowly

**Remote Calendar** (an ICS link) re-downloads only **once every 24 hours**. Add an automation that
refreshes it more often. Every 15 minutes is plenty:

```yaml
alias: Refresh calendars
triggers:
  - trigger: time_pattern
    minutes: "/15"
actions:
  - action: homeassistant.update_entity
    target:
      entity_id:
        - calendar.family
        - calendar.meal_plan
mode: single
```

Calm TV itself re-reads the calendars every 5 minutes.

## 5. The doorbell window (optional)

Calm TV watches an `input_boolean` that is on while someone is at the door:

1. Create a helper: Settings → Devices & services → Helpers → Toggle, e.g. **Doorbell ringing**
   (`input_boolean.doorbell_ringing`).
2. Add an automation that turns it on for a minute when the doorbell rings. For a Nest doorbell,
   the trigger is its chime **event** entity:

   ```yaml
   alias: Doorbell ringing
   triggers:
     - trigger: state
       entity_id: event.front_door_chime      # your doorbell's event entity
       not_from: unavailable
   actions:
     - action: input_boolean.turn_on
       target: { entity_id: input_boolean.doorbell_ringing }
     - delay: { seconds: 60 }
     - action: input_boolean.turn_off
       target: { entity_id: input_boolean.doorbell_ringing }
   mode: restart
   ```
3. In `calm-tv.json`: `"doorbell": { "window": true, "camera": "camera.front_door", "ringing": "input_boolean.doorbell_ringing" }`.

Google TV already pops up its own alert for Nest doorbells; you may prefer to keep only one.

**Reolink doorbells** have a **visitor** binary sensor that turns on when the button is pressed
(for example `binary_sensor.front_door_visitor`). Use it as the trigger instead:

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.front_door_visitor
    from: "off"
    to: "on"
```

## 6. Maintenance notes (optional)

A room's `maintenance` sensor is any sensor whose state is a short note, or empty/`unknown` when
there's nothing to say. Example template sensor (Settings → Helpers → Template → Sensor):

```jinja
{% set b = states('sensor.living_room_curtains_battery') | int(100) %}
{{ 'Curtain battery ' ~ b ~ '%' if b < 20 else '' }}
```

## 7. Where to keep `calm-tv.json`

Recommended: in HA's `/config/www/` folder, so it's served at `http://<ha>/local/calm-tv.json`
and editable from HA. The **File editor** add-on (Settings → Add-ons) or Samba share are easy ways to
put it there. Restart HA once after creating the `www` folder. See [configuration.md](configuration.md).
