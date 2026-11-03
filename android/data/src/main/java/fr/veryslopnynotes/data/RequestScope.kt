package fr.veryslopnynotes.data

/**
 * Jeton d'annulation réseau exposé au pont SANS lui faire importer `pronote`
 * (la frontière Gradle garde le transport dans son module).
 */
class RequestCancellation {
    internal val native: fr.veryslopnynotes.pronote.RequestCancellation =
        fr.veryslopnynotes.pronote.RequestCancellation()

    private val lock = Any()
    private var hooks: MutableList<() -> Unit>? = ArrayList()

    /** Le fil du pont s'en sert pour rendre la main sans attendre le plafond. */
    val isCancelled: Boolean get() = native.isCancelled

    /**
     * Ressource du même appel à couper avec lui (Future du pont, client LLM,
     * fil de génération). Déjà annulé = l'action part immédiatement.
     */
    fun onCancel(action: () -> Unit) {
        val runNow = synchronized(lock) {
            val pending = hooks
            if (native.isCancelled || pending == null) {
                true
            } else {
                pending.add(action)
                false
            }
        }
        if (runNow) invoke(action)
    }

    fun cancel() {
        native.cancel()
        val actions = synchronized(lock) {
            val pending = hooks ?: return
            hooks = null
            pending
        }
        for (action in actions) invoke(action)
    }

    private fun invoke(action: () -> Unit) {
        try {
            action()
        } catch (_: Throwable) {
            // Une ressource déjà morte ne retient pas les autres.
        }
    }
}

/** Pose le jeton de l'opération sur le fil courant (voir `pronote.RequestScope`). */
object RequestScope {
    private val current = ThreadLocal<RequestCancellation?>()

    fun current(): RequestCancellation? = current.get()

    fun <T> with(cancellation: RequestCancellation?, block: () -> T): T {
        val previous = current.get()
        if (cancellation == null) current.remove() else current.set(cancellation)
        try {
            return fr.veryslopnynotes.pronote.RequestScope.with(cancellation?.native, block)
        } finally {
            if (previous == null) current.remove() else current.set(previous)
        }
    }
}
