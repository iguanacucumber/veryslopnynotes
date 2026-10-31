package fr.veryslopnynotes.pronote

import java.util.concurrent.atomic.AtomicBoolean

/**
 * UN seul rafraîchissement à la fois : `tryEnter()` est un CAS, donc deux
 * threads ne peuvent pas être admis ensemble. Le perdant ne double pas la
 * connexion (deux `Communication` = deux cookies, et le serveur répond `G=25`
 * « Exceeded max authorization requests »).
 *
 * `leave()` est appelé dans un `finally` : un rafraîchissement raté ne bloque
 * jamais les suivants. La porte interdit aussi au login d'un refresh en cours
 * de déclencher un second refresh (récursion).
 *
 * Kotlin pur : testé par `agents/runtime/kotlin-parity/RefreshGateParityMain.kt`.
 */
class RefreshGate {
    private val held = AtomicBoolean(false)

    fun tryEnter(): Boolean = held.compareAndSet(false, true)

    fun leave(): Unit = held.set(false)

    fun isHeld(): Boolean = held.get()
}
