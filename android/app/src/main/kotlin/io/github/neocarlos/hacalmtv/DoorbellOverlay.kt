package io.github.neocarlos.hacalmtv

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * The doorbell video in a small window over whatever app is on screen (YouTube, Netflix...).
 *
 * The Home button service owns it: an accessibility service can draw this kind of window without
 * the "display over other apps" permission. The window never takes focus or touches, so the
 * remote keeps controlling the show. It shows Calm TV's own page in doorbell mode
 * (index.html?doorbell), which closes it when the ring is over; a timer closes it regardless.
 */
class DoorbellOverlay(private val service: AccessibilityService, private val onClosed: () -> Unit) {
    private val wm = service.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var web: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    fun show(pageUrl: String, look: DoorbellLook) {
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
            addJavascriptInterface(Bridge(), "CalmTvDoorbell")
            webChromeClient = NoPosterChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                // Only Calm TV's own page, never another site.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    !(request.url.scheme == start.scheme && request.url.host == start.host && request.url.port == start.port)
            }
        }

        // 16:9, look.size % of the screen wide (a third by default). In the top-right corner, clear of
        // app docks and player controls, or centred.
        val screen = service.resources.displayMetrics
        val width = (screen.widthPixels * look.size / 100f).toInt()
        val margin = if (look.center) 0 else (screen.widthPixels * 0.03).toInt()
        val params = WindowManager.LayoutParams(
            width,
            width * 9 / 16,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = if (look.center) Gravity.CENTER else Gravity.TOP or Gravity.END
            x = margin
            y = margin
        }

        try {
            wm.addView(w, params)
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't show the doorbell window", e)
            w.destroy()
            onClosed()
            return
        }
        web = w
        Log.i(TAG, "Doorbell window shown")
        w.loadUrl(start.buildUpon().appendQueryParameter("doorbell", "1").build().toString())
        handler.postDelayed({ close() }, MAX_SHOW_MS)
    }

    fun close() {
        handler.removeCallbacksAndMessages(null)
        val w = web ?: return
        web = null
        try {
            wm.removeView(w)
        } catch (e: Exception) {
            Log.w(TAG, "Doorbell window was already gone", e)
        }
        w.destroy()
        Log.i(TAG, "Doorbell window closed")
        onClosed()
    }

    /** Exposed to the doorbell page as `window.CalmTvDoorbell`. */
    inner class Bridge {
        @JavascriptInterface
        fun close() {
            handler.post { this@DoorbellOverlay.close() }
        }
    }

    companion object {
        private const val TAG = "CalmTV"
        /** HA turns "Doorbell ringing" off after 60 s; this is the backstop. */
        private const val MAX_SHOW_MS = 90_000L
    }
}
