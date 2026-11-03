package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.CleartextPolicy
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.ServerUrlResult

// Issue d'une écriture PERSISTÉE. `Written` = le disque a accepté ; tout le
// reste est un refus EXPLICITE. Avant, `apply()` rendait la main avant le
// disque et le `false` d'un `commit()` n'était lu par personne : « enregistré »
// pouvait être un mensonge, effacé au force-stop suivant.
sealed interface WriteResult {
    val ok: Boolean get() = this is Written

    data object Written : WriteResult

    /** Refus AVANT écriture : entrée invalide, doublon, plafond. Rien n'a bougé. */
    data class Refused(val reason: String) : WriteResult

    /** Écriture tentée, le stockage a dit non. */
    data class Failed(val reason: String) : WriteResult

    /** Époque de session changée : écriture abandonnée, rien n'a été touché. */
    data object EpochRefused : WriteResult
}

/**
 * Magasin clé/valeur SYNCHRONE : le commit rend `true` une fois l'écriture sur
 * le disque. Contrat plus étroit que `SharedPreferences` pour que les registres
 * restent purs et se rejouent hors Gradle, pannes injectées comprises.
 */
interface KeyValueStore {
    fun getString(key: String): String?

    /** Écrit [values] d'un coup. `false` = rien n'est garanti sur le disque. */
    fun commit(values: Map<String, String>): Boolean

    /** Efface TOUTES les clés. `false` = effacement incomplet. */
    fun clear(): Boolean
}

/** Mémoire seule (session de secours, tests) : même contrat, aucune durabilité. */
class MemoryKeyValueStore(initial: Map<String, String> = emptyMap()) : KeyValueStore {
    private val values = LinkedHashMap<String, String>(initial)

    override fun getString(key: String): String? = values[key]

    override fun commit(values: Map<String, String>): Boolean {
        this.values.putAll(values)
        return true
    }

    override fun clear(): Boolean {
        values.clear()
        return true
    }
}

/** Enregistre le compte appairé et le rend courant, DANS la section critique de session. */
fun interface AccountRecorder {
    fun record(accountId: String): WriteResult
}

/**
 * Comptes appairés : liste bornée + compte courant. Une bascule ([record])
 * écrit les DEUX en un seul commit : deux commits laisseraient un compte
 * inscrit sans compte courant, ou l'inverse.
 */
class AccountRegistry(private val store: KeyValueStore) : AccountRecorder {
    fun count(hasSession: Boolean = false): Int =
        maxOf(accountIds().size, if (hasSession) 1 else 0)

    /** Ajoute sans changer un compte courant déjà choisi. */
    fun add(accountId: String): WriteResult {
        val id = accountId.trim()
        if (!isValidAccountId(id)) return WriteResult.Refused("identifiant de compte invalide")
        val ids = accountIds()
        if (ids.contains(id)) return WriteResult.Refused("compte déjà enregistré")
        if (ids.size >= MAX_ACCOUNTS) return WriteResult.Refused("nombre maximal de comptes atteint")
        val values = linkedMapOf(KEY_IDS to (ids + id).joinToString(SEP))
        if (current() == null) values[KEY_CURRENT] = id
        return write(values)
    }

    /** Ajout + sélection en UN commit : la bascule ne peut pas rester à moitié faite. */
    override fun record(accountId: String): WriteResult {
        val id = accountId.trim()
        if (!isValidAccountId(id)) return WriteResult.Refused("identifiant de compte invalide")
        val ids = accountIds().toMutableList()
        if (!ids.contains(id)) {
            if (ids.size >= MAX_ACCOUNTS) return WriteResult.Refused("nombre maximal de comptes atteint")
            ids.add(id)
        }
        return write(linkedMapOf(KEY_IDS to ids.joinToString(SEP), KEY_CURRENT to id))
    }

    fun select(accountId: String): WriteResult {
        val id = accountId.trim()
        if (!isValidAccountId(id)) return WriteResult.Refused("identifiant de compte invalide")
        if (!accountIds().contains(id)) return WriteResult.Refused("compte inconnu")
        if (current() == id) return WriteResult.Written
        return write(mapOf(KEY_CURRENT to id))
    }

    fun current(): String? {
        val id = store.getString(KEY_CURRENT)?.trim() ?: return null
        return if (accountIds().contains(id)) id else null
    }

    fun clear(): WriteResult =
        if (store.clear()) WriteResult.Written else WriteResult.Failed("comptes non effacés")

    private fun accountIds(): List<String> {
        val raw = store.getString(KEY_IDS) ?: return emptyList()
        return raw.split(SEP).map { it.trim() }
            .filter { it.isNotEmpty() && it.length <= MAX_ACCOUNT_ID }
            .take(MAX_ACCOUNTS)
    }

    private fun write(values: Map<String, String>): WriteResult =
        if (store.commit(values)) WriteResult.Written else WriteResult.Failed("comptes non enregistrés")

    companion object {
        const val MAX_ACCOUNTS = 8
        const val MAX_ACCOUNT_ID = 64
        private const val KEY_IDS = "account_ids"
        private const val KEY_CURRENT = "current_account_id"
        private const val SEP = ","

        fun isValidAccountId(id: String): Boolean = id.isNotBlank() && id.length <= MAX_ACCOUNT_ID
    }
}

/**
 * Serveur choisi à l'exécution, validé AVANT le commit : un refus ne réécrit
 * rien. Prefs propres aux comptes : le serveur survit à une déconnexion.
 */
class ServerChoice(
    private val store: KeyValueStore,
    private val cleartext: CleartextPolicy = CleartextPolicy.FORBID,
) {
    fun baseUrl(seed: String): String {
        val stored = store.getString(KEY_BASE_URL) ?: return seed
        val validated = ServerConfig.validateBaseUrl(stored, cleartext)
        return (validated as? ServerUrlResult.Ok)?.baseUrl ?: seed
    }

    fun save(validated: ServerUrlResult.Ok): WriteResult =
        if (store.commit(mapOf(KEY_BASE_URL to validated.baseUrl))) WriteResult.Written
        else WriteResult.Failed("serveur non enregistré")

    companion object {
        private const val KEY_BASE_URL = "base_url"
    }
}
