package io.github.neocarlos.hacalmtv

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Makes the remote's Home button open Calm TV. Google TV sends Home to its own launcher no
 * matter which app holds the Home role, so this accessibility service does two things:
 *  1. Catches the Home key itself, when Android lets it see that key.
 *  2. As a backup, watches for Google's home screen appearing and immediately replaces it.
 *
 * Debug builds also log remote button presses (tag CalmTVKeys), to learn what the YouTube
 * button sends. Keys that type text are never logged.
 */
class HomeButtonService : AccessibilityService() {
    private var doorbell: DoorbellOverlay? = null
    private var doors: DoorPopups? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onUnbind(intent: Intent?): Boolean {
        doorbell?.close()
        doors?.close()
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    /** Doorbell video over the current app (see DoorbellOverlay). Safe to call from any thread. */
    fun showDoorbell(look: DoorbellLook) {
        Handler(Looper.getMainLooper()).post {
            if (doorbell != null) return@post
            if (look.pause) pausePlayback()
            val overlay = DoorbellOverlay(this) { doorbell = null }
            doorbell = overlay
            overlay.show(MainActivity.pageUrl ?: MainActivity.BUNDLED_URL, look)
        }
    }

    /** A door pop-up in the corner over the current app (see DoorPopups). Safe to call from any thread. */
    fun showDoor(id: String, name: String, left: Boolean, stay: Boolean) {
        Handler(Looper.getMainLooper()).post {
            val popups = doors ?: DoorPopups(this).also { doors = it }
            popups.show(id, name, left, stay)
        }
    }

    /** Takes away a door's pop-up that stays (see showDoor). */
    fun hideDoor(id: String) {
        Handler(Looper.getMainLooper()).post { doors?.hide(id) }
    }

    /** Pauses whatever app is playing (Netflix, YouTube...) the same way a remote's pause button does. */
    private fun pausePlayback() {
        val audio = getSystemService(AudioManager::class.java)
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE))
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE))
        Log.i(TAG, "Paused playback for the doorbell")
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        // Debug builds only, and never keys that type text.
        if (BuildConfig.DEBUG && !event.isPrintingKey) {
            Log.i(
                KEY_TAG,
                "${KeyEvent.keyCodeToString(event.keyCode)} action=${event.action} scan=${event.scanCode} " +
                    "device=${event.device?.name}"
            )
        }
        // While the doorbell window is up, Back closes it instead of reaching the app underneath.
        val bell = doorbell
        if (bell != null && event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) bell.close()
            return true
        }
        if (event.keyCode == KeyEvent.KEYCODE_HOME && !Prefs.usingGoogleHome(this)) {
            if (event.action == KeyEvent.ACTION_UP) showCalmTv("home key")
            return true
        }
        return false
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        val cls = event.className?.toString().orEmpty()
        if (pkg == GOOGLE_LAUNCHER) Log.i(TAG, "Google launcher window: $cls")
        // Only Google's main home screen: leave its other screens (search, profiles, etc.) alone.
        // Leave it alone if Google's home screen was chosen in Calm TV's Settings.
        if (pkg == GOOGLE_LAUNCHER && cls.endsWith(".home.HomeActivity") && !Prefs.usingGoogleHome(this)) {
            showCalmTv("google home appeared")
        }
    }

    override fun onInterrupt() {}

    private fun showCalmTv(reason: String) {
        Log.i(TAG, "Showing Calm TV ($reason)")
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        )
    }

    companion object {
        private const val TAG = "CalmTV"
        private const val KEY_TAG = "CalmTVKeys"
        private const val GOOGLE_LAUNCHER = "com.google.android.apps.tv.launcherx"

        /** The running service, if Android has it enabled. */
        @Volatile
        var instance: HomeButtonService? = null
            private set
    }
}
