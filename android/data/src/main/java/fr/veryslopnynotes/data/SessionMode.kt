package fr.veryslopnynotes.data

/**
 * Mode d'ouverture d'une session persistée.
 *
 * `JETON` : réouverture par le jeton d'appairage (le PIN n'est jamais persisté).
 * `IDENTIFIANT` : compte de DÉMONSTRATION, mot de passe public, non appairé —
 * donc sans jeton.
 */
object SessionMode {
    const val JETON = "jeton"
    const val IDENTIFIANT = "identifiant"

    /**
     * Absent ou inconnu = `JETON` : mode de toutes les sessions antérieures et
     * défaut d'un appairage.
     */
    fun of(stored: String?): String = if (stored == IDENTIFIANT) IDENTIFIANT else JETON
}
