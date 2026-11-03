// AccountPurgeMain.kt — pilote JSON de l'inventaire et de la purge de compte.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-account-purge.test.ts`
// (jamais Gradle, jamais l'APK). Il exécute le VRAI `AccountPurgePlan`.
package fr.veryslopnynotes.accountpurge

import fr.veryslopnynotes.data.AccountDataStore
import fr.veryslopnynotes.data.AccountPurgeMode
import fr.veryslopnynotes.data.AccountPurgePlan
import fr.veryslopnynotes.data.AccountPurgeResult
import fr.veryslopnynotes.data.AccountPurgeStep
import fr.veryslopnynotes.data.AccountStorePolicy
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.arr(key: String): List<JVal>? = (fields[key] as? JVal.Arr)?.items

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun names(values: List<AccountDataStore>): JVal =
    JVal.Arr(values.map { JVal.Str(it.id) })

private fun mode(raw: String?): AccountPurgeMode? =
    AccountPurgeMode.entries.firstOrNull { it.name == raw }

private class Driver {
    private val calls = ArrayList<String>()

    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        // L'INVENTAIRE compilé : ce que le test compare aux stores du dépôt.
        "inventory" -> ok(
            "stores" to JVal.Arr(
                AccountDataStore.entries.map {
                    JVal.Obj(
                        linkedMapOf(
                            "id" to JVal.Str(it.id),
                            "policy" to JVal.Str(if (it.policy == AccountStorePolicy.PURGED) "purged" else "retained"),
                        ),
                    )
                },
            ),
        )
        // Toutes les étapes présentes : la purge passe, dans l'ORDRE déclaré.
        "plan" -> {
            val selected = mode(op.str("mode")) ?: return err("mode", "inconnu")
            calls.clear()
            val fail = op.arr("fail")?.mapNotNull { (it as? JVal.Str)?.value }?.toSet() ?: emptySet()
            val run = op.arr("run")?.mapNotNull { (it as? JVal.Str)?.value }?.toSet()
            val steps = AccountDataStore.entries
                .filter { it.required(selected) && (run == null || it.id in run) }
                .map { store ->
                    AccountPurgeStep(store) {
                        calls.add(store.id)
                        store.id !in fail
                    }
                }
            val result = AccountPurgePlan.of(selected, steps).purge()
            ok(
                "ok" to JVal.Bool(result.ok),
                "purged" to names(result.purged),
                "failed" to names(result.failed),
                "missing" to names(result.missing),
                "calls" to JVal.Arr(calls.map { JVal.Str(it) }),
            )
        }
        // Une étape oubliée : la purge est INCOMPLÈTE et RIEN n'est exécuté.
        "missing" -> {
            val selected = mode(op.str("mode")) ?: return err("mode", "inconnu")
            calls.clear()
            val omit = op.arr("omit")?.mapNotNull { (it as? JVal.Str)?.value }?.toSet() ?: emptySet()
            val steps = AccountDataStore.entries
                .filter { it.required(selected) && it.id !in omit }
                .map { store -> AccountPurgeStep(store) { calls.add(store.id); true } }
            val result = AccountPurgePlan.of(selected, steps).purge()
            ok(
                "ok" to JVal.Bool(result.ok),
                "missing" to names(result.missing),
                "calls" to JVal.Arr(calls.map { JVal.Str(it) }),
            )
        }
        // Un store RETENU n'est jamais exécuté, même si un appelant le fournit.
        "retained" -> {
            val selected = mode(op.str("mode")) ?: return err("mode", "inconnu")
            calls.clear()
            val steps = AccountDataStore.entries
                .filter { it.required(selected) }
                .map { store -> AccountPurgeStep(store) { calls.add(store.id); true } } +
                AccountPurgeStep(AccountDataStore.LLM_KEY) { calls.add("llm_key"); false }
            val result = AccountPurgePlan.of(selected, steps).purge()
            ok(
                "ok" to JVal.Bool(result.ok),
                "calls" to JVal.Arr(calls.map { JVal.Str(it) }),
            )
        }
        "cleanup" -> ok("ok" to JVal.Bool(true))
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
