package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client

/**
 * La SEULE porte d'entrée des lectures du client local : l'appelant pose la
 * lecture dans la file PARTAGÉE (`ClientQueue`), un appel client à la fois.
 * Le `Client` est mutable (`refresh()` réassigne `communication`, `attributes`
 * et la clé AES) : deux lectures simultanées = deux authentifications sur le
 * même compte = « Exceeded max authorization requests » (erreur 25), puis
 * limitation du compte. Les écrans et le job de fond passent tous par ici.
 */
internal fun cachedRead(client: Client, resource: String, query: String): String {
    val q = parseQuery(query)
    return when (resource) {
        CachePolicy.GRADES -> gradesPayload(client, q)
        CachePolicy.ASSIGNMENTS -> assignmentsPayload(client, q)
        CachePolicy.TIMETABLE -> timetablePayload(client, q)
        CachePolicy.NEWS -> newsPayload(client)
        CachePolicy.MENUS -> menusPayload(client)
        CachePolicy.ATTENDANCE -> attendancePayload(client)
        CachePolicy.PUNISHMENTS -> punishmentsPayload(client)
        CachePolicy.CAPABILITIES -> capabilitiesPayload(client)
        CachePolicy.DISCUSSIONS -> discussionsPayload(client)
        else -> throw IllegalArgumentException("ressource non cachable: $resource")
    }
}
