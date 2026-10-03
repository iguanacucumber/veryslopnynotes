package fr.veryslopnynotes.ui

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

// Thème clair/sombre #83 : préférence persistée (SharedPreferences = plateforme
// Android, aucune dépendance ajoutée, pas de DataStore) + application d'un jeu
// de couleurs Material3 de base. Survit au restart.
// ponytail: trois modes seulement (Système/Clair/Sombre) et deux schemes de
// base, aucun registre de thèmes ni accents dérivés des prefs matière.
// Upgrade: accents par matière + Dynamic Color si le besoin se prouve.

enum class AppTheme { SYSTEM, LIGHT, DARK }

fun themeLabel(theme: AppTheme): String = when (theme) {
    AppTheme.SYSTEM -> "Système"
    AppTheme.LIGHT -> "Clair"
    AppTheme.DARK -> "Sombre"
}

/** Valeur inconnue/absente = Système (défaut sûr, jamais de crash). */
fun parseTheme(raw: String?): AppTheme = when (raw) {
    AppTheme.LIGHT.name -> AppTheme.LIGHT
    AppTheme.DARK.name -> AppTheme.DARK
    else -> AppTheme.SYSTEM
}

/** Thème effectif : la préférence l'emporte, sinon réglage système. */
fun isDarkTheme(theme: AppTheme, systemDark: Boolean): Boolean = when (theme) {
    AppTheme.SYSTEM -> systemDark
    AppTheme.DARK -> true
    AppTheme.LIGHT -> false
}

private const val THEME_PREFS = "settings"
private const val THEME_KEY = "theme"

private fun themePrefs(ctx: Context): SharedPreferences? = try {
    ctx.getSharedPreferences(THEME_PREFS, Context.MODE_PRIVATE)
} catch (_: Exception) {
    // Préfs KO = thème session seule, pas de crash.
    null
}

// Préférence persistée + setter Compose. Un couple suffit (pas de ViewModel).
@Composable
fun rememberAppTheme(): Pair<AppTheme, (AppTheme) -> Unit> {
    val ctx = LocalContext.current.applicationContext
    val store = remember(ctx) { themePrefs(ctx) }
    val theme = remember(store) { mutableStateOf(parseTheme(store?.getString(THEME_KEY, null))) }
    return theme.value to { next: AppTheme ->
        theme.value = next
        try {
            store?.edit()?.putString(THEME_KEY, next.name)?.apply()
        } catch (_: Exception) {
            // Idem : thème session seule si l'écriture échoue.
        }
    }
}
