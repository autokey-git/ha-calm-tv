package io.github.neocarlos.hacalmtv

import org.json.JSONObject

/**
 * How the doorbell window looks over other apps, from calm-tv.json's "doorbell" options:
 * [size] is its width in % of the screen, [center] places it in the middle instead of the top-right
 * corner, and [pause] pauses whatever is playing when it opens.
 */
data class DoorbellLook(val size: Int = 34, val center: Boolean = false, val pause: Boolean = false) {
    companion object {
        fun parse(json: String): DoorbellLook = try {
            val o = JSONObject(json)
            DoorbellLook(
                size = o.optInt("size", 34).coerceIn(20, 100),
                center = o.optBoolean("center", false),
                pause = o.optBoolean("pause", false),
            )
        } catch (e: Exception) {
            DoorbellLook()
        }
    }
}
