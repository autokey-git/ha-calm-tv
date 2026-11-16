package io.github.neocarlos.hacalmtv

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the web page can ask Android to do, exposed to JavaScript as `window.CalmTvNative`.
 * MainActivity only loads Calm TV's own page, so no other site can call these.
 */
class NativeBridge(private val activity: Activity) {
    private val pm: PackageManager get() = activity.packageManager

    /** Installed TV apps, as JSON: [{ "pkg": "com.netflix.ninja", "label": "Netflix" }, ...]. */
    @JavascriptInterface
    fun apps(): String {
        val query = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        val out = JSONArray()
        pm.queryIntentActivities(query, 0)
            .map { it.activityInfo }
            .filter { it.packageName != activity.packageName }
            .distinctBy { it.packageName }
            .forEach {
                out.put(JSONObject().put("pkg", it.packageName).put("label", it.loadLabel(pm).toString()))
            }
        return out.toString()
    }

    /** Opens an installed app. Returns false if it isn't installed. */
    @JavascriptInterface
    fun launch(pkg: String): Boolean {
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg)
        if (intent == null) {
            Log.w(TAG, "Not installed: $pkg")
            return false
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.runOnUiThread { activity.startActivity(intent) }
        return true
    }

    /** Opens the TV's Settings. */
    @JavascriptInterface
    fun openSettings() {
        activity.runOnUiThread {
            activity.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    /**
     * Switches to Google's home screen. The Home button service leaves it alone until Calm TV
     * is opened again (from Google's apps row), which switches back.
     */
    @JavascriptInterface
    fun openGoogleHome() {
        Prefs.setUsingGoogleHome(activity, true)
        Log.i(TAG, "Switching to Google's home screen")
        val intent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .setClassName(GOOGLE_LAUNCHER, "$GOOGLE_LAUNCHER.home.HomeActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.runOnUiThread { activity.startActivity(intent) }
    }

    /** True while Calm TV is the app on screen. */
    @JavascriptInterface
    fun isInFront(): Boolean = MainActivity.inFront

    /**
     * Shows the doorbell video in a small window over the current app. Returns false if the Home
     * button service (which draws that window) isn't running.
     */
    @JavascriptInterface
    fun showDoorbell(): Boolean {
        val service = HomeButtonService.instance ?: return false
        service.showDoorbell(DoorbellLook())
        return true
    }

    /**
     * The same, sized and placed by calm-tv.json: JSON { "size": 75, "center": true, "pause": true }.
     * Bad or missing values fall back to the corner window.
     */
    @JavascriptInterface
    fun showDoorbellWith(look: String): Boolean {
        val service = HomeButtonService.instance ?: return false
        service.showDoorbell(DoorbellLook.parse(look))
        return true
    }

    /**
     * A door pop-up over the current app: JSON { "name": "Front door", "left": false }. Returns
     * false if the Home button service (which draws it) isn't running or the JSON is bad.
     */
    @JavascriptInterface
    fun showDoor(json: String): Boolean {
        val service = HomeButtonService.instance ?: return false
        val door = try {
            JSONObject(json)
        } catch (e: Exception) {
            return false
        }
        val name = door.optString("name").take(40)
        if (name.isEmpty()) return false
        service.showDoor(name, door.optBoolean("left"))
        return true
    }

    /** Home Assistant's address, or "" before it's set up. */
    @JavascriptInterface
    fun getHaUrl(): String = Prefs.haUrl(activity)

    /** Saves Home Assistant's address; returns the cleaned-up address, or "" if it isn't valid. */
    @JavascriptInterface
    fun setHaUrl(url: String): String = Prefs.setHaUrl(activity, url).orEmpty()

    /** Music Assistant's address and token set with adb, as JSON { url, token }, once; "" if none. */
    @JavascriptInterface
    fun takeMaSetup(): String = Prefs.takeMaHandoff(activity)

    /**
     * Calm TV's configuration, as JSON: { "source": "...", "text": "<the file>" } or { "error": "..." }.
     * See ConfigFile for where it looks. Fetched here rather than in the page because Home Assistant
     * doesn't let other sites (CORS) read its /local files.
     */
    @JavascriptInterface
    fun loadConfig(): String = ConfigFile.load(activity, Prefs.haUrl(activity)).toString()

    companion object {
        private const val TAG = "CalmTV"
        const val GOOGLE_LAUNCHER = "com.google.android.apps.tv.launcherx"
    }
}
