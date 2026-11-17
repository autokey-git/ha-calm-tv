package io.github.neocarlos.hacalmtv

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * The ★ side panel: Home Assistant controls in a window on the right, over whatever is playing.
 *
 * Like the doorbell window, it never takes focus, so the show underneath keeps playing and keeps
 * its place. Instead, while the panel is open the Home button service hands it the arrows, OK and
 * Back (see [key]); every other button (volume, play/pause...) still reaches the show. The page is
 * Calm TV's own, in panel mode (index.html?panel). It closes itself after a minute untouched.
 */
class SidePanelOverlay(private val service: AccessibilityService, private val onClosed: () -> Unit) {
    private val wm = service.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var web: WebView? = null

    val isOpen: Boolean get() = web != null

    @SuppressLint("SetJavaScriptEnabled")
    fun show(pageUrl: String) {
        if (web != null) return
        val start = Uri.parse(pageUrl)
        val assets = WebViewAssetLoader.Builder()
            .setHttpAllowed(true)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(service))
            .build()

        val w = WebView(service).apply {
            setBackgroundColor(0)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            isFocusable = false
            addJavascriptInterface(Bridge(), "CalmTvPanel")
            webChromeClient = NoPosterChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                // Only Calm TV's own page, never another site.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    !(request.url.scheme == start.scheme && request.url.host == start.host && request.url.port == start.port)

                // The page's renderer crashed (or was killed for memory): close the panel instead of
                // letting the crash take down the app and the Home button service with it.
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    Log.w(TAG, "Side panel's page crashed")
                    handler.post { close() }
                    return true
                }
            }
        }

        // The page is laid out 684 wide for a 1920-wide screen (a 620-wide panel and its margins).
        val screen = service.resources.displayMetrics
        val params = WindowManager.LayoutParams(
            screen.widthPixels * 684 / 1920,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
        }

        try {
            wm.addView(w, params)
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't show the side panel", e)
            w.destroy()
            onClosed()
            return
        }
        web = w
        Log.i(TAG, "Side panel shown")
        w.loadUrl(start.buildUpon().appendQueryParameter("panel", "1").build().toString())
        stillThere()
    }

    /**
     * A remote button while the panel is open. Returns true when the panel used it, so it doesn't
     * also reach the show underneath. Arrows and OK go to the page; Back goes to the page too (it
     * closes a camera, then the panel itself). If the page doesn't take Back (it hasn't loaded, broke,
     * or is an older version), the panel closes here, so Back can never be trapped.
     */
    fun key(event: KeyEvent): Boolean {
        val w = web ?: return false
        val name = when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
            KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
            KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
            KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "Enter"
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> "Escape"
            else -> return false
        }
        // Arrows act on press (and repeat while held); OK and Back act once, on press.
        val act = event.action == KeyEvent.ACTION_DOWN && (event.repeatCount == 0 || name.startsWith("Arrow"))
        if (act) {
            stillThere()
            // dispatchEvent answers false when the page called preventDefault, i.e. handled the key.
            w.evaluateJavascript(
                "document.dispatchEvent(new KeyboardEvent('keydown',{key:'$name',bubbles:true,cancelable:true}))",
            ) { handled -> if (name == "Escape" && handled != "false") handler.post { close() } }
        }
        return true
    }

    fun close() {
        handler.removeCallbacksAndMessages(null)
        val w = web ?: return
        web = null
        try {
            wm.removeView(w)
        } catch (e: Exception) {
            Log.w(TAG, "Side panel was already gone", e)
        }
        w.destroy()
        Log.i(TAG, "Side panel closed")
        onClosed()
    }

    /** Restarts the "close when untouched" timer. */
    private fun stillThere() {
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ close() }, IDLE_CLOSE_MS)
    }

    /** Exposed to the panel page as `window.CalmTvPanel` (see DoorbellOverlay.Bridge). */
    inner class Bridge {
        @JavascriptInterface
        fun close() {
            handler.post { this@SidePanelOverlay.close() }
        }

        @JavascriptInterface
        fun getHaUrl(): String = Prefs.haUrl(service)

        @JavascriptInterface
        fun loadConfig(): String = ConfigFile.load(service, Prefs.haUrl(service)).toString()
    }

    companion object {
        private const val TAG = "CalmTV"
        private const val IDLE_CLOSE_MS = 60_000L
    }
}
