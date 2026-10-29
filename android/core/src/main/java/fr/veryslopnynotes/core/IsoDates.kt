package fr.veryslopnynotes.core

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

private val PARIS_ZONE: ZoneId = ZoneId.of("Europe/Paris")
private val ISO_DAY_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

/** Largeur d'un jour civil « AAAA-MM-JJ » (repli contrat, jamais une date affichée). */
private const val ISO_DAY_CHARS = 10

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

/**
 * Jour civil d'un instant ISO, « AAAA-MM-JJ », vu par l'élève (fuseau
 * Europe/Paris) : instant illisible = dix premiers caractères, jamais
 * d'exception.
 *
 * Lecture par le parseur UNIQUE du noyau (`isoMillis`, #366) : l'affichage et
 * le calcul ne peuvent pas dater la même valeur différemment.
 *
 * ponytail: un seul fuseau d'affichage (élève France). Upgrade: fuseau par
 * établissement quand multi-écoles.
 */
fun localDay(iso: String): String {
    val millis = isoMillis(iso)
    if (millis == null) {
        // Instant illisible : la référence renvoie la tranche (`iso.slice`)
        // — repli contrat rejoué en parité, jamais une date affichée.
        return iso.take(ISO_DAY_CHARS)
    }
    return Instant.ofEpochMilli(millis).atZone(PARIS_ZONE).format(ISO_DAY_FORMAT)
}
