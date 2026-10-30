package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.Homework

// Contrat de la clé LLM et repli MÉMOIRE (I18) — AUCUN import Android
// ici : ce fichier est compilé et EXÉCUTÉ par le harnais de parité. Le
// câblage Keystore vit dans `LlmKeyStore.kt`.
//
// MÊME DISCIPLINE que la session Pronote : la clé est un credential que l'APP
// détient et qui n'existe nulle part ailleurs. Chiffrée au repos, jamais en
// SharedPreferences simple, jamais journalisée, jamais dans un `toString()`,
// jamais dans un message d'erreur, jamais dans une URL. Relue à CHAQUE
// requête, jamais mise en cache par le dépôt (elle change quand l'utilisateur
// la réécrit).
interface LlmKeyStore {
    fun save(apiKey: String)

    /** Secret porteur, relu À CHAQUE requête. `null` = clé absente. */
    fun apiKey(): String?

    /** Sans clé, l'app n'appelle pas le serveur : 400 refusé, inutile de payer l'aller-retour. */
    fun isConfigured(): Boolean = apiKey() != null

    fun clear()
}

/** La clé tient-elle les bornes du contrat ? (clé relue du disque : non fiable) */
fun isValidLlmKey(secret: String): Boolean =
    secret.isNotEmpty() && secret.length <= Homework.MAX_API_KEY_CHARS

/**
 * Valide et nettoie la clé. Messages SANS la clé : un `require` peut finir
 * dans un rapport de crash.
 */
fun validatedLlmKey(raw: String): String {
    val secret = raw.trim()
    require(secret.isNotEmpty()) { "clé LLM vide" }
    require(isValidLlmKey(secret)) { "clé LLM trop longue" }
    return secret
}

// Secours mémoire (previews Compose, tests unitaires JVM sans Android) : même
// surface que EncryptedLlmKeyStore, donc les tests couvrent le même code.
class InMemoryLlmKeyStore : LlmKeyStore {
    private var key: String? = null

    override fun save(apiKey: String) {
        key = validatedLlmKey(apiKey)
    }

    override fun apiKey(): String? = key

    override fun clear() {
        key = null
    }
}

/**
 * Le store EFFECTIF (I18) : chiffré quand il répond, mémoire sinon.
 *
 * Deux défauts corrigés ici :
 *  - un Keystore cassé AU DÉMARRAGE faisait perdre le chiffré de vue : `clear()`
 *    ne vidait que la mémoire, la clé restait sur le DISQUE et revenait au
 *    lancement suivant (Keystore réparé). Elle est donc EFFACÉE ([discard]) ;
 *  - un échec APRÈS l'init faisait jeter `apiKey()/save()/clear()` : « Oublier »
 *    devenait impossible. Chaque appel retombe sur la mémoire, l'état passe à
 *    `UNAVAILABLE` (`SecureStorage`), et un oubli reste DURABLE.
 *
 * [discard] efface le fichier chiffré sans passer par le Keystore (illisible
 * mais présent quand celui-ci est mort). Il ne journalise rien : le store tient
 * la clé.
 */
class ResilientLlmKeyStore(
    secure: LlmKeyStore?,
    private val discard: () -> Unit,
) : LlmKeyStore {
    private val memory = InMemoryLlmKeyStore()

    /** `null` = dégradé : le chiffré ne répond plus, tout passe par [memory]. */
    @Volatile
    private var secure: LlmKeyStore? = secure

    init {
        // Pas de chiffré dès la construction = état dégradé, PUBLIÉ (#401).
        if (secure == null) SecureStorage.markUnavailable()
    }

    override fun save(apiKey: String) {
        val secret = validatedLlmKey(apiKey)
        // La mémoire reçoit TOUJOURS la clé : si le chiffré lâche plus tard,
        // la clé de la session en cours reste utilisable — en mémoire seule,
        // jamais en clair sur le disque, jamais relue au lancement suivant.
        memory.save(secret)
        val target = secure ?: return
        try {
            target.save(secret)
        } catch (_: Exception) {
            degrade()
            // Le chiffré n'a pas accepté la NOUVELLE clé : l'ancienne entrée
            // est périmée. La laisser rendrait l'ancienne clé au lancement
            // suivant, alors que l'UI vient d'en enregistrer une autre.
            discardSecure()
        }
    }

    override fun apiKey(): String? {
        val target = secure ?: return memory.apiKey()
        return try {
            target.apiKey()
        } catch (_: Exception) {
            degrade()
            memory.apiKey()
        }
    }

    override fun clear() {
        memory.clear()
        val target = secure
        if (target != null) {
            try {
                target.clear()
                return
            } catch (_: Exception) {
                degrade()
            }
        }
        // Le chiffré n'a pas pu s'effacer (ou n'a jamais répondu) : la clé dort
        // encore sur le DISQUE. Sans cet effacement, « Oublier » ne viderait
        // que la mémoire et la clé reviendrait au lancement suivant.
        discardSecure()
    }

    /** Efface le chiffré sans passer par le Keystore ; jamais journalisé. */
    private fun discardSecure() {
        try {
            discard()
        } catch (_: Exception) {
            // Best-effort : le stockage est déjà en échec, rien de plus à faire.
        }
    }

    private fun degrade() {
        secure = null
        SecureStorage.markUnavailable()
    }
}
