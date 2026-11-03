package fr.veryslopnynotes.data

/**
 * Jeton d'annulation réseau exposé au pont SANS lui faire importer `pronote`
 * (la frontière Gradle garde le transport dans son module).
 */
class RequestCancellation {
    internal val native: fr.veryslopnynotes.pronote.RequestCancellation =
        fr.veryslopnynotes.pronote.RequestCancellation()

    fun cancel() {
        native.cancel()
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
