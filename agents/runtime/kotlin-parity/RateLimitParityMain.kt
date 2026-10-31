// RateLimitParityMain.kt — pilote JSON de la PORTE de limitation de débit.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.ratelimit

import fr.veryslopnynotes.data.isSessionFailure
import fr.veryslopnynotes.data.mustPropagateReadFailure
import fr.veryslopnynotes.pronote.ClientBase
import fr.veryslopnynotes.pronote.ExpiredObject
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.PronoteAPIError
import fr.veryslopnynotes.pronote.RateLimitGate
import fr.veryslopnynotes.pronote.RateLimitedError
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun cookieResponse(): JVal = JVal.Obj(linkedMapOf())

/**
 * Client de test : le TRANSPORT est remplacé, le vrai `post`/`sendWithRefresh`
 * de production est rejoué (porte de refresh, porte de débit, rejeu).
 */
private class ScriptedClient(
    private val onSend: (Int) -> JVal,
    private val onRefresh: () -> Unit = {},
) : ClientBase(
    "https://etablissement.example/pronote/eleve.html",
    "eleve",
    "secret",
) {
    var sends: Int = 0
    var refreshes: Int = 0

    override fun send(functionName: String, postData: Map<String, JVal>): JVal {
        sends += 1
        return onSend(sends)
    }

    override fun refresh() {
        refreshes += 1
        onRefresh()
    }
}

private fun catchName(block: () -> Unit): String? = try {
    block()
    null
} catch (e: Exception) {
    e.javaClass.simpleName
}

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // Fenêtre de calme : armée -> refus immédiat -> levée à l'échéance.
        "gate" -> {
            val cooldown = (op.num("cooldownMs") ?: 120_000.0).toLong()
            var now = 1_000L
            val gate = RateLimitGate(cooldownMs = cooldown, clock = { now })
            val coolingBefore = gate.isCoolingDown()
            gate.trip()
            val coolingAfterTrip = gate.isCoolingDown()
            val remainingAfterTrip = gate.remainingMs()
            val during = catchName { gate.check() }
            now += cooldown - 1
            val coolingBeforeExpiry = gate.isCoolingDown()
            // Un second refus PROLONGE la fenêtre, il ne la raccourcit jamais.
            gate.trip()
            val extended = gate.remainingMs()
            now += 1
            val coolingAtOldExpiry = gate.isCoolingDown()
            val stillDuring = catchName { gate.check() }
            now += cooldown
            val coolingAfterExpiry = gate.isCoolingDown()
            val after = catchName { gate.check() }
            ok(
                "coolingBefore" to JVal.Bool(coolingBefore),
                "coolingAfterTrip" to JVal.Bool(coolingAfterTrip),
                "remainingAfterTrip" to JVal.Num(remainingAfterTrip.toDouble()),
                "during" to (during?.let { JVal.Str(it) } ?: JVal.Null),
                "coolingBeforeExpiry" to JVal.Bool(coolingBeforeExpiry),
                "extended" to JVal.Num(extended.toDouble()),
                "coolingAtOldExpiry" to JVal.Bool(coolingAtOldExpiry),
                "stillDuring" to (stillDuring?.let { JVal.Str(it) } ?: JVal.Null),
                "coolingAfterExpiry" to JVal.Bool(coolingAfterExpiry),
                "after" to (after?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        // G=25 à l'envoi : AUCUN refresh, et la requête suivante échoue sans
        // réseau (la porte est armée).
        "noRefreshOnRateLimit" -> {
            val client = ScriptedClient(onSend = { throw RateLimitedError() })
            val first = catchName { client.post("DernieresNotes", 198.0, null) }
            val second = catchName { client.post("DernieresNotes", 198.0, null) }
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "refreshes" to JVal.Num(client.refreshes.toDouble()),
                "first" to (first?.let { JVal.Str(it) } ?: JVal.Null),
                "second" to (second?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        // Le REFRESH lui-même tombe sur la limite : la porte s'arme, l'erreur
        // remonte typée, et la requête suivante ne repart pas.
        "refreshRateLimited" -> {
            val client = ScriptedClient(
                onSend = { n -> if (n == 1) throw PronoteAPIError("panne") else cookieResponse() },
                onRefresh = { throw RateLimitedError() },
            )
            val first = catchName { client.post("DernieresNotes", 198.0, null) }
            val second = catchName { client.post("DernieresNotes", 198.0, null) }
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "refreshes" to JVal.Num(client.refreshes.toDouble()),
                "first" to (first?.let { JVal.Str(it) } ?: JVal.Null),
                "second" to (second?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        // Le REJEU après refresh tombe sur la limite : même issue.
        "retryRateLimited" -> {
            val client = ScriptedClient(
                onSend = { n ->
                    when (n) {
                        1 -> throw PronoteAPIError("panne")
                        2 -> throw RateLimitedError()
                        else -> cookieResponse()
                    }
                },
            )
            val first = catchName { client.post("DernieresNotes", 198.0, null) }
            val second = catchName { client.post("DernieresNotes", 198.0, null) }
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "refreshes" to JVal.Num(client.refreshes.toDouble()),
                "first" to (first?.let { JVal.Str(it) } ?: JVal.Null),
                "second" to (second?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        // Une erreur GÉNÉRIQUE rafraîchit et rejoue (comportement historique).
        "genericRefreshRetried" -> {
            val client = ScriptedClient(
                onSend = { n ->
                    if (n == 1) throw PronoteAPIError("panne") else cookieResponse()
                },
            )
            val outcome = catchName { client.post("DernieresNotes", 198.0, null) }
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "refreshes" to JVal.Num(client.refreshes.toDouble()),
                "error" to (outcome?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        // La décision des lectures tolérantes : quoi remonter, quoi avaler.
        "propagate" -> {
            val rateLimited = mustPropagateReadFailure(RateLimitedError())
            val expired = mustPropagateReadFailure(ExpiredObject("objet périmé"))
            val sessionExpired = mustPropagateReadFailure(PronoteAPIError("expirée", 10))
            val generic = mustPropagateReadFailure(PronoteAPIError("panne"))
            val io = mustPropagateReadFailure(java.io.IOException("réseau"))
            val parsing = mustPropagateReadFailure(IllegalStateException("ligne tordue"))
            ok(
                "rateLimited" to JVal.Bool(rateLimited),
                // Un rate-limit n'est PAS une session morte : pas de purge de
                // cache, pas de renvoi vers l'appairage.
                "rateLimitedSession" to JVal.Bool(isSessionFailure(RateLimitedError())),
                "expired" to JVal.Bool(expired),
                "sessionExpired" to JVal.Bool(sessionExpired),
                "generic" to JVal.Bool(generic),
                "io" to JVal.Bool(io),
                "parsing" to JVal.Bool(parsing),
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
