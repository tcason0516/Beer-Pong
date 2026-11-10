package com.tcason.beerpong

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.File

/**
 * Hosts the 3D game (Three.js / WebGL) in a full-screen WebView.
 * Game files live in assets/game. Voice clips synthesized by [VoiceBank]
 * are written to cacheDir/tts and served to the page under /tts/.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var voiceBank: VoiceBank

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val ttsDir = File(cacheDir, "tts").apply { mkdirs() }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/tts/", WebViewAssetLoader.InternalStoragePathHandler(this, ttsDir))
            .build()

        webView = WebView(this)
        webView.setBackgroundColor(Color.BLACK)
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
        }

        voiceBank = VoiceBank(this, ttsDir) { js ->
            runOnUiThread { webView.evaluateJavascript(js, null) }
        }
        webView.addJavascriptInterface(voiceBank, "NativeVoice")

        webView.loadUrl("https://appassets.androidplatform.net/assets/game/index.html")
        hideSystemUi()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }
    }

    override fun onPause() {
        super.onPause()
        webView.evaluateJavascript("window.onAppPause && window.onAppPause()", null)
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.evaluateJavascript("window.onAppResume && window.onAppResume()", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        webView.evaluateJavascript("(window.onBackButton && window.onBackButton()) ? 1 : 0") { r ->
            if (r != "1") {
                @Suppress("DEPRECATION")
                super@MainActivity.onBackPressed()
            }
        }
    }

    override fun onDestroy() {
        voiceBank.shutdown()
        webView.destroy()
        super.onDestroy()
    }
}
