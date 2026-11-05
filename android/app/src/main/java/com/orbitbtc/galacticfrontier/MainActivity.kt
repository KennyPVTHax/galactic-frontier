package com.orbitbtc.galacticfrontier

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.HapticFeedbackConstants
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.JavascriptInterface
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Minimal, locked-down WebView host for Galactic Frontier.
 *
 *  - The game is bundled in assets/www and served from https://appassets.androidplatform.net via
 *    WebViewAssetLoader (a real https origin: localStorage saves persist, no file:// access).
 *  - Every request that is not that origin is answered with an empty 403, and the manifest has no
 *    INTERNET permission, so the web content cannot reach any server.
 *  - One tiny JS bridge (window.OrbitBtcGame) — see [Bridge]. It is the contract the game's
 *    platform layer already feature-detects (src/platform/platform.ts).
 *  - Landscape only, immersive, screen kept on while playing.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    private val host = "appassets.androidplatform.net"
    private val gameBase = "https://$host/assets/www/index.html"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(host)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        // The debug build can be inspected from desktop Chrome (chrome://inspect) to profile on a real device.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // local saves + device prefs
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setSupportZoom(false)
            builtInZoomControls = false
            @Suppress("DEPRECATION") saveFormData = false
            mediaPlaybackRequiresUserGesture = true
        }
        web.overScrollMode = WebView.OVER_SCROLL_NEVER
        web.isHapticFeedbackEnabled = true

        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url) ?: blocked()

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != host // never navigate away from the bundled game

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // GPU/renderer crash (low memory, driver bug): rebuild the Activity instead of killing the app.
                runOnUiThread { recreate() }
                return true
            }
        }
        web.addJavascriptInterface(Bridge(), "OrbitBtcGame")

        hideSystemBars()
        pushInsetsToWeb()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Let the game write its save, then leave.
                web.evaluateJavascript("window.__gfSave ? window.__gfSave() : null") { finish() }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(buildUrl(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        web.loadUrl(buildUrl(intent))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    /**
     * Optional launch flags for testers (adb): `--es quality basic|enhanced|ultra`, `--ez perf true`.
     * Only these whitelisted values reach the page; the game also exposes both in its Settings screen.
     */
    private fun buildUrl(i: Intent?): String {
        val q = i?.getStringExtra("quality")?.takeIf { it in setOf("basic", "enhanced", "ultra") }
        val perf = i?.getBooleanExtra("perf", false) == true
        val params = buildList {
            if (q != null) add("quality=$q")
            if (perf) add("perf=1")
        }
        return if (params.isEmpty()) gameBase else "$gameBase?${params.joinToString("&")}"
    }

    private fun blocked() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private fun hideSystemBars() {
        val c = WindowInsetsControllerCompat(window, window.decorView)
        c.hide(WindowInsetsCompat.Type.systemBars())
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    /** WebView env(safe-area-inset-*) support varies by version, so the cutout/gesture insets are pushed in CSS px. */
    private fun pushInsetsToWeb() {
        ViewCompat.setOnApplyWindowInsetsListener(web) { v, insets ->
            val cut = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            val gest = insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures())
            val d = resources.displayMetrics.density
            val t = (maxOf(cut.top, 0) / d).toInt()
            val r = (maxOf(cut.right, gest.right) / d).toInt()
            val b = (maxOf(cut.bottom, gest.bottom) / d).toInt()
            val l = (maxOf(cut.left, gest.left) / d).toInt()
            web.evaluateJavascript("window.__gfSetInsets && window.__gfSetInsets($t,$r,$b,$l)", null)
            // Keep Android's back-swipe gesture from stealing the left thumb-stick area (API 29+).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val h = v.height
                val excl = (200 * d).toInt()
                v.systemGestureExclusionRects = listOf(Rect(0, h - excl, (160 * d).toInt(), h))
            }
            insets
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onPause() {
        web.onPause() // the game also pauses itself on visibilitychange
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    /** window.OrbitBtcGame — the only native surface the page can reach. */
    inner class Bridge {
        @JavascriptInterface
        fun setLandscape(on: Boolean) = runOnUiThread {
            requestedOrientation = if (on) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }

        @JavascriptInterface
        fun haptic(ms: Int) = runOnUiThread {
            web.performHapticFeedback(if (ms >= 20) HapticFeedbackConstants.CONTEXT_CLICK else HapticFeedbackConstants.CLOCK_TICK)
        }

        @JavascriptInterface
        fun exitGame() = runOnUiThread { finish() }

        /** Device facts for performance reports (model, SoC, WebView version, refresh rate, RAM, thermal state). */
        @JavascriptInterface
        fun deviceInfo(): String {
            val o = JSONObject()
            o.put("manufacturer", Build.MANUFACTURER)
            o.put("model", Build.MODEL)
            o.put("device", Build.DEVICE)
            o.put("androidRelease", Build.VERSION.RELEASE)
            o.put("sdk", Build.VERSION.SDK_INT)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) o.put("soc", "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}")
            val wv = WebViewCompat.getCurrentWebViewPackage(this@MainActivity)
            o.put("webView", wv?.let { "${it.packageName} ${it.versionName}" } ?: "unknown")
            @Suppress("DEPRECATION")
            o.put("refreshRateHz", windowManager.defaultDisplay.refreshRate.toDouble())
            val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
            o.put("totalRamMb", mi.totalMem / (1024 * 1024))
            o.put("memoryClassMb", am.memoryClass)
            o.put("lowRamDevice", am.isLowRamDevice)
            o.put("cores", Runtime.getRuntime().availableProcessors())
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            o.put("powerSaveMode", pm.isPowerSaveMode)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) o.put("thermalStatus", pm.currentThermalStatus) // 0 none … 6 shutdown
            o.put("app", "${BuildConfig.APPLICATION_ID} ${BuildConfig.VERSION_NAME} ${BuildConfig.BUILD_TYPE}")
            return o.toString()
        }

        /** Current thermal status (0 none … 6 shutdown); -1 when the OS does not report it. */
        @JavascriptInterface
        fun thermalStatus(): Int {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return -1
            return (getSystemService(Context.POWER_SERVICE) as PowerManager).currentThermalStatus
        }

        /** Saves a performance report to the app's external files dir (pull with adb) and returns its path. */
        @JavascriptInterface
        fun saveReport(json: String): String = try {
            val dir = getExternalFilesDir(null) ?: filesDir
            val f = File(dir, "gf-perf-${System.currentTimeMillis()}.json")
            f.writeText(json)
            f.absolutePath
        } catch (e: Exception) {
            "error: ${e.message}"
        }

        /** Opens the Android share sheet with the report text (e-mail it, save to Drive, …). */
        @JavascriptInterface
        fun shareReport(text: String) = runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, "Galactic Frontier performance report")
                putExtra(Intent.EXTRA_TEXT, text.take(200_000))
            }
            startActivity(Intent.createChooser(send, "Share performance report"))
        }
    }
}
