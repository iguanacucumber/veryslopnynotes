package fr.veryslopnynotes.app

import fr.veryslopnynotes.data.RequestCancellation
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

enum class AwaitOutcome { DONE, TIMED_OUT, CANCELLED }

/**
 * Attend un callback natif par TRANCHES courtes.
 *
 * `CountDownLatch.await(timeout)` seul ne rend pas la main quand l'appelant
 * abandonne : le fil du pont restait bloqué jusqu'au plafond (fil orphelin)
 * alors que le socket était déjà coupé. La tranche rend le fil au plus tard
 * après [SNAPSHOT_MS].
 */
object BridgeWait {
    const val SNAPSHOT_MS = 100L

    fun await(
        latch: CountDownLatch,
        timeoutMs: Long,
        cancellation: RequestCancellation? = null,
        sliceMs: Long = SNAPSHOT_MS,
    ): AwaitOutcome {
        val slice = sliceMs.coerceAtLeast(1L)
        val deadline = System.nanoTime() + timeoutMs.coerceAtLeast(0L) * 1_000_000L
        while (true) {
            if (cancellation?.isCancelled == true) return AwaitOutcome.CANCELLED
            val remainingMs = (deadline - System.nanoTime()) / 1_000_000L
            if (remainingMs <= 0L) return AwaitOutcome.TIMED_OUT
            if (latch.await(minOf(remainingMs, slice), TimeUnit.MILLISECONDS)) return AwaitOutcome.DONE
        }
    }
}
