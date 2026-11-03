// WebViewSupportParityMain.kt — pilote JSON de la politique WebView minimale.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-webview-support.test.ts` (jamais Gradle, jamais l'APK).
//
//   - `{"op":"decide","version":"120.0.6099.230"}` → support + majeure
//   - `{"op":"decide","version":null}`             → refus explicite
//   - `{"op":"meta"}`                              → seuils et phrase de support
package fr.veryslopnynotes.webviewsupport

import fr.veryslopnynotes.app.MIN_ANDROID_API
import fr.veryslopnynotes.app.MIN_WEBVIEW_MAJOR
import fr.veryslopnynotes.app.WEBVIEW_SUPPORT_STATEMENT
import fr.veryslopnynotes.app.WebViewSupport
import fr.veryslopnynotes.app.unsupportedWebViewMessage
import fr.veryslopnynotes.app.webViewMajor
import fr.veryslopnynotes.app.webViewSupport
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.text(key: String): String? = when (val v = fields[key]) {
    null -> throw IllegalArgumentException("pilote: $key absent")
    is JVal.Null -> null
    is JVal.Str -> v.value
    else -> throw IllegalArgumentException("pilote: $key n'est pas un texte")
}

private fun numberOrNull(value: Int?): JVal =
    value?.let { JVal.Num(it.toDouble()) } ?: JVal.Null

private class Driver {
    fun run(op: JVal.Obj): JVal {
        val name = (op.fields["op"] as? JVal.Str)?.value
            ?: throw IllegalArgumentException("pilote: op absent")
        return when (name) {
            "decide" -> {
                val version = op.text("version")
                val decision = webViewSupport(version)
                JVal.Obj(
                    linkedMapOf(
                        "supported" to JVal.Bool(decision is WebViewSupport.Supported),
                        "major" to numberOrNull(webViewMajor(version)),
                        "message" to JVal.Str(
                            if (decision is WebViewSupport.Unsupported) {
                                unsupportedWebViewMessage(decision.installedMajor)
                            } else {
                                ""
                            },
                        ),
                    ),
                )
            }
            "meta" -> JVal.Obj(
                linkedMapOf(
                    "minAndroid" to JVal.Num(MIN_ANDROID_API.toDouble()),
                    "minWebView" to JVal.Num(MIN_WEBVIEW_MAJOR.toDouble()),
                    "statement" to JVal.Str(WEBVIEW_SUPPORT_STATEMENT),
                ),
            )
            else -> throw IllegalArgumentException("pilote: opération inconnue : $name")
        }
    }
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    val driver = Driver()
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(Json.stringify(driver.run(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            stderr.println("port: ${e.javaClass.simpleName}: ${e.message}")
            stdout.println(
                Json.stringify(
                    JVal.Obj(
                        linkedMapOf(
                            "error" to JVal.Str(e.javaClass.simpleName),
                            "message" to JVal.Str(e.message ?: "inconnu"),
                        ),
                    ),
                ),
            )
        }
    }
}
