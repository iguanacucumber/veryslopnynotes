package fr.veryslopnynotes.pronote

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Porte de rafraîchissement de session (#405).
 *
 * UN seul rafraîchissement à la fois : `tryEnter()` est un CAS
 * (`compareAndSet(false, true)`) — la lecture et la prise sont UNE seule
 * opération atomique, donc deux threads ne peuvent pas être admis ensemble.
 * Le perdant voit la porte fermée : il ne double pas la connexion (deux
 * `Communication` = deux cookies, deux compteurs de requêtes, et le serveur
 * répondait alors `G=25` « Exceeded max authorization requests »).
 *
 * `leave()` rend la porte : l'appelant le fait dans un `finally`, donc un
 * rafraîchissement RATÉ ne bloque jamais les suivants (c'était déjà le cas
 * avant #405 — c'est ce `finally` qui garantissait la libération).
 *
 * Le client sérialise en plus les requêtes et le rafraîchissement (un
 * moniteur partagé, cf. `ClientBase.post`/`refresh`) : la porte est donc la
 * BARRIÈRE du refresh — elle interdit au login d'un refresh en cours de
 * déclencher un second refresh (récursion), et garantit qu'un seul
 * rafraîchissement est admis.
 *
 * Kotlin pur, stdlib seulement : la logique est testée pour de vrai par le
 * harnais de parité (`agents/runtime/kotlin-parity/RefreshGateParityMain.kt`).
 */
class RefreshGate {
    private val held = AtomicBoolean(false)

    /** Prend la porte (`true`) ou la refuse (`false` : un refresh est en cours). */
    fun tryEnter(): Boolean = held.compareAndSet(false, true)

    /** Rend la porte (idempotent). */
    fun leave(): Unit = held.set(false)

    /** La porte est-elle fermée ? */
    fun isHeld(): Boolean = held.get()
}
