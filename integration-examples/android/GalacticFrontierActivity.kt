// REFERENCE ONLY — not part of the OrbitBtc Android release branch.
// An isolated, landscape-only game screen. The rest of the app keeps its own
// orientation: when this Activity finishes, Android restores the caller's.
package com.orbitbtc.game

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.HapticFeedbackConstants
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class GalacticFrontierActivity : AppCompatActivity() {

    private lateinit var web: WebView

    /** Only this origin may run the game (and see the JS bridge). */
    private val gameUrl = "https://app.orbitbtc.example/galactic-frontier/"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE

        // Edge-to-edge + draw into display cutouts; the web HUD avoids them via insets.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // required for local saves / device prefs
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String) = !url.startsWith(gameUrl)
        }
        // Exposed as window.OrbitBtcGame — the game's platform layer feature-detects it.
        web.addJavascriptInterface(Bridge(), "OrbitBtcGame")

        hideSystemBars()
        pushInsetsToWeb()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Let the game save, then leave (the caller's orientation comes back).
                web.evaluateJavascript("window.__gfSave ? window.__gfSave() : null") { finish() }
            }
        })

        web.loadUrl(gameUrl)
    }

    private fun hideSystemBars() {
        val c = WindowInsetsControllerCompat(window, window.decorView)
        c.hide(WindowInsetsCompat.Type.systemBars())
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    /**
     * WebView env(safe-area-inset-*) support varies by WebView version, so the
     * Activity sends cutout + gesture-navigation insets (in CSS px) itself.
     */
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
            // Keep Android's back-swipe from stealing the joystick (API 29+, max 200dp per edge).
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

    override fun onPause() { web.onPause(); super.onPause() }      // game pauses on visibilitychange
    override fun onResume() { super.onResume(); web.onResume() }
    override fun onDestroy() { web.destroy(); super.onDestroy() }

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
    }
}
