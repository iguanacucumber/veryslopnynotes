package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import java.time.Clock

/**
 * La SEULE porte d'entrée des lectures du client local : l'appelant pose la
 * lecture dans la file PARTAGÉE (`ClientQueue`), un appel client à la fois.
 * Le `Client` est mutable (`refresh()` réassigne `communication`, `attributes`
 * et la clé AES) : deux lectures simultanées = deux authentifications sur le
 * même compte = « Exceeded max authorization requests » (erreur 25), puis
 * limitation du compte. Les écrans et le job de fond passent tous par ici.
 *
 * `previous` = payload de la MÊME requête déjà en cache : seules les lectures
 * qui peuvent en réutiliser une partie le lisent (dates des fils de messagerie).
 */
internal fun cachedRead(
    client: Client,
    resource: String,
    query: String,
    previous: String? = null,
    clock: Clock = schoolClock(),
    epoch: Long = SessionEpoch.current(),
): String {
    val q = parseQuery(query)
    return when (resource) {
        CachePolicy.GRADES -> gradesPayload(client, q)
        CachePolicy.ASSIGNMENTS -> assignmentsPayload(client, q, clock)
        CachePolicy.TIMETABLE -> timetablePayload(client, q, clock)
        CachePolicy.NEWS -> newsPayload(client)
        CachePolicy.MENUS -> menusPayload(client, clock)
        CachePolicy.ATTENDANCE -> attendancePayload(client)
        CachePolicy.PUNISHMENTS -> punishmentsPayload(client)
        CachePolicy.CAPABILITIES -> capabilitiesPayload(client, parisNowIso(clock))
        CachePolicy.DISCUSSIONS -> discussionsPayload(client, previous = previous, epoch = epoch)
        else -> throw IllegalArgumentException("ressource non cachable: $resource")
    }
}
