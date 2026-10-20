// RefreshGateParityMain.kt — pilote JSON de la PORTE de rafraîchissement (#405).
//
// OUTIL DE TEST uniquement (jamais Gradle, jamais l'APK). Il pilote la VRAIE
// source de production `pronote/RefreshGate.kt` (Kotlin pur : ni Android ni
// réseau), donc les assertions portent sur du code EXÉCUTÉ.
//
// Ce que la porte prouve (#405) :
//
//   1. UN SEUL rafraîchissement à la fois : N threads lâchés EN MÊME temps sur
//      la porte, UN seul la prend (le CAS `compareAndSet`).
//   2. La porte se REND : après `leave()`, on peut la reprendre (un refresh
//      raté ne bloque pas les suivants).
//   3. Une exception pendant le refresh ne bloque PAS la porte (le `finally`
//      de `Client.post` la rend — c'est vérifié par le garde de source, ici on
//      prouve que le motif « prendre -> essayer -> rendre » tient).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`).
package fr.veryslopnynotes.refreshgate

import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.RefreshGate
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value
private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // N threads lâchés EN MÊME temps : UN seul prend la porte.
        "race" -> {
            val n = (op.num("threads") ?: 2.0).toInt().coerceIn(1, 64)
            val gate = RefreshGate()
            val start = CountDownLatch(1)
            val winners = AtomicInteger(0)
            val losers = AtomicInteger(0)
            // DÉTERMINISTE, sans attente. Le gagnant GARDE la porte jusqu'à ce
            // que TOUS les autres aient TENTÉ (et donc échoué) : c'est ce qui
            // vaut un CAS. Avant, un `Thread.sleep(200)` faisait la même
            // chose — mais par TIMING : un fil lent à démarrer pouvait
            // tenter APRÈS la libération, gagner lui aussi, et faire
            // échouer le test par pur hasard. Ici l'ordre est garanti par le
            // compteur : `attempted == n` implique que les n fils ont
            // appelé `tryEnter`, donc qu'aucun ne peut plus gagner.
            val attempted = AtomicInteger(0)
            val threads = (0 until n).map {
                Thread {
                    start.await()
                    val won = gate.tryEnter()
                    // Ma tentative est finie : je le dis IMMÉDIATEMENT (avant
                    // d'attendre), sinon le gagnant qui m'attend ne verrait
                    // jamais le compteur arriver à n.
                    attempted.incrementAndGet()
                    if (won) {
                        winners.incrementAndGet()
                        // Attend que les n-1 autres aient tenté (et perdu).
                        while (attempted.get() < n) Thread.sleep(1)
                        gate.leave()
                    } else {
                        losers.incrementAndGet()
                    }
                }
            }
            threads.forEach { it.start() }
            start.countDown()
            threads.forEach { it.join(30_000) }
            JVal.Obj(
                linkedMapOf(
                    "winners" to JVal.Num(winners.get().toDouble()),
                    "losers" to JVal.Num(losers.get().toDouble()),
                    "held" to JVal.Bool(gate.isHeld()),
                ),
            )
        }
        // Prise -> refusée -> rendue -> reprise. Et le même motif avec une
        // EXCEPTION au milieu (le `finally` rend la porte).
        "sequence" -> {
            val gate = RefreshGate()
            val first = gate.tryEnter()
            val second = gate.tryEnter()
            val heldDuring = gate.isHeld()
            gate.leave()
            val third = gate.tryEnter()
            val heldAfter = gate.isHeld()
            gate.leave()
            var caught = false
            try {
                gate.tryEnter()
                throw IllegalStateException("refresh raté")
            } catch (_: IllegalStateException) {
                caught = true
            } finally {
                gate.leave()
            }
            val reentered = gate.tryEnter()
            gate.leave()
            JVal.Obj(
                linkedMapOf(
                    "first" to JVal.Bool(first),
                    "second" to JVal.Bool(second),
                    "heldDuring" to JVal.Bool(heldDuring),
                    "third" to JVal.Bool(third),
                    "heldAfter" to JVal.Bool(heldAfter),
                    "caught" to JVal.Bool(caught),
                    "reentered" to JVal.Bool(reentered),
                ),
            )
        }
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
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
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
