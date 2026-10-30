// LlmKeyFallbackMain.kt — pilote JSON du repli mémoire de la clé LLM (#749, I18).
//
// OUTIL DE TEST uniquement : jamais compilé par Gradle, jamais dans l'APK. Le
// test compile la VRAIE source de production `fr.veryslopnynotes.data
// .LlmKeyFallback` (aucun import Android) et la pilote ici.
//
// CE QUE ÇA PROUVE. Le Keystore lui-même a besoin du SDK : il reste dans
// `LlmKeyStore.kt` (source guard). Ce que le port EXÉCUTE, c'est la POLITIQUE
// du repli, sur deux scénarios réels :
//   - Keystore cassé AU DÉMARRAGE : la clé se saisit encore, et « Oublier »
//     EFFACE le fichier chiffré (`discard`) au lieu de ne vider que la mémoire —
//     sans quoi la clé reviendrait au lancement suivant, Keystore réparé ;
//   - Keystore qui lâche APRÈS l'init : `save`/`apiKey`/`clear` ne JETTENT
//     plus, l'état passe à UNAVAILABLE, et un oubli reste durable.
//
// `disk` simule le fichier chiffré (une seule entrée : une seule chaîne) ; il
// survit d'une opération à l'autre, donc « nextLaunch » veut dire : un store
// NEUF construit sur le même fichier.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout. Les erreurs du PILOTE (op inconnue) sont refusées par le test.
package fr.veryslopnynotes.llmkeyfallback

import fr.veryslopnynotes.data.LlmKeyStore
import fr.veryslopnynotes.data.ResilientLlmKeyStore
import fr.veryslopnynotes.data.SecureStorage
import fr.veryslopnynotes.data.validatedLlmKey
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

/** Le fichier chiffré, tel que le Keystore le verrait : une entrée, ou rien. */
private var disk: String? = null

/** Nombre d'effacements DURS demandés par le repli (« Oublier » durable). */
private var discards = 0

private fun discardDisk() {
    discards++
    disk = null
}

/**
 * Un Keystore qui répond… sauf sur `throwOn` (« save » / « read » / « clear »).
 * C'est l'échec APRÈS l'init : la panne que l'app rencontrait en plein usage.
 *
 * `commitFails` modélise l'autre panne RÉELLE d'Android : un `commit()`
 * synchrone qui rend `false` (écriture jamais posée sur le disque). La
 * production en fait une exception (`EncryptedLlmKeyStore`), donc la politique
 * du repli se teste ici sans SDK.
 */
private class FakeSecureStore(
    private val throwOn: String = "",
    private val commitFails: Boolean = false,
) : LlmKeyStore {
    /** Même sémantique que le store chiffré : `false` devient un échec dur. */
    private fun commit() {
        check(!commitFails) { "stockage en échec" }
    }

    override fun save(apiKey: String) {
        if (throwOn == "save") error("Keystore indisponible")
        val secret = validatedLlmKey(apiKey)
        commit()
        disk = secret
    }

    override fun apiKey(): String? {
        if (throwOn == "read") error("Keystore indisponible")
        return disk
    }

    override fun clear() {
        if (throwOn == "clear") error("Keystore indisponible")
        commit()
        disk = null
    }
}

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun text(value: String?): JVal = if (value == null) JVal.Null else JVal.Str(value)

private fun count(value: Int): JVal = JVal.Num(value.toDouble())

