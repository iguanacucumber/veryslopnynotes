// WebRouteParityMain.kt — pilote JSON de la route de l'interface web (#400).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-web-route.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE source de
// production `fr.veryslopnynotes.app.WebRouteState` (logique pure : ni Android
// ni réseau) et la pilote ici : les assertions portent donc sur du code
// EXÉCUTÉ, pas sur un miroir TS.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`.
//   - `{"op":"route","url":"…#/grades"}` → `{"path":"/grades"}` (ou `null`)
//   - `{"op":"state","path":"/grades"}`  → `{"path":"/grades"}` (ou `null`)
//   - `{"op":"routes"}`                  → `{"routes":["/","/alerts",…]}`
//   - `{"op":"meta"}`                    → `{"home":"/","key":"…"}`
package fr.veryslopnynotes.webroute

import fr.veryslopnynotes.app.HOME_ROUTE
import fr.veryslopnynotes.app.ROUTE_STATE_KEY
import fr.veryslopnynotes.app.WEB_ROUTES
import fr.veryslopnynotes.app.routePathFromState
import fr.veryslopnynotes.app.routePathFromUrl
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

/**
 * Un texte de l'opération : `null` si la clé vaut JSON `null`, ABSENT si la
 * clé manque (c'est une faute du test, pas un cas d'application).
 */
private fun JVal.Obj.text(key: String): String? = when (val v = fields[key]) {
    null -> throw IllegalArgumentException("pilote: $key absent")
    is JVal.Null -> null
    is JVal.Str -> v.value
    else -> throw IllegalArgumentException("pilote: $key n'est pas un texte")
}

/** Une route : le chemin, ou `null` (aucune route). */
private fun route(path: String?): JVal = path?.let { JVal.Str(it) } ?: JVal.Null

private class Driver {
    fun run(op: JVal.Obj): JVal {
        val name = (op.fields["op"] as? JVal.Str)?.value
            ?: throw IllegalArgumentException("pilote: op absent")
        return when (name) {
            // La route portée par l'URL de la WebView (le HASH).
            "route" -> JVal.Obj(linkedMapOf("path" to route(routePathFromUrl(op.text("url")))))
            // La route RELUE dans l'état sauvegardé.
            "state" -> JVal.Obj(linkedMapOf("path" to route(routePathFromState(op.text("path")))))
            // Les routes servies : la liste du contrat.
            "routes" -> JVal.Obj(
                linkedMapOf("routes" to JVal.Arr(WEB_ROUTES.sorted().map { JVal.Str(it) })),
            )
            // L'accueil et la clé de l'état sauvegardé.
            "meta" -> JVal.Obj(
                linkedMapOf("home" to JVal.Str(HOME_ROUTE), "key" to JVal.Str(ROUTE_STATE_KEY)),
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
