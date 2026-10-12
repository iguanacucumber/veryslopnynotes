package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.SecurityAlert
import org.json.JSONArray
import org.json.JSONObject

// Dépôt alertes sécurité (#21) : parse du payload local (#205).
// Le contenu est balayé sur l'appareil (`SecurityAlert.scanTextsForInjections`,
// I6) : l'extrait reste une DONNÉE bornée, jamais interprétée (pas de
// WebView/Html ici ni côté ui).
class SecurityAlertsRepository {
    companion object {
        // ponytail: parse manuel org.json, pas de serializer. Upgrade: kotlinx.serialization si modèles > 10.
        fun parse(body: String): List<SecurityAlert> {
            val root = JSONObject(body)
            val arr: JSONArray = root.optJSONArray("alerts") ?: JSONArray()
            val out = mutableListOf<SecurityAlert>()
            for (i in 0 until arr.length()) {
                val o: JSONObject = arr.optJSONObject(i) ?: continue
                val alert = SecurityAlert(
                    id = o.optString("id", ""),
                    kind = o.optString("kind", ""),
                    excerpt = o.optString("excerpt", ""),
                    source = o.optString("source", ""),
                )
                if (SecurityAlert.isValid(alert)) out.add(alert)
            }
            return out
        }
    }
}
