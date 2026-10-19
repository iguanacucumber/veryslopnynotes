package fr.veryslopnynotes.core

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Lecture d'une date ISO-8601, SÉMIANTIQUE `Date.parse` TS (#366).
 *
 * UN SEUL parseur pour tout le noyau : `isoMillis` (tri de l'historique des
 * notes, bornes des absences) et `isIsoDateLike` (validité d'une note) ne
 * peuvent plus se contredire. Avant, une date-heure locale sans décalage
 * (`2026-10-02T10:00:00`) était acceptée par l'un et refusée par l'autre :
 * l'absence était exclue du calcul (aucune notification) et la note sortait
 * en dernier de l'historique (courbe décalée).
 *
 * Formes lues :
 * - horodaté AVEC décalage (`…Z`, `…+02:00`) : l'instant est absolu ;
 * - horodaté SANS décalage (`2026-10-02T10:00:00`) : heure LOCALE de
 *   l'appareil, comme `new Date("2026-10-02T10:00:00")` côté web ;
 * - date seule (`2026-10-02`) : minuit UTC, comme `Date.parse` TS.
 *
 * ponytail: formes ISO seulement. Le contrat TS (`Date.parse`) accepte en
 * plus les formats historiques (« 2 octobre 2026 ») : l'écart joue dans le
 * sens prudent (une date non ISO n'est pas retenue), c'est le seul écart
 * connu entre les deux parseurs.
 */
internal fun isoMillis(value: String?): Long? {
    val text = value?.trim().orEmpty()
    if (text.isEmpty()) return null
    return try {
        // Horodaté avec décalage : l'instant est absolu.
        OffsetDateTime.parse(text).toInstant().toEpochMilli()
    } catch (_: Exception) {
        try {
            // Horodaté SANS décalage : heure locale de l'appareil (comme `Date.parse` TS).
            LocalDateTime.parse(text).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        } catch (_: Exception) {
            try {
                // Date seule : minuit UTC (comme `Date.parse` TS).
                LocalDate.parse(text).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            } catch (_: Exception) {
                null
            }
        }
    }
}

/** Date ISO lisible : le MÊME verdict que `isoMillis` (un seul parseur). */
internal fun isIsoDateLike(value: String?): Boolean = isoMillis(value) != null
