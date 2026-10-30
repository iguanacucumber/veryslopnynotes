package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.CapabilityProbe
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.core.UserProfileRules
import fr.veryslopnynotes.pronote.Client
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDateTime

// Profil : payloads `capabilities`, `me` et `alerts`.

internal fun capabilitiesPayload(client: Client, nowIso: String = parisNowIso()): String {    val periods = try {
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
    // Contrat invalide = rien n'est affirmé : on publie `capabilities: null`
    // (le lecteur web et le pont en font « inconnu », donc rien n'est masqué).
    // JAMAIS une liste d'onglets vide : elle affirmerait « tous les onglets
    // désactivés » et blackouterait la navigation (#413).
    val body = caps?.let {
        JSONObject().apply {
            put("accountId", it.accountId)
            put("tabs", JSONArray(it.tabs))
            put("fetchedAt", it.fetchedAt)
        }
    } ?: JSONObject.NULL
    return JSONObject().put("capabilities", body).toString()
}

// --- Profil ------------------------------------------------------------------

internal fun mePayload(client: Client, now: LocalDateTime = LocalDateTime.now()): String {
    val info = client.info
    val displayName = boundedCp(info.name, 64)
    if (displayName.isEmpty()) return JSONObject().put("user", JSONObject.NULL).toString()
    val periods = try {
        client.periods
    } catch (e: Exception) {
        if (mustPropagateReadFailure(e)) throw e
        emptyList()
    }
    val current = periods.find { !now.isBefore(it.start) && !now.isAfter(it.end) } ?: periods.firstOrNull()
    val picId = info.profilePicture?.id?.trim().orEmpty()
    val photoRef = if (Regex("^[A-Za-z0-9._-]{1,150}$").matches(picId)) "photo:$picId" else null
    val user = JSONObject().apply {
        put("accountId", (info.id ?: "").trim().take(64))
        put("displayName", displayName)
        put("firstName", "")
        put("lastName", "")
        putIf("classLabel", boundedCp(info.className, 64).ifEmpty { null })
        current?.let {
            put("periodId", it.id.take(64))
            // La borne du libellé est celle du noyau (miroir du contrat) :
            // le publié ne peut pas dépasser ce que le validateur accepte.
            put("periodName", boundedCp(it.name, UserProfileRules.MAX_PERIOD_NAME))
        }
        putIf("photoRef", photoRef)
        put("hasKids", false)
        put("kids", JSONArray())
    }
    return JSONObject().put("user", user).toString()
}

// --- Alertes -----------------------------------------------------------------

/** Textes scannés = contenus déjà en cache (aucun réseau : marche hors ligne). */
internal fun alertsPayload(texts: List<SecurityAlert.ScannableText>): String {
    val arr = JSONArray()
    for (a in SecurityAlert.scanTextsForInjections(texts)) {
        arr.put(JSONObject().apply {
            put("id", a.id)
            put("kind", a.kind)
            put("excerpt", a.excerpt)
            put("source", a.source)
        })
    }
    return JSONObject().put("alerts", arr).toString()
}
