package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import fr.veryslopnynotes.core.AiConsentDecision
import fr.veryslopnynotes.core.AiConsentRecord
import fr.veryslopnynotes.core.encodeAiConsent
import fr.veryslopnynotes.core.parseAiConsent

/**
 * Consentement IA persisté, au niveau de l'appareil. Aucun secret ici : le
 * fichier est en clair, mais une acceptation n'est valide qu'après un
 * `commit()` synchrone (un force-stop ne doit pas ramener l'IA à l'insu de
 * l'utilisateur). Un stockage indisponible ou corrompu = aucun accord.
 */
class AiConsentStore(context: Context) {
    private val prefs: SharedPreferences? = try {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    } catch (_: Exception) {
        null
    }

    fun record(): AiConsentRecord = parseAiConsent(
        try {
            prefs?.getString(KEY_DECISION, null)
        } catch (_: Exception) {
            null
        },
    )

    fun allowsAi(): Boolean = record().allowsAi

    /** `false` = rien n'a été écrit : l'appelant ne doit pas annoncer un choix. */
    fun decide(decision: AiConsentDecision): Boolean {
        if (decision == AiConsentDecision.NONE) return false
        val target = prefs ?: return false
        return try {
            target.edit().putString(KEY_DECISION, encodeAiConsent(decision)).commit()
        } catch (_: Exception) {
            false
        }
    }

    fun clear(): Boolean {
        val target = prefs ?: return false
        return try {
            target.edit().remove(KEY_DECISION).commit()
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        internal const val PREFS = "ai_consent"
        private const val KEY_DECISION = "decision"
    }
}