private fun health(): JVal = JVal.Str(SecureStorage.health().name)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // Keystore cassé AU DÉMARRAGE (`secure = null`) : la clé se saisit en
        // mémoire, « Oublier » efface le fichier chiffré — la clé de l'ancien
        // compte ne revient pas au lancement suivant.
        "degraded" -> {
            disk = "cle-du-compte-a"
            discards = 0
            val store = ResilientLlmKeyStore(null) { discardDisk() }
            store.save("  cle-du-compte-b  ")
            val saved = store.apiKey()
            val configured = store.isConfigured()
            store.clear()
            ok(
                "saved" to text(saved),
                "configured" to JVal.Bool(configured),
                "afterForget" to text(store.apiKey()),
                "discards" to count(discards),
                // Lancement suivant, Keystore réparé : le fichier a disparu.
                "nextLaunch" to text(FakeSecureStore().apiKey()),
                "health" to health(),
            )
        }
        // Échec APRÈS l'init sur `save` : la clé saisie reste utilisable.
        "save-throws" -> {
            disk = null
            discards = 0
            val store = ResilientLlmKeyStore(FakeSecureStore(throwOn = "save")) { discardDisk() }
            var threw = false
            try {
                store.save("cle-1")
            } catch (_: Exception) {
                threw = true
            }
            ok(
                "threw" to JVal.Bool(threw),
                "apiKey" to text(store.apiKey()),
                "discards" to count(discards),
                "health" to health(),
            )
        }
        // `commit()` qui rend `false` à l'enregistrement : l'ancienne clé est
        // encore sur le disque, elle ne doit PAS rester l'autorité. La nouvelle
        // reste utilisable en mémoire et le fichier est effacé.
        "save-commit-false" -> {
            disk = "cle-ancienne"
            discards = 0
            val store = ResilientLlmKeyStore(FakeSecureStore(commitFails = true)) { discardDisk() }
            var threw = false
            try {
                store.save("cle-1")
            } catch (_: Exception) {
                threw = true
            }
            ok(
                "threw" to JVal.Bool(threw),
                "apiKey" to text(store.apiKey()),
                "discards" to count(discards),
                "nextLaunch" to text(FakeSecureStore().apiKey()),
                "health" to health(),
            )
        }
        // Échec APRÈS l'init sur `apiKey` : la lecture ne jette pas, elle
        // retombe sur la mémoire (la clé écrite ensuite).
        "read-throws" -> {
            disk = "cle-a"
            discards = 0
            val store = ResilientLlmKeyStore(FakeSecureStore(throwOn = "read")) { discardDisk() }
            val before = store.apiKey()
            store.save("cle-b")
            ok(
                "before" to text(before),
                "after" to text(store.apiKey()),
                "discards" to count(discards),
                "health" to health(),
            )
        }
        // Échec APRÈS l'init sur `clear` : « Oublier » reste possible ET
        // durable (le fichier est effacé hors Keystore).
        "clear-throws" -> {
            disk = "cle-a"
            discards = 0
            val store = ResilientLlmKeyStore(FakeSecureStore(throwOn = "clear")) { discardDisk() }
            var threw = false
            try {
                store.clear()
            } catch (_: Exception) {
                threw = true
            }
            ok(
                "threw" to JVal.Bool(threw),
                "apiKey" to text(store.apiKey()),
                "discards" to count(discards),
                "nextLaunch" to text(FakeSecureStore().apiKey()),
                "health" to health(),
            )
        }
        // `commit()` qui rend `false` sur « Oublier » : le chiffré est encore
        // là, donc l'effacement DUR doit passer. Sans lui, la clé oubliée
        // reviendrait au lancement suivant (le défaut `apply()`).
        "clear-commit-false" -> {
            disk = "cle-a"
            discards = 0
            val store = ResilientLlmKeyStore(FakeSecureStore(commitFails = true)) { discardDisk() }
            var threw = false
            try {
                store.clear()
            } catch (_: Exception) {
                threw = true
            }
            ok(
                "threw" to JVal.Bool(threw),
                "apiKey" to text(store.apiKey()),
                "discards" to count(discards),
                "nextLaunch" to text(FakeSecureStore().apiKey()),
                "health" to health(),
            )
        }
        // Keystore sain : l'effacement chiffré suffit, aucun effacement dur.
        "healthy-clear" -> {
            disk = "cle-a"
            discards = 0
            val store = ResilientLlmKeyStore(FakeSecureStore()) { discardDisk() }
            store.clear()
            ok(
                "apiKey" to text(store.apiKey()),
                "discards" to count(discards),
                "nextLaunch" to text(FakeSecureStore().apiKey()),
            )
        }
        // Une clé invalide est refusée AVANT tout état : rien d'écrit, rien de
        // dégradé (mêmes bornes que le contrat).
        "invalid" -> {
            disk = null
            discards = 0
            val store = ResilientLlmKeyStore(FakeSecureStore()) { discardDisk() }
            val errors = listOf("   ", "x".repeat(513)).map { raw ->
                try {
                    store.save(raw)
                    "aucune"
                } catch (e: Exception) {
                    e.javaClass.simpleName
                }
            }
            ok(
                "errors" to JVal.Arr(errors.map { JVal.Str(it) }),
                "stored" to text(disk),
                "configured" to JVal.Bool(store.isConfigured()),
                "discards" to count(discards),
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
            stdout.println(Json.stringify(ok("error" to JVal.Str(name))))
        }
    }
}
