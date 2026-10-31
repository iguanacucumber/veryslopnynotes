package fr.veryslopnynotes.pronote

/**
 * Après `G=25` ou HTTP 429, rafraîchir la session est le pire choix : le refresh
 * refait un login, donc encore plus de limitation. Le client arme cette porte ;
 * pendant la fenêtre, chaque lecture échoue TOUT DE SUITE en [RateLimitedError],
 * sans réseau et sans nouveau login. Propre à un client, en mémoire.
 *
 * Kotlin pur : testé par `agents/runtime/kotlin-parity/RateLimitParityMain.kt`.
 */
class RateLimitGate(
    private val cooldownMs: Long = DEFAULT_COOLDOWN_MS,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val DEFAULT_COOLDOWN_MS = 120_000L
    }

    private var blockedUntil: Long = 0L

    @Synchronized
    fun isCoolingDown(): Boolean = clock() < blockedUntil

    @Synchronized
    fun remainingMs(): Long = (blockedUntil - clock()).coerceAtLeast(0L)

    /**
     * Un second refus pendant la fenêtre la PROLONGE (jamais ne la raccourcit).
     */
    @Synchronized
    fun trip() {
        val deadline = clock() + cooldownMs
        if (deadline > blockedUntil) blockedUntil = deadline
    }

    /** Aucun appelant ne doit envoyer de requête ni rafraîchir avant la fin. */
    @Synchronized
    fun check() {
        val left = blockedUntil - clock()
        if (left > 0) {
            // Arrondi au supérieur : « 0 s » ne doit pas faire croire que la
            // fenêtre est finie alors qu'il reste quelques millisecondes.
            throw RateLimitedError(
                "PRONOTE rate limit in effect; retry in ${(left + 999L) / 1000L} s",
                pronoteErrorCode = null,
            )
        }
    }
}
