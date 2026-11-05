package fr.veryslopnynotes.data

import kotlinx.serialization.json.Json

/** Contrat commun des payloads : pas de nulls ni de défauts dans le JSON. */
internal val payloadJson: Json = Json {
    explicitNulls = false
    encodeDefaults = false
}
