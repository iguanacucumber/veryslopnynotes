package fr.veryslopnynotes.core

import kotlin.math.roundToInt

/**
 * Taille du texte de l'interface web, en pourcentage.
 *
 * Le choix explicite (100/125/150) prime ; `SYSTEM` suit le réglage Android.
 * `fontScale` peut dépasser 150 % : le rendu doit tenir jusqu'à 200 %.
 */
object TextScale {
    const val SYSTEM = "SYSTEM"

    val OPTIONS = listOf(100, 125, 150)

    /** Bornes du zoom WebView : hors de là, la page n'est plus lisible. */
    const val MIN_ZOOM = 50
    const val MAX_ZOOM = 200

    /** Choix valide et normalisé, `SYSTEM` compris ; `null` = valeur inconnue. */
    fun parse(raw: String?): String? {
        val trimmed = raw?.trim() ?: return null
        if (trimmed.equals(SYSTEM, ignoreCase = true)) return SYSTEM
        return trimmed.toIntOrNull()?.takeIf { it in OPTIONS }?.toString()
    }

    /** Valeur persistée : un choix inconnu retombe sur le système. */
    fun wire(raw: String?): String = parse(raw) ?: SYSTEM

    /** `fontScale` Android (1.0 = 100 %) borné pour `WebSettings.textZoom`. */
    fun fromFontScale(fontScale: Float): Int {
        if (!fontScale.isFinite()) return 100
        return (fontScale * 100f).roundToInt().coerceIn(MIN_ZOOM, MAX_ZOOM)
    }

    /** Zoom effectif : le choix explicite gagne, sinon le système décide. */
    fun zoom(preference: String?, fontScale: Float): Int =
        parse(preference)?.toIntOrNull() ?: fromFontScale(fontScale)
}
