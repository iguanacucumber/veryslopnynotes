package fr.veryslopnynotes.data

/**
 * Mode d'ouverture d'une session persistée.
 *
 * `JETON` : appairage par QR — la session se rouvre par son jeton de connexion
 * (le PIN du QR, lui, n'est jamais persisté).
 *
 * `IDENTIFIANT` : établissement de DÉMONSTRATION — la session se rouvre par le
 * couple identifiant / mot de passe PUBLIC du compte de démonstration. Ce
 * compte n'est pas appairé : il n'a pas de jeton, et son mot de passe n'est
 * pas un secret (l'éditeur le publie sur son site de démonstration).
 */
object SessionMode {
    const val JETON = "jeton"
    const val IDENTIFIANT = "identifiant"

    /**
     * Mode de réouverture d'une session persistée.
     *
     * Une valeur absente ou inconnue = `JETON` : c'est le mode de toutes les
     * sessions antérieures (le store ne connaissait que le jeton) et le mode
     * par défaut d'un appairage.
     */
    fun of(stored: String?): String = if (stored == IDENTIFIANT) IDENTIFIANT else JETON
}
