# Set up the doorbell window and the Music panel

This guide connects two optional features to *your* Home Assistant: the doorbell window that pops
up over whatever you're watching, and the Music panel for Music Assistant. You find your own entity
ids in Home Assistant, then put them in `calm-tv.json`, the file the TV reads from Home Assistant's
`www` folder (see [configuration.md](configuration.md)).

After any change to `calm-tv.json`, reload it on the TV: **Settings → Home Assistant → Home setup
(calm-tv.json) → OK**. Restarting the app also reloads it.

## Find your entity ids

In Home Assistant, open **Developer tools → Template**, paste one of these, and copy the ids from
the result on the right.

**Cameras** (pick your doorbell's):

```jinja
{%- for s in states.camera %}
{{ s.entity_id }} | {{ s.name }}
{%- endfor %}
```

**Doorbell button sensors** (something that turns on when someone presses the button):

```jinja
{%- for s in states if 'visitor' in s.entity_id or 'ding' in s.entity_id or 'doorbell' in s.entity_id or 'chime' in s.entity_id %}
{{ s.entity_id }} | {{ s.name }} | {{ s.state }}
{%- endfor %}
```

**Music Assistant speakers** (only the players Music Assistant made, not the same speakers from
other integrations such as Sonos or Cast):

```jinja
{%- for s in states.media_player if s.attributes.mass_player_type is defined %}
{{ s.entity_id }} | {{ s.name }}
{%- endfor %}
```

The same speaker often shows up twice, for example `media_player.kitchen` (Sonos) and
`media_player.kitchen_2` (Music Assistant). Use the Music Assistant one: it's the one in this list.

## The doorbell window

When the doorbell rings, the TV pauses what's playing and shows the doorbell camera live in a
window, even over Netflix or any other app. Back closes it.

### 1. A "someone is at the door" switch in Home Assistant

The TV watches an `input_boolean` that is on while someone is at the door.

1. **Settings → Devices & services → Helpers → Create helper → Toggle**, named
   **Doorbell ringing**. Its id is `input_boolean.doorbell_ringing`.
2. **Settings → Automations → Create automation → Edit in YAML**, and paste the version for your
   doorbell, with your own sensor's id:

   **Reolink** (a `binary_sensor` that turns on when the button is pressed):

   ```yaml
   alias: Doorbell ringing
   triggers:
     - trigger: state
       entity_id: binary_sensor.front_door_visitor   # your doorbell's button sensor
       from: "off"
       to: "on"
   actions:
     - action: input_boolean.turn_on
       target:
         entity_id: input_boolean.doorbell_ringing
     - delay:
         seconds: 60
     - action: input_boolean.turn_off
       target:
         entity_id: input_boolean.doorbell_ringing
   mode: restart
   ```

   **Nest, or any doorbell with an `event` entity** (the event's state changes on every ring):

   ```yaml
   alias: Doorbell ringing
   triggers:
     - trigger: state
       entity_id: event.front_door_chime             # your doorbell's event entity
       not_from: unavailable
   actions:
     - action: input_boolean.turn_on
       target:
         entity_id: input_boolean.doorbell_ringing
     - delay:
         seconds: 60
     - action: input_boolean.turn_off
       target:
         entity_id: input_boolean.doorbell_ringing
   mode: restart
   ```

   The window stays up for as long as the switch is on (60 seconds here), or until Back.

### 2. In calm-tv.json

```json
"doorbell": {
  "window": true,
  "camera": "camera.front_door",
  "ringing": "input_boolean.doorbell_ringing",
  "size": 75,
  "position": "center",
  "pause": true,
  "sound": true
}
```

| Option | What it does |
| --- | --- |
| `window` | `true` turns the pop-up on. |
| `camera` | Your doorbell camera, from the camera list above. |
| `ringing` | The switch from step 1. |
| `size` | Width of the window, in % of the screen. Default 34; 75 is three quarters. |
| `position` | `"center"`, or `"corner"` (top right, the default). |
| `pause` | `true` pauses what's playing when it rings. |
| `sound` | `true` plays the camera's audio. Some cameras send audio the TV can't play live (AAC); then you get video only. |

### 3. Test it

Turn **Doorbell ringing** on by hand (Settings → Devices & services → Helpers → Doorbell ringing),
then press the real doorbell. The window should show a picture within a second, and live video
right after.

If nothing pops up over other apps, Calm TV's accessibility service is off (an app update turns it
off). On the TV: **Settings → Accessibility → Calm TV: Home button → On**, then open Calm TV once.

## The Music panel

A **Music** tile in the dock (just left of Settings) opens what's playing, play/pause, skip,
volume, the speakers, speaker grouping, and library buttons (Artists, Albums, Tracks, Playlists,
Radio, Podcasts, Audiobooks) that you can browse and play from. It needs
[Music Assistant](https://music-assistant.io) set up in Home Assistant.

### In calm-tv.json

```json
"music": {
  "players": [
    { "name": "Living room", "entity": "media_player.living_room_2" },
    { "name": "Kitchen", "entity": "media_player.kitchen_2" },
    { "name": "Office", "entity": "media_player.office_2" }
  ]
}
```

- `players`: your speakers, in the order you want them, from the Music Assistant list above. `name`
  is what the TV shows. Leave `players` out (`"music": {}`) to list every Music Assistant speaker.
- `library` (optional): which library buttons to show, for example
  `"library": ["Albums", "Playlists", "Radio"]`. Leave it out for all seven.

To put the Music tile somewhere else in the dock, add it to `"apps"` where you want it:
`{ "name": "Music", "open": "music" }`. You can also move it with **Settings → Arrange dock**.

### Using it with the remote

- **Speakers:** OK picks the speaker that the controls and library play on.
- **Group button** (after volume): OK on other speakers adds them to play along, or takes them out.
  Back when done.
- **Library:** OK on a button opens its grid. OK on an artist, album or playlist opens it (an album
  or playlist starts with **Play all**). OK on a song or station plays it. Back goes up a level.

### If something's off

- **A speaker says Unavailable**: it's the wrong entity (often the Sonos/Cast one instead of the
  Music Assistant one), or Music Assistant can't reach it.
- **Library buttons missing**: Music Assistant names its folders Artists, Albums, Tracks,
  Playlists, Radio, Podcasts and Audiobooks. If yours differ, list your names in `library`.
- **Nothing happens on OK**: check in Home Assistant that the speaker plays when you start the
  same playlist from Music Assistant itself.
