package io.github.neocarlos.hacalmtv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * The home screen: one full-screen WebView showing the Calm TV web app.
 *
 * Release builds load the web app bundled in assets/web (built with `npm run build:android`).
 * Debug builds can instead load the Vite dev server, set once with:
 *   adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es devUrl http://<mac-ip>:5173/
 * and cleared with `--es devUrl ""`.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var startUrl: Uri

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        rememberDevUrl(intent)
        rememberHaUrl(intent)
        rememberMa(intent)
        // Creates /sdcard/Android/data/io.github.neocarlos.hacalmtv/files/, where a config file can be pushed with adb.
        getExternalFilesDir(null)

        // Served over http (not https) so the page can reach Home Assistant over plain http (on the
        // LAN or a VPN like Tailscale): browsers block http requests and websockets from https pages.
        val assets = WebViewAssetLoader.Builder()
            .setHttpAllowed(true)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        startUrl = Uri.parse(devUrl() ?: BUNDLED_URL)
        pageUrl = startUrl.toString()
        Log.i(TAG, "Loading $startUrl")

        web = WebView(this).apply {
            setBackgroundColor(0xFF000000.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            isFocusable = true
            isFocusableInTouchMode = true
            // The page draws its own focus; hide the WebView's own focus highlight.
            defaultFocusHighlightEnabled = false
            addJavascriptInterface(NativeBridge(this@MainActivity), "CalmTvNative")
            webChromeClient = NoPosterChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    albumArt(request.url) ?: assets.shouldInterceptRequest(request.url)

                // Stay on Calm TV's own page, plus your Home Assistant for its sign-in page.
                // The native bridge must never be exposed to any other site.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    !(sameOrigin(request.url, startUrl) || isHomeAssistant(request.url))
            }
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        setContentView(web)
        web.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        web.loadUrl(demoUrl(intent) ?: startUrl.toString())
        web.requestFocus()
    }

    /** Home pressed while Calm TV is already open (or brought back by the Home button service). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (rememberDevUrl(intent) or rememberHaUrl(intent) or rememberMa(intent)) {
            recreate()
            return
        }
        if (intent.hasExtra(KEY_DEMO)) {
            web.loadUrl(demoUrl(intent) ?: startUrl.toString())
            return
        }
        // Home while on Home Assistant's sign-in page: give up on signing in, back to Calm TV.
        val current = web.url?.let(Uri::parse)
        if (current != null && !sameOrigin(current, startUrl)) {
            web.loadUrl(startUrl.toString())
            return
        }
        js("window.dispatchEvent(new Event('ct-home'))")
    }

    override fun onResume() {
        super.onResume()
        inFront = true
        // Opening Calm TV (e.g. from Google's apps row) switches back from Google's home screen.
        if (Prefs.usingGoogleHome(this)) {
            Log.i(TAG, "Back to Calm TV as the home screen")
            Prefs.setUsingGoogleHome(this, false)
        }
        js("window.dispatchEvent(new Event('ct-resume'))")
    }

    override fun onPause() {
        super.onPause()
        inFront = false
        // Stop a video background while another app or the screensaver is in front.
        js("window.dispatchEvent(new Event('ct-pause'))")
    }

    /** Back never leaves the home screen; the page treats it as Escape (close a panel, etc.). */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) {
                js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun js(code: String) {
        if (::web.isInitialized) web.evaluateJavascript(code, null)
    }

    private fun devUrl(): String? =
        if (BuildConfig.DEBUG) getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_DEV_URL, null) else null

    /** Returns true if the intent changed the dev URL. */
    private fun rememberDevUrl(intent: Intent?): Boolean {
        if (!BuildConfig.DEBUG || intent?.hasExtra(KEY_DEV_URL) != true) return false
        val url = intent.getStringExtra(KEY_DEV_URL)?.trim().orEmpty()
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().apply {
            if (url.isEmpty()) remove(KEY_DEV_URL) else putString(KEY_DEV_URL, url)
        }.apply()
        Log.i(TAG, "Dev URL set to '${url}'")
        intent.removeExtra(KEY_DEV_URL)
        return true
    }

    /**
     * Sets Home Assistant's address without typing it on the TV, in any build:
     *   adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es haUrl http://192.168.1.20:8123
     * Returns true if the intent changed it.
     */
    private fun rememberHaUrl(intent: Intent?): Boolean {
        if (intent?.hasExtra(KEY_HA_URL) != true) return false
        val url = Prefs.setHaUrl(this, intent.getStringExtra(KEY_HA_URL).orEmpty())
        Log.i(TAG, if (url != null) "Home Assistant set to $url" else "Ignored an invalid Home Assistant address")
        intent.removeExtra(KEY_HA_URL)
        return url != null
    }

    /**
     * Hands Music Assistant's address and token to the page without typing (a token is too long
     * for adb's input text), for the Music panel's full queue:
     *   adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es maToken <token> --es maUrl http://192.168.1.20:8095
     * maUrl is optional. The token itself is never logged. Returns true if the intent had one.
     */
    private fun rememberMa(intent: Intent?): Boolean {
        if (intent?.hasExtra(KEY_MA_TOKEN) != true) return false
        val json = org.json.JSONObject()
            .put("token", intent.getStringExtra(KEY_MA_TOKEN).orEmpty().trim())
            .put("url", intent.getStringExtra(KEY_MA_URL).orEmpty().trim())
        Prefs.setMaHandoff(this, json.toString())
        Log.i(TAG, "Music Assistant token handed to the page")
        intent.removeExtra(KEY_MA_TOKEN)
        intent.removeExtra(KEY_MA_URL)
        return true
    }

    /**
     * Demo mode (a made-up home; see src/demo.ts) until the app restarts, e.g. for recording:
     *   adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es demo ""
     *   adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es demo "at=2026-11-14T18:30"
     *   adb shell am start -n io.github.neocarlos.hacalmtv/.MainActivity --es demo off
     * The value is added to the page's address after ?demo; "off" goes back to your home.
     * Returns the page to load, or null for the usual one.
     */
    private fun demoUrl(intent: Intent?): String? {
        if (intent?.hasExtra(KEY_DEMO) != true) return null
        val extra = intent.getStringExtra(KEY_DEMO)?.trim().orEmpty()
        intent.removeExtra(KEY_DEMO)
        if (extra == "off") return null
        Log.i(TAG, "Demo mode")
        return startUrl.buildUpon().clearQuery().encodedQuery(if (extra.isEmpty()) "demo" else "demo&$extra").build().toString()
    }

    /** Your Home Assistant (as set up on this TV), for its sign-in page. */
    /**
     * Album art handed to the page as if it were its own (/calmtv-art?u=...), so the Music panel
     * can read the cover's colours for its background; a page can't read the pixels of a picture
     * from another address. The cover can be on Home Assistant or on Music Assistant's own server,
     * so any http(s) address is fetched, and only a picture is passed on. Only Calm TV's own page
     * can ask. (WebView asks on a background thread, so the download doesn't hold up the page.)
     */
    private fun albumArt(url: Uri): WebResourceResponse? {
        if (url.path != "/calmtv-art" || !sameOrigin(url, startUrl)) return null
        val target = url.getQueryParameter("u")?.let(Uri::parse) ?: return null
        if (target.scheme != "http" && target.scheme != "https") return WebResourceResponse("text/plain", null, 403, "Forbidden", emptyMap(), null)
        return try {
            val conn = java.net.URL(target.toString()).openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 10000
            val type = conn.contentType?.substringBefore(';')?.trim() ?: ""
            if (conn.responseCode != 200 || !type.startsWith("image/")) {
                Log.w(TAG, "Album art: ${conn.responseCode} $type from ${target.host}")
                conn.disconnect()
                WebResourceResponse("text/plain", null, 404, "Not Found", emptyMap(), null)
            } else {
                WebResourceResponse(type, null, conn.inputStream)
            }
        } catch (e: java.io.IOException) {
            Log.w(TAG, "Album art: ${e.message}")
            WebResourceResponse("text/plain", null, 404, "Not Found", emptyMap(), null)
        }
    }

    private fun isHomeAssistant(url: Uri): Boolean {
        val ha = Prefs.haUrl(this).takeIf { it.isNotEmpty() } ?: return false
        return sameOrigin(url, Uri.parse(ha))
    }

    private fun sameOrigin(a: Uri, b: Uri): Boolean =
        a.scheme == b.scheme && a.host == b.host && a.port == b.port

    companion object {
        private const val TAG = "CalmTV"
        private const val PREFS = "calmtv"
        private const val KEY_DEV_URL = "devUrl"
        private const val KEY_HA_URL = "haUrl"
        private const val KEY_DEMO = "demo"
        private const val KEY_MA_TOKEN = "maToken"
        private const val KEY_MA_URL = "maUrl"
        const val BUNDLED_URL = "http://appassets.androidplatform.net/assets/web/index.html"

        /** The page Calm TV loaded (the dev server in debug builds, if set). */
        @Volatile
        var pageUrl: String? = null
            private set

        /** True while Calm TV is the app on screen. */
        @Volatile
        var inFront = false
            private set
    }
}
