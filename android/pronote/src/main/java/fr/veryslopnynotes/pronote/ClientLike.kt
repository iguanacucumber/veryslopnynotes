package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

/**
 * Ce que les objets PRONOTE attendent d'un client (#201).
 *
 * Miroir de `ClientBaseLike` (`dataClasses.d.ts`) : `post`, `communication`,
 * `attributes`, `funcOptions`, `periods`, `getWeek`, `info.id`. `periods` n'est
 * pas repris (seul `StudentClass.students` s'en servait, non porté) ;
 * `info.id` devient `infoId` (pas de `ClientInfo` complet requis pour discuter).
 */
interface PronoteClientLike {
    fun post(functionName: String, onglet: Double?, data: Map<String, JVal>?): JVal
    val communication: Communication
    val attributes: Map<String, String>
    val funcOptions: JVal
    val infoId: String?
    fun getWeek(date: LocalDateTime): Int
}
