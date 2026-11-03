package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.RateLimitedError
import java.io.File

/**
 * Cooldown PERSISTANT : la fenêtre survit à un redémarrage du process.
 * Une écriture ratée ne bloque jamais l'appelant — le cooldown en mémoire
 * reste armé, seul le redémarrage le perdrait.
 */
interface CooldownStore {
    fun loadUntil(): Long

    fun saveUntil(until: Long)
}

class FileCooldownStore(private val file: File) : CooldownStore {
    override fun loadUntil(): Long = try {
        if (!file.isFile) {
            0L
        } else {
            val raw = file.readText().trim().toLongOrNull() ?: 0L
            // Un fichier corrompu ne doit pas immobiliser l'app pour toujours :
            // l'horloge murale elle-même peut sauter.
            raw.coerceIn(0L, System.currentTimeMillis() + MAX_PERSISTED_COOLDOWN_MS)
        }
    } catch (_: Exception) {
        0L
    }

    override fun saveUntil(until: Long) {
        try {
            val bounded = until.coerceIn(0L, System.currentTimeMillis() + MAX_PERSISTED_COOLDOWN_MS)
            writeFileAtomically(file, bounded.toString().toByteArray(Charsets.UTF_8)) { target, bytes ->
                target.writeBytes(bytes)
            }
        } catch (_: Exception) {
            // Le cooldown en mémoire est déjà armé : une persistance ratée ne
            // doit pas empêcher l'attente, seulement la perdre au redémarrage.
        }
    }

    private companion object {
        const val MAX_PERSISTED_COOLDOWN_MS = 24L * 60L * 60L * 1000L
    }
}

/** Ce que la file demande avant/après une requête scolaire. */
interface QueuePacer {
    /** Bloque jusqu'à ce qu'un jeton soit disponible, cooldown compris. */
    fun awaitTurn()

    /** Un travail a échoué : un rate-limit arme le cooldown. */
    fun onFailure(cause: Throwable)
}

/**
 * Cadence les requêtes scolaires : seau à jetons (débit borné, rafale `capacity`)
 * + gigue sur l'espacement, + cooldown après `G=25`/429.
 *
 * UNE instance par process (`ClientQueue`) : deux seaux laisseraient passer
 * deux fois le débit. `clock`/`sleep`/`random` sont injectables pour que les
 * tests rejouent le temps sans attendre.
 */
class SchoolPacer(
    private val capacity: Int = 1,
    private val refillMs: Long = 1_000L,
    private val jitterMs: Long = 250L,
    private val defaultCooldownMs: Long = 120_000L,
    private val clock: () -> Long = System::currentTimeMillis,
    private val sleep: (Long) -> Unit = { millis -> if (millis > 0L) Thread.sleep(millis) },
    private val random: () -> Double = { Math.random() },
) : QueuePacer {
    private val lock = Any()
    private val burst = capacity.coerceAtLeast(1)
    private val refill = refillMs.coerceAtLeast(1L)
    private var tokens = burst.toDouble()
    private var lastRefill = clock()
    private var cooldownUntil = 0L
    private var turns = 0L

    @Volatile
    private var store: CooldownStore? = null

    /** Charge le cooldown persistant ; un redémarrage ne repart pas à zéro. */
    fun attachStore(store: CooldownStore?) {
        synchronized(lock) {
            this.store = store
            val persisted = store?.loadUntil() ?: 0L
            if (persisted > cooldownUntil) cooldownUntil = persisted
        }
    }

    fun remainingCooldownMs(): Long = synchronized(lock) { (cooldownUntil - clock()).coerceAtLeast(0L) }

    /**
     * Un second refus pendant la fenêtre la PROLONGE (jamais ne la raccourcit).
     * `Retry-After` est un plancher ; `defaultCooldownMs` sert quand l'en-tête
     * est absent. La gigue évite que plusieurs appareils repartent ensemble.
     */
    fun armCooldown(ms: Long) {
        val jitter = if (jitterMs > 0L) (random().coerceIn(0.0, 1.0) * jitterMs).toLong() else 0L
        val until = clock() + ms.coerceAtLeast(0L) + jitter
        synchronized(lock) {
            if (until > cooldownUntil) {
                cooldownUntil = until
                store?.saveUntil(until)
            }
        }
    }

    override fun onFailure(cause: Throwable) {
        if (cause !is RateLimitedError) return
        armCooldown(maxOf(defaultCooldownMs, cause.retryAfterMs ?: 0L))
    }

    override fun awaitTurn() {
        while (true) {
            val wait = synchronized(lock) { nextWaitMs() }
            if (wait <= 0L) {
                applyJitter()
                return
            }
            sleep(wait)
        }
    }

    /** `0` = un jeton vient d'être consommé ; sinon durée à attendre. */
    private fun nextWaitMs(): Long {
        val now = clock()
        val cooling = cooldownUntil - now
        if (cooling > 0L) return cooling
        val elapsed = (now - lastRefill).coerceAtLeast(0L)
        if (elapsed > 0L) {
            tokens = (tokens + elapsed.toDouble() / refill.toDouble()).coerceAtMost(burst.toDouble())
            lastRefill = now
        }
        if (tokens >= 1.0) {
            tokens -= 1.0
            turns += 1L
            return 0L
        }
        val needed = kotlin.math.ceil((1.0 - tokens) * refill.toDouble()).toLong()
        return needed.coerceAtLeast(1L)
    }

    /** Première requête immédiate ; les suivantes sont décalées entre elles. */
    private fun applyJitter() {
        if (turns <= 1L || jitterMs <= 0L) return
        val wait = (random().coerceIn(0.0, 1.0) * jitterMs).toLong()
        if (wait > 0L) sleep(wait)
    }
}
