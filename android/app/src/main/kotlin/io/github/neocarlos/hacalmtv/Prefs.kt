package io.github.neocarlos.hacalmtv

import android.content.Context
import android.net.Uri

/** Small settings shared by the home screen and the Home button service (same process). */
object Prefs {
    private const val FILE = "calmtv"
    private const val KEY_GOOGLE_HOME = "usingGoogleHome"
    private const val KEY_HA_URL = "haUrl"
    private const val KEY_MA_HANDOFF = "maHandoff"

    /**
     * True while you've switched to Google's home screen from Calm TV's Settings.
     * The Home button service leaves Google's home alone until you open Calm TV again.
     */
    fun usingGoogleHome(context: Context): Boolean =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY_GOOGLE_HOME, false)

    fun setUsingGoogleHome(context: Context, value: Boolean) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY_GOOGLE_HOME, value).apply()
    }

    /** Music Assistant's address and token from adb (see MainActivity), until the page takes them. */
    fun setMaHandoff(context: Context, json: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY_MA_HANDOFF, json).apply()
    }

    /** Returns the handed-off JSON once ("" if none), and forgets it. */
    fun takeMaHandoff(context: Context): String {
        val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        val json = prefs.getString(KEY_MA_HANDOFF, "").orEmpty()
        if (json.isNotEmpty()) prefs.edit().remove(KEY_MA_HANDOFF).apply()
        return json
    }

    /** Home Assistant's address, e.g. "http://192.168.1.20:8123" ("" until it's set up). */
    fun haUrl(context: Context): String =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY_HA_URL, "").orEmpty()

    /** Saves a cleaned-up address; returns it, or null if it isn't a plain http(s) address. */
    fun setHaUrl(context: Context, raw: String): String? {
        val url = normalizeUrl(raw) ?: return null
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY_HA_URL, url).apply()
        return url
    }

    /** "192.168.1.20:8123/" → "http://192.168.1.20:8123". Only scheme, host and port are kept. */
    fun normalizeUrl(raw: String): String? {
        var s = raw.trim()
        if (s.isEmpty()) return null
        if (!s.contains("://")) s = "http://$s"
        val u = Uri.parse(s)
        if (u.scheme != "http" && u.scheme != "https") return null
        val host = u.host?.takeIf { it.isNotBlank() } ?: return null
        return "${u.scheme}://$host" + (if (u.port > 0) ":${u.port}" else "")
    }
}
