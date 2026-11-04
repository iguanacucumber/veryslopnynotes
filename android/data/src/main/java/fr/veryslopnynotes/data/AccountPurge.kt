package fr.veryslopnynotes.data

/**
 * Pourquoi la donnée part : déconnexion, session morte, bascule, ou demande
 * explicite « supprimer toutes mes données ».
 */
enum class AccountPurgeMode {
    LOGOUT,
    SESSION_DEAD,
    ACCOUNT_SWITCH,
    DELETE_ALL,
}

/** Ce qu'une purge fait d'un store : l'effacer, ou le garder par conception. */
enum class AccountStorePolicy {
    PURGED,
    RETAINED,
}

/**
 * INVENTAIRE des stores locaux d'un compte. Un store `PURGED` sans étape rend
 * la purge INCOMPLÈTE : aucun appelant ne peut l'oublier en silence.
 *
 * `RETAINED` est une décision explicite pour une déconnexion ou une bascule :
 * la clé LLM et le serveur choisi appartiennent à l'utilisateur
 * (docs/PRODUCT.md), et `prompt_seen` est un réglage d'interface (Manuals.kt).
 * La suppression TOTALE demandée par l'utilisateur les emporte aussi : c'est
 * sa donnée, pas celle d'un compte. Les préférences d'apparence restent.
 */
enum class AccountDataStore(val id: String, val policy: AccountStorePolicy) {
    SESSION("session", AccountStorePolicy.PURGED),
    ACCOUNTS("accounts", AccountStorePolicy.PURGED),
    COURSE_NOTES("course_notes", AccountStorePolicy.PURGED),
    TEACHER_CHAT("teacher_chat", AccountStorePolicy.PURGED),
    SUBJECT_PREFS("subject_prefs", AccountStorePolicy.PURGED),
    MANUAL("manual", AccountStorePolicy.PURGED),
    MANUAL_PROMPT("manual_prompt_seen", AccountStorePolicy.RETAINED),
    ATTACHMENTS("attachments", AccountStorePolicy.PURGED),
    EXPORTS("exports", AccountStorePolicy.PURGED),
    PHOTOS("photos", AccountStorePolicy.PURGED),
    READ_STATE("read_state", AccountStorePolicy.PURGED),
    WEBVIEW("webview", AccountStorePolicy.PURGED),
    LLM_KEY("llm_key", AccountStorePolicy.RETAINED),
    AI_CONSENT("ai_consent", AccountStorePolicy.RETAINED),
    SERVER_URL("server_url", AccountStorePolicy.RETAINED),
    CACHE("cache", AccountStorePolicy.PURGED),
    UI_PREFS("ui_prefs", AccountStorePolicy.RETAINED),
    ;

    /** Une bascule remplace la session et la liste de comptes ; elle ne les efface pas. */
    fun required(mode: AccountPurgeMode): Boolean = when {
        this == LLM_KEY || this == SERVER_URL || this == AI_CONSENT -> mode == AccountPurgeMode.DELETE_ALL
        policy == AccountStorePolicy.RETAINED -> false
        this == SESSION || this == ACCOUNTS -> mode != AccountPurgeMode.ACCOUNT_SWITCH
        else -> true
    }
}

/** Une étape nommée : `true` = le store est réellement vide. */
class AccountPurgeStep(
    val store: AccountDataStore,
    val action: () -> Boolean,
)

/** Une bascule de compte : la publication attend la purge (I16). */
class AccountSwitch(
    val previous: AccountIdentity?,
    val current: AccountIdentity?,
    val publish: () -> Unit,
)

/** Issue typée : l'appelant ne confond pas « purgé » et « incomplet ». */
sealed interface AccountPurgeResult {
    val ok: Boolean
    val purged: List<AccountDataStore>
    val failed: List<AccountDataStore>
    val missing: List<AccountDataStore>

    data class Complete(override val purged: List<AccountDataStore>) : AccountPurgeResult {
        override val ok: Boolean get() = true
        override val failed: List<AccountDataStore> get() = emptyList()
        override val missing: List<AccountDataStore> get() = emptyList()
    }

    data class Incomplete(
        override val purged: List<AccountDataStore>,
        override val failed: List<AccountDataStore>,
        override val missing: List<AccountDataStore>,
    ) : AccountPurgeResult {
        override val ok: Boolean get() = false

        /** Message borné : des identifiants de stores, jamais une donnée du compte. */
        fun summary(): String =
            "purge incomplète (" +
                (failed + missing).joinToString(",") { it.id } +
                ")"
    }
}

/** Le contrat appelé par les trois chemins : un seul point d'entrée. */
fun interface AccountPurgeRunner {
    fun purge(mode: AccountPurgeMode, switch: AccountSwitch?): AccountPurgeResult
}

/**
 * LA purge de compte. Toutes les étapes d'un mode s'exécutent, puis le
 * résultat liste les échecs et les stores non enregistrés : une étape ratée
 * n'empêche pas les autres de partir, mais interdit de publier le compte
 * suivant.
 */
class AccountPurgePlan private constructor(
    val mode: AccountPurgeMode,
    private val steps: Map<AccountDataStore, () -> Boolean>,
    private val missing: List<AccountDataStore>,
) {
    fun purge(): AccountPurgeResult {
        if (missing.isNotEmpty()) {
            return AccountPurgeResult.Incomplete(emptyList(), emptyList(), missing)
        }
        val purged = ArrayList<AccountDataStore>(steps.size)
        val failed = ArrayList<AccountDataStore>()
        for ((store, action) in steps) {
            val cleared = try {
                action()
            } catch (_: Exception) {
                false
            }
            if (cleared) purged.add(store) else failed.add(store)
        }
        return if (failed.isEmpty()) {
            AccountPurgeResult.Complete(purged)
        } else {
            AccountPurgeResult.Incomplete(purged, failed, emptyList())
        }
    }

    companion object {
        /** Aucune étape en double ; tout store requis absent est SIGNALÉ. */
        fun of(mode: AccountPurgeMode, steps: List<AccountPurgeStep>): AccountPurgePlan {
            val byStore = LinkedHashMap<AccountDataStore, () -> Boolean>()
            for (step in steps) {
                if (step.store.required(mode)) byStore[step.store] = step.action
            }
            val missing = AccountDataStore.entries.filter { it.required(mode) && it !in byStore }
            return AccountPurgePlan(mode, byStore, missing)
        }
    }
}
