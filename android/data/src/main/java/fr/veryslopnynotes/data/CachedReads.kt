package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client

/**
 * Les lectures du client local — la SEULE porte d'entrée (#403).
 *
 * Toute ressource lue sur le client passe par ici, et l'appelant pose la
 * lecture dans la file PARTAGÉE (`ClientQueue`) : UN appel client à la fois
 * dans le process. Le `Client` est mutable (`refresh()` réassigne
 * `communication`, `attributes` et la clé AES) : deux lectures simultanées =
 * deux authentifications sur le même compte = « Exceeded max authorization
 * requests » (erreur 25) → l'établissement limite le compte.
 *
 * Les écrans ET le job de fond passent par ce chemin : plus de lecture
 * « directe » du client, qui se croisait avec le job de fond.
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
