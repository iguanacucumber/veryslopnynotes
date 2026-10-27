package fr.veryslopnynotes.pronote

/**
 * Porte de LIMITATION DE DÉBIT des requêtes d'authentification.
 *
 * Quand l'établissement répond `G=25` (« Exceeded max authorization requests »)
 * ou HTTP 429, la pire réaction est de rafraîchir la session : le refresh
 * refait une poignée de main ET un `login`, donc encore plus de requêtes
 * d'authentification, donc encore plus de limitation. Le client arme cette
 * porte au lieu de rafraîchir ; pendant la fenêtre, chaque lecture échoue
 * TOUT DE SUITE en [RateLimitedError], sans réseau et sans nouveau login.
 *
 * La porte est propre à un client (une session) et vit en mémoire. Le délai
 * par défaut (2 min) couvre la salve de lectures qui suit un écran et laisse
 * l'établissement recalculer son compteur ; une tentative après la fenêtre
 * est permise (et, si elle est encore limitée, la porte se réarme).
 *
 * Kotlin pur, stdlib seulement : la logique est testée pour de vrai par le
 * harnais de parité (`agents/runtime/kotlin-parity/RateLimitParityMain.kt`).
 */
class RateLimitGate(
    private val cooldownMs: Long = DEFAULT_COOLDOWN_MS,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        /**
         * Fenêtre de calme après un refus de débit. Assez longue pour couvrir
         * la salve de lectures de l'app, assez courte pour ne pas bloquer
         * durablement un élève dont l'établissement a compté large.
         */
        const val DEFAULT_COOLDOWN_MS = 120_000L
    }

    /** Instant (horloge injectable) jusqu'auquel les envois sont refusés. */
    private var blockedUntil: Long = 0L

    /** La fenêtre court-elle encore ? */
    @Synchronized
    fun isCoolingDown(): Boolean = clock() < blockedUntil

    /** Millisecondes restantes avant la fin de la fenêtre (`0` = libre). */
    @Synchronized
    fun remainingMs(): Long = (blockedUntil - clock()).coerceAtLeast(0L)

    /**
     * Arme la porte pour [cooldownMs] depuis maintenant. Un second refus
     * pendant la fenêtre la PROLONGE (il ne la raccourcit jamais).
     */
    @Synchronized
    fun trip() {
        val deadline = clock() + cooldownMs
        if (deadline > blockedUntil) blockedUntil = deadline
    }

    /**
     * Lève [RateLimitedError] si la fenêtre court : aucun appelant ne doit
     * envoyer de requête ni déclencher de rafraîchissement avant la fin.
     */
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
