package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

/**
 * Miroir de `ClientBaseLike` (`dataClasses.d.ts`) : `periods` et `ClientInfo`
 * complets ne sont pas requis pour discuter.
 */
interface PronoteClientLike {
    fun post(functionName: String, onglet: Double?, data: Map<String, JVal>?): JVal
    val communication: Communication
    val attributes: Map<String, String>
    val funcOptions: JVal
    val infoId: String?
    fun getWeek(date: LocalDateTime): Int
}
