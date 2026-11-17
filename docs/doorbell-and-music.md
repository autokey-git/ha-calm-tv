# Set up the doorbell window and the Music screen

This guide connects two optional features to *your* Home Assistant: the doorbell window that pops
up over whatever you're watching, and the Music screen for Music Assistant. You find your own entity
ids in Home Assistant, then put them in `calm-tv.json`, the file the TV reads from Home Assistant's
`www` folder (see [configuration.md](configuration.md)).

After any change to `calm-tv.json`, reload it on the TV: **Settings → Home Assistant → Home setup
→ In use**. Restarting the app also reloads it.

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

When the doorbell rings, the TV shows the doorbell camera live in a window, even over Netflix or
any other app. Back closes it. With `"pause": true` (below), it also pauses what's playing.

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

`camera` is your doorbell camera from the list above, and `ringing` is the switch from step 1. The
last four are optional: `size` and `position` make the window bigger or centred, `pause` pauses
what's playing, and `sound` plays the camera's audio. Leave them out for the small, silent window
in the corner. [configuration.md](configuration.md#doorbell) has each one's details and default.

### 3. Test it

Turn **Doorbell ringing** on by hand (Settings → Devices & services → Helpers → Doorbell ringing),
then press the real doorbell. The window should show a picture within a second, and live video
right after.

If nothing pops up over other apps, Calm TV's accessibility service is off (an app update turns it
off). On the TV: **Settings → Accessibility → Calm TV: Home button → On**, then open Calm TV once.

## The Music screen

The **Music** screen (↓ from Smart Home) is a calm view of what's playing: the album art on its
own, and a frosted bar with the song, previous / play-pause / next and volume. Like every screen, it
rests after a few seconds without a key press: the bar fades away and the art and caption settle to
the middle; the first key only brings the bar back. With nothing playing, a
placeholder cover with a music note stands in for the art.

**More** on the bar opens the Music panel: shuffle, the queue, the speakers, speaker grouping, and
library buttons (Artists, Albums, Tracks, Playlists, Radio, Podcasts, Audiobooks) that you can
browse and play from. Back returns to the Music screen. It needs
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

To move the Music screen, or leave it out, list it in `"screens"` (see configuration.md).

### Using it with the remote

- **Speakers:** OK on another speaker picks it, so the controls and library play there. OK on the
  chosen speaker (or one grouped with it) turns its card into a volume slider: ←/→ to change it,
  OK or Back when done. A playing speaker shows its album cover with moving bars; a speaker playing
  along shows its leader's cover with a link. Idle speakers are grey. Moving onto a speaker lights
  up the rest of its group.
- **Group speakers** (the wide button above the speakers): OK on other speakers adds them to play
  along, or takes them out. **Play everywhere** adds them all. **Done grouping**, Back or ← when done.
- **Controls:** shuffle, previous, play/pause, next and queue; below them the volume, which turns
  every speaker in the group. The background takes its colour from the album cover.
- **Queue:** what's playing and what's next (the whole queue, with OK to jump to a song, once
  Music Assistant is connected; see below).
- **Library:** OK on a button opens its grid. OK on an artist, album or playlist opens it (an album
  or playlist starts with **Play all**). OK on a song or station plays it. Back goes up a level.

### The whole queue (optional)

Home Assistant tells the TV what's playing and what's next, not the whole queue. To see and jump
through the whole queue, connect the TV to Music Assistant itself:

1. In Music Assistant's web page, open your profile in Settings and create a long-lived token.
2. On the TV: **Settings → Home Assistant → Music Assistant**. Enter Music Assistant's address (usually your Home Assistant machine on port
   8095, for example `http://192.168.1.20:8095`), then the token.

Typing a token with the remote is slow: paste it with the Google TV remote in the Google Home app
on your phone (tap its keyboard while the token box is selected). Or hand it over with adb in one go
(adb's `input text` cuts long text off):

```
adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es maToken <token>
```

The address and token are kept on the TV only, never in `calm-tv.json`. Leave the address empty and
press OK to turn it off.

### If something's off

- **A speaker says Unavailable**: it's the wrong entity (often the Sonos/Cast one instead of the
  Music Assistant one), or Music Assistant can't reach it.
- **Library buttons missing**: Music Assistant names its folders Artists, Albums, Tracks,
  Playlists, Radio, Podcasts and Audiobooks. If yours differ, list your names in `library`.
- **Nothing happens on OK**: check in Home Assistant that the speaker plays when you start the
  same playlist from Music Assistant itself.
