package fr.veryslopnynotes.data

// Repli MÉMOIRE de la session et store EFFECTIF (I18) — aucun import Android :
// ce fichier est compilé et EXÉCUTÉ par le harnais de parité. Le câblage
// Keystore vit dans `SessionStore.kt`.

/** Secours mémoire (previews Compose, tests JVM, Keystore indisponible). */
class InMemorySessionStore : SessionStore {
    private val records = SessionRecordStore(MemoryKeyValueStore())

    override fun save(session: StoredSession): WriteResult = records.save(session)

    override fun load(): StoredSession? = records.load()

    override fun loadOutcome(): SessionLoad = records.loadOutcome()

    override fun clear(): WriteResult = records.clear()
}

/**
 * Le store EFFECTIF : chiffré quand le Keystore répond, mémoire sinon.
 *
 * Deux résurrections fermées :
 *  - un Keystore mort AU DÉMARRAGE rendait le chiffré illisible mais laissait
 *    ses clés sur le disque ; au lancement suivant (Keystore réparé), l'ancienne
 *    session revenait — même après un logout fait en mode dégradé ;
 *  - un échec APRÈS l'init faisait jeter `load()/save()/clear()` : la
 *    déconnexion ne pouvait plus effacer le disque.
 *
 * [discard] supprime le fichier chiffré sans passer par le Keystore. `false` =
 * effacement non garanti : `clear()` le REND à l'appelant au lieu de prétendre
 * « déconnecté ».
 */
class ResilientSessionStore(
    secure: SessionStore?,
    private val discard: () -> Boolean,
) : SessionStore {
    private val memory = InMemorySessionStore()

    /** `null` = dégradé : le chiffré ne répond plus, tout passe par [memory]. */
    @Volatile
    private var secure: SessionStore? = secure

    init {
        // Pas de chiffré dès la construction : l'ancien fichier ne doit pas
        // ressusciter au prochain lancement sain.
        if (secure == null) {
            SecureStorage.markUnavailable()
            discardSecure()
        }
    }

    override fun save(session: StoredSession): WriteResult {
        val target = secure ?: return memory.save(session)
        val result = try {
            target.save(session)
        } catch (_: Exception) {
            degrade()
            // L'ancienne entrée du disque est périmée : elle part pour ne pas
            // revenir au lancement suivant avec une session que l'app a quittée.
            discardSecure()
            return memory.save(session)
        }
        if (result.ok) memory.save(session)
        return result
    }

    override fun load(): StoredSession? = (loadOutcome() as? SessionLoad.Complete)?.session

    override fun loadOutcome(): SessionLoad {
        val target = secure ?: return memory.loadOutcome()
        return try {
            when (val loaded = target.loadOutcome()) {
                is SessionLoad.Incomplete ->
                    if (loaded.cleared) loaded
                    else SessionLoad.Incomplete(loaded.missing, discardSecure())
                else -> loaded
            }
        } catch (_: Exception) {
            degrade()
            // Une lecture qui jette = le chiffré est ILLISIBLE, pas absent :
            // sans effacement, la session reviendrait au lancement suivant.
            discardSecure()
            memory.loadOutcome()
        }
    }

    override fun clear(): WriteResult {
        memory.clear()
        val target = secure
        val cleared = if (target == null) {
            false
        } else {
            try {
                target.clear().ok
            } catch (_: Exception) {
                degrade()
                false
            }
        }
        // Même un `clear()` réussi laisse le fichier et ses keysets : on le
        // supprime pour qu'aucun store ne puisse le relire.
        val discarded = discardSecure()
        return if (cleared || discarded) WriteResult.Written
        else WriteResult.Failed("session non effacée")
    }

    private fun degrade() {
        secure = null
        SecureStorage.markUnavailable()
    }

    private fun discardSecure(): Boolean = try {
        discard()
    } catch (_: Exception) {
        false
    }
}
