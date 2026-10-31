package fr.veryslopnynotes.app

// La route d'une SPA à routes par hash vit dans l'URL de la WebView et nulle
// part ailleurs : la perdre, c'est retomber sur l'accueil (ce qui arrivait à
// chaque rotation d'écran). Fichier PUR : compilé et exécuté par le harnais.

const val HOME_ROUTE = "/"

/**
 * L'état sauvegardé porte l'état de la WebView et le chemin : si l'état de la
 * WebView est perdu (mort du processus), la route est relue dans le Bundle.
 */
const val ROUTE_STATE_KEY = "fr.veryslopnynotes.app.route"

/**
 * Miroir de `web/src/App.tsx` : une route hors contrat n'est jamais servie,
 * d'où le tri ici et non dans l'appelant.
 */
val WEB_ROUTES: Set<String> = setOf(
    "/", "/calendar", "/grades", "/tasks", "/profile", "/settings",
    "/pairing", "/messages", "/attendance", "/sanctions", "/news",
    "/canteen", "/alerts", "/revision-sheets", "/course-notes", "/prof",
    // Aliases kept so a saved route or old deep link still resolves.
    "/fiches", "/cahier",
)

/**
 * Paramètres de requête du fragment ignorés : c'est le CHEMIN qui compte.
 * `null` = pas de hash, hash hors chemin ou hors contrat ; l'appelant retombe
 * alors sur l'accueil.
 */
fun routePathFromUrl(url: String?): String? {
    val fragment = url?.substringAfter('#', "") ?: return null
    if (!fragment.startsWith("/")) return null
    val path = fragment.substringBefore('?')
    return path.takeIf { it in WEB_ROUTES }
}

/** Un chemin hors contrat n'est pas une route : REFUSÉ, jamais servi tel quel. */
fun routePathFromState(path: String?): String? = path?.takeIf { it in WEB_ROUTES }
