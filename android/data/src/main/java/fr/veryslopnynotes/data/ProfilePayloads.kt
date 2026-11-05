package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.CapabilityProbe
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.core.UserProfileRules
import fr.veryslopnynotes.pronote.Client
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.encodeToJsonElement
import java.time.Clock

@Serializable
private data class CapabilitiesBody(
    val accountId: String,
    val tabs: List<String>,
    val fetchedAt: String,
)

@Serializable
private data class CapabilitiesPayload(
    val capabilities: JsonElement,
)

@Serializable
private data class ProfileUser(
    val accountId: String,
    val displayName: String,
    val firstName: String,
    val lastName: String,
    val classLabel: String? = null,
    val periodId: String? = null,
    val periodName: String? = null,
    val photoRef: String? = null,
    val hasKids: Boolean,
    val kids: List<String>,
)

@Serializable
private data class MePayload(
    val user: JsonElement,
)

@Serializable
private data class AlertEntry(
    val id: String,
    val kind: String,
    val excerpt: String,
    val source: String,
)

@Serializable
private data class AlertsPayload(
    val alerts: List<AlertEntry>,
)

internal fun capabilitiesPayload(client: Client, nowIso: String = parisNowIso()): String {
    val periods = try {
        client.periods
    } catch (e: Exception) {
        if (mustPropagateReadFailure(e)) throw e
        emptyList()
    }
    val info = try {
        client.info
    } catch (e: Exception) {
        if (mustPropagateReadFailure(e)) throw e
        null
    }
    val caps = CapabilityProbe.fromProbe(
        client.infoId ?: "",
        mapOf(
            "grades" to periods.isNotEmpty(),
            "homework" to true,
            "timetable" to true,
            "news" to true,
            "menus" to true,
            "attendance" to periods.isNotEmpty(),
            "punishments" to periods.isNotEmpty(),
            "discussions" to true,
            "profile" to (info != null),
        ),
        nowIso,
    )
    // Contrat invalide = `capabilities: null`, que le lecteur web et le pont
    // lisent comme « inconnu ». JAMAIS une liste d'onglets vide : elle
    // affirmerait « tout désactivé » et blackouterait la navigation.
    val body = caps?.let { CapabilitiesBody(it.accountId, it.tabs, it.fetchedAt) }
    val encoded = body?.let { payloadJson.encodeToJsonElement(it) } ?: JsonNull
    return payloadJson.encodeToString(CapabilitiesPayload(encoded))
}

internal fun mePayload(client: Client, clock: Clock = schoolClock()): String {
    val info = client.info
    val displayName = boundedCp(info.name, 64)
    if (displayName.isEmpty()) return payloadJson.encodeToString(MePayload(JsonNull))
    val periods = try {
        client.periods
    } catch (e: Exception) {
        if (mustPropagateReadFailure(e)) throw e
        emptyList()
    }
    val now = schoolNow(clock)
    val current = periods.find { !now.isBefore(it.start) && !now.isAfter(it.end) } ?: periods.firstOrNull()
    val picId = info.profilePicture?.id?.trim().orEmpty()
    val photoRef = if (Regex("^[A-Za-z0-9._-]{1,150}$").matches(picId)) "photo:$picId" else null
    val user = ProfileUser(
        accountId = (info.id ?: "").trim().take(64),
        displayName = displayName,
        firstName = "",
        lastName = "",
        classLabel = boundedCp(info.className, 64).ifEmpty { null },
        periodId = current?.id?.take(64),
        // Borne du noyau (miroir du contrat) : le publié ne peut pas dépasser
        // ce que le validateur accepte.
        periodName = current?.let { boundedCp(it.name, UserProfileRules.MAX_PERIOD_NAME) },
        photoRef = photoRef,
        hasKids = false,
        kids = emptyList(),
    )
    return payloadJson.encodeToString(MePayload(payloadJson.encodeToJsonElement(user)))
}

/** Textes scannés = contenus déjà en cache : aucun réseau, marche hors ligne. */
internal fun alertsPayload(texts: List<SecurityAlert.ScannableText>): String {
    val alerts = SecurityAlert.scanTextsForInjections(texts).map {
        AlertEntry(it.id, it.kind, it.excerpt, it.source)
    }
    return payloadJson.encodeToString(AlertsPayload(alerts))
}
