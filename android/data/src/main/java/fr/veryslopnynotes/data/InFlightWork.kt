package fr.veryslopnynotes.data

/**
 * Travail long d'un appel du pont (IA, photo, profil) : il capture l'époque
 * de sa session, refuse tout envoi ou toute livraison après un changement et
 * porte les ressources à couper à la déconnexion (Future du pont, client LLM,
 * fil de génération).
 *
 * Logique PURE : le harnais de parité exécute l'annulation et la livraison.
 */
class InFlightWork internal constructor(
    val requestId: String,
    val epoch: Long,
) {
    private val lock = Any()
    private var cancellations: MutableList<() -> Unit>? = ArrayList()
    private var cancelled = false
    private var finished = false

    /** Enregistre une ressource à couper ; déjà annulé = elle part maintenant. */
    fun onCancel(action: () -> Unit) {
        val runNow = synchronized(lock) {
            val pending = cancellations
            if (cancelled || finished || pending == null) {
                true
            } else {
                pending.add(action)
                false
            }
        }
        if (runNow) invoke(action)
    }

    fun cancel() {
        val actions = synchronized(lock) {
            if (cancelled) return
            cancelled = true
            cancellations?.also { cancellations = null } ?: return
        }
        for (action in actions) invoke(action)
    }

    /** `true` = le travail peut livrer son résultat à la session d'origine. */
    fun finish(): Boolean {
        val wasCancelled: Boolean
        synchronized(lock) {
            if (finished) return false
            finished = true
            wasCancelled = cancelled
            cancellations = null
        }
        return !wasCancelled && SessionEpoch.isCurrent(epoch)
    }

    /** Contrôle AVANT l'envoi au fournisseur ou à l'établissement. */
    fun canSend(): Boolean = !isCancelled && SessionEpoch.isCurrent(epoch)

    /** Contrôle AVANT la livraison au JS. */
    fun canDeliver(): Boolean = canSend()

    val isCancelled: Boolean get() = synchronized(lock) { cancelled }

    private fun invoke(action: () -> Unit) {
        try {
            action()
        } catch (_: Throwable) {
            // Une ressource déjà morte ne retient pas les autres.
        }
    }
}

/**
 * Registre des travaux longs en vol, par appel du pont.
 *
 * Une déconnexion ou une bascule annule TOUT avant la purge : aucun fil
 * orphelin ne continue sur le compte précédent, et l'époque refuse la
 * livraison tardive. `except` = l'appel qui déclenche l'opération (logout)
 * n'annule pas son propre Future.
 */
object InFlight {
    private val lock = Any()
    private val works = LinkedHashMap<String, InFlightWork>()

    fun start(requestId: String, epoch: Long): InFlightWork {
        val work = InFlightWork(requestId, epoch)
        val previous = synchronized(lock) { works.put(requestId, work) }
        previous?.cancel()
        return work
    }

    fun finish(requestId: String): Boolean =
        synchronized(lock) { works.remove(requestId) }?.finish() ?: false

    fun cancel(requestId: String) {
        val work = synchronized(lock) { works.remove(requestId) }
        work?.cancel()
    }

    /** Logout, bascule, session morte : coupe tout sauf [except]. */
    fun cancelAll(except: String? = null): Int {
        val targets = synchronized(lock) {
            val ids = works.keys.filter { it != except }
            ids.mapNotNull { works.remove(it) }
        }
        for (work in targets) work.cancel()
        return targets.size
    }

    fun active(): Int = synchronized(lock) { works.size }
}
