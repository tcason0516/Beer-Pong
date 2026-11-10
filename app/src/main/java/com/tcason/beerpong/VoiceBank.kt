package com.tcason.beerpong

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.Locale

/**
 * Turns lines of dialogue into WAV files using the phone's text-to-speech engine,
 * so the game can mix them with reverb, panning and crowd noise through Web Audio.
 * Files are cached between launches.
 */
class VoiceBank(
    context: Context,
    private val outDir: File,
    private val eval: (String) -> Unit
) {
    private data class Job(
        val id: String, val text: String, val voice: String,
        val pitch: Float, val rate: Float, val file: File
    )

    private val main = Handler(Looper.getMainLooper())
    private val queue = ArrayDeque<Job>()
    private var busy: Job? = null
    @Volatile private var status = "init"
    private var voices: List<Voice> = emptyList()
    private lateinit var tts: TextToSpeech

    init {
        tts = TextToSpeech(context.applicationContext) { result ->
            main.post { onInit(result) }
        }
    }

    private fun onInit(result: Int) {
        if (result != TextToSpeech.SUCCESS) {
            status = "error"; return
        }
        try {
            tts.setLanguage(Locale.US)
            voices = (tts.voices ?: emptySet<Voice>())
                .filter { v ->
                    v.locale.language == "en" &&
                        !v.isNetworkConnectionRequired &&
                        !v.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
                }
                .sortedBy { it.name }
        } catch (e: Exception) {
            voices = emptyList()
        }
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) { main.post { finish(true) } }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { main.post { finish(false) } }
            override fun onError(utteranceId: String?, errorCode: Int) { main.post { finish(false) } }
        })
        status = "ready"
        pump()
    }

    @JavascriptInterface
    fun status(): String = status

    /** JSON array of {name, locale, quality} for offline English voices. */
    @JavascriptInterface
    fun voices(): String {
        val arr = JSONArray()
        for (v in voices) {
            arr.put(JSONObject().apply {
                put("name", v.name)
                put("locale", v.locale.toLanguageTag())
                put("quality", v.quality)
            })
        }
        return arr.toString()
    }

    /** Queue a line. When ready the page receives window.__nv.done(id, url) or __nv.fail(id). */
    @JavascriptInterface
    fun synth(id: String, text: String, voice: String, pitch: Float, rate: Float) {
        val key = sha1("$voice|$pitch|$rate|$text")
        val file = File(outDir, "$key.wav")
        val job = Job(id, text, voice, pitch, rate, file)
        main.post {
            if (file.exists() && file.length() > 1000) {
                done(job)
            } else {
                queue.add(job); pump()
            }
        }
    }

    private fun pump() {
        if (status != "ready" || busy != null) return
        val job = queue.poll() ?: return
        busy = job
        try {
            voices.firstOrNull { it.name == job.voice }?.let { tts.setVoice(it) }
            tts.setPitch(job.pitch)
            tts.setSpeechRate(job.rate)
            val tmp = File(outDir, job.file.name + ".part")
            val r = tts.synthesizeToFile(job.text, Bundle(), tmp, job.id)
            if (r != TextToSpeech.SUCCESS) finish(false)
        } catch (e: Exception) {
            finish(false)
        }
    }

    private fun finish(ok: Boolean) {
        val job = busy ?: return
        busy = null
        val tmp = File(outDir, job.file.name + ".part")
        if (ok && tmp.exists() && tmp.length() > 1000 && tmp.renameTo(job.file)) {
            done(job)
        } else {
            tmp.delete()
            eval("window.__nv && window.__nv.fail(${JSONObject.quote(job.id)})")
        }
        pump()
    }

    private fun done(job: Job) {
        val url = "https://appassets.androidplatform.net/tts/" + job.file.name
        eval("window.__nv && window.__nv.done(${JSONObject.quote(job.id)}, ${JSONObject.quote(url)})")
    }

    fun shutdown() {
        try { tts.stop(); tts.shutdown() } catch (_: Exception) {}
    }

    private fun sha1(s: String): String {
        val d = MessageDigest.getInstance("SHA-1").digest(s.toByteArray())
        return d.joinToString("") { "%02x".format(it) }
    }
}
