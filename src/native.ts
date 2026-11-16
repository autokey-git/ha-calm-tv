import * as v from 'valibot';
// The Android side of Calm TV, when running inside the TV app (android/).
// In a desktop browser there is no bridge, and launches stay faked.

interface CalmTvNative {
  /** JSON: [{ pkg, label }] of installed TV apps. */
  apps(): string;
  /** Opens an installed app; false if it isn't installed. */
  launch(pkg: string): boolean;
  /** Opens Android's own TV settings. */
  openSettings(): void;
  /** Switches to Google's home screen until Calm TV is opened again. */
  openGoogleHome(): void;
  /** True while Calm TV is the app on screen. */
  isInFront?(): boolean;
  /** Shows the doorbell video in a small window over the current app; false if it can't. */
  showDoorbell?(): boolean;
  /** The same, sized and placed by JSON { size, center, pause } (see DoorbellLook); newer TV apps only. */
  showDoorbellWith?(look: string): boolean;
  /** A door pop-up in the corner over the current app, JSON { id, name, left, stay }; false if it can't. */
  showDoor?(json: string): boolean;
  /** Takes away a door's pop-up that stays ("left open"), by the id it was shown with. */
  hideDoor?(id: string): void;
  /** Home Assistant's address saved on the TV, or "". */
  getHaUrl?(): string;
  /** Saves Home Assistant's address; returns the cleaned-up address, or "" if invalid. */
  setHaUrl?(url: string): string;
  /** JSON: { source, text } with calm-tv.json's contents, or { error }. */
  loadConfig?(): string;
  /** Music Assistant's address and token given with adb, as JSON { url, token }, once; "" if none. */
  takeMaSetup?(): string;
}

declare global {
  interface Window {
    CalmTvNative?: CalmTvNative;
  }
}

export const native: CalmTvNative | undefined = window.CalmTvNative;

/** What the TV app's apps() returns. */
const InstalledApps = v.array(v.object({ pkg: v.string(), label: v.optional(v.string()) }));

/** Package names of installed TV apps, or null when not running on the TV. */
export function installedPackages(): Set<string> | null {
  if (!native) return null;

  try {
    const list = v.parse(InstalledApps, JSON.parse(native.apps()));

    return new Set(list.map((a) => a.pkg));
  } catch {
    return null;
  }
}
