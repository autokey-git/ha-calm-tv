# TV setup: install, make it the home screen, debug

Built and tested on a **Google TV Streamer (2024)**. Other Google TV / Android TV devices on Android 12+
(`minSdk 31`) should run it, but live blur and video backgrounds lean on the Streamer's hardware. On a
slower device, turn off video backgrounds or visual effects (frosted glass and screen fades) in
**Settings → Appearance**, and turn on *Show frame rate* to compare. To make your choice the default for every TV, use `display` in `calm-tv.json`
([configuration.md](configuration.md#display-look-options)).

## 1. Connect a computer to the TV with adb

1. On the TV: Settings → System → About → click **Android TV OS build** 7 times to unlock
   developer options.
2. Settings → System → Developer options → turn on **Wireless debugging** (or USB debugging).
3. Under Wireless debugging → **Pair device with pairing code**. On the computer:
   ```bash
   adb pair <tv-ip>:<pairing-port>      # enter the 6-digit code shown on the TV
   adb connect <tv-ip>:<port>           # the port shown on the Wireless debugging screen
   adb devices                          # should list the TV
   ```
   The connect port changes when wireless debugging restarts. Check the TV's screen if `adb connect` fails.

## 2. Install the app

Use a ready-made `calm-tv.apk`, if you were given one, or build your own (section 7):

```bash
adb install -r calm-tv.apk
```

## 3. Make it the home screen

Google TV sends the remote's Home button to its own launcher, whichever app is chosen as home. Calm TV
fixes that with a small **accessibility service** (`HomeButtonService`). It catches Home and, as a
backup, replaces Google's home screen the moment it appears. Turn both on:

```bash
# Calm TV as the default home app
adb shell cmd package set-home-activity --user 0 io.github.neocarlos.hacalmtv/.MainActivity

# The Home button service. This REPLACES the list of enabled accessibility services, so check first:
adb shell settings get secure enabled_accessibility_services
# If that printed "null" or nothing:
adb shell settings put secure enabled_accessibility_services io.github.neocarlos.hacalmtv/io.github.neocarlos.hacalmtv.HomeButtonService
# Otherwise, append ours: "<what it printed>:io.github.neocarlos.hacalmtv/io.github.neocarlos.hacalmtv.HomeButtonService"
adb shell settings put secure accessibility_enabled 1
```

Press Home. You should land on Calm TV.

**After every update of the app, turn the service on again.** Android switches an accessibility
service off whenever its app is reinstalled or updated (`adb install`, `npm run tv:install`, a new
APK). Until it's back on, Home goes to Google's home screen, and the doorbell window, door pop-ups and
the ★ panel don't show over other apps. Calm TV says so the first time it opens after such an update,
and **Settings → Home button** shows whether it's on and opens the TV's settings for it. On the TV:
**Settings → System → Accessibility → Calm TV: Home button → On**. (Or the adb commands above.)

- **Back to Google's home screen** at any time: Calm TV → Settings → **Google TV home**.
  Opening Calm TV from Google's apps row switches back.
- **Remove it completely:** `adb uninstall io.github.neocarlos.hacalmtv`, then remove the service from
  `enabled_accessibility_services` as above.

## 4. Point it at Home Assistant and sign in

On first start Calm TV asks for **Home Assistant's address**. Type it with the remote, for
example `http://192.168.1.20:8123`, and press OK. It goes straight on to Home Assistant's own login
page: sign in as the TV's user ([home-assistant.md](home-assistant.md)), and you're back in Calm TV,
connected. That's the only sign-in.

To skip typing the address, set it from a computer, then sign in from Settings → **Home Assistant**:

```bash
adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es haUrl http://192.168.1.20:8123
```

Change the address later in Settings → **Home Assistant address**. Signing out is in Settings → Home
Assistant, and takes two presses of OK so a stray press can't do it.

## 5. Give it your home

Put `calm-tv.json` in Home Assistant's `www` folder, or push it to the TV:

```bash
adb push calm-tv.json /sdcard/Android/data/io.github.neocarlos.hacalmtv/files/calm-tv.json
```

Then reopen Calm TV. See [configuration.md](configuration.md).

## 6. Building the APK yourself

You need these:
- **Node.js 20+**
- **JDK 17+** (21 works)
- **Android SDK** with platform 35 and build tools. Android Studio installs these; so does the command-line `sdkmanager`.
- **Where to find the SDK:** set `ANDROID_HOME`, or create `android/local.properties` containing
  `sdk.dir=/path/to/Android/sdk`. That file is machine-specific; don't share it.

```bash
npm install
export JAVA_HOME=/path/to/jdk          # e.g. on a Mac with Homebrew: /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
npm run tv:apk                         # → android/app/build/outputs/apk/debug/app-debug.apk
npm run tv:install                     # or build and install on the connected TV in one go
```

These are **debug** builds, signed with your machine's debug key. Installing a build signed with a
different key over an existing install fails. Run `adb uninstall io.github.neocarlos.hacalmtv` first; that also
clears the saved address and sign-in.

After installing, turn the Home button service on again (see step 3): an update switches it off.

`npm run build` alone only builds the web page into `dist/`. The TV app carries its own copy, made by
`build:android`, so always use `tv:apk` or `tv:install` for the TV.

## 7. Developing

**In a desktop browser (fastest):**
1. Put `VITE_HA_URL=http://<ha>:8123` in `.env.local`, and your `calm-tv.json` in the project
   folder.
2. Run `npm run dev` and open http://localhost:5173. The arrow keys, Enter and Esc act as the remote.
   **W** cycles photos.
3. Signing in from the browser works like on the TV. Or use a **dev token**:
   - Create a long-lived token in HA: your profile → Security.
   - Save it to `~/.config/homeassistant/token` (`chmod 600`).
   - Run `CT_DEV_TOKEN=1 npm run dev` and open http://localhost:5173/?devtoken.

   The dev server hands that token only to pages on the same computer, and it's never part of a build.
   Careful: controls then act on your real house with that user's rights.

**The TV loading the dev server (debug builds):**
```bash
adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es devUrl http://<computer-ip>:5173/
adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es devUrl ""     # back to the built-in page
```

**Inspecting the TV's page:** with adb connected, open `chrome://inspect` in Chrome on the computer.
Debug builds expose the WebView there: console, DOM, network, `localStorage`.

**Logs:** `adb logcat -s CalmTV` for the Android side, and `adb logcat | grep '\[CalmTV\]'` for the page, which logs every Home Assistant connection change, sign-in and sign-out. Remote key presses are logged in debug builds under the `CalmTVKeys` tag,
except keys that type text.
