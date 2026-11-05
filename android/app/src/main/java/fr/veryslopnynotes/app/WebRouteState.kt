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
    "/", "/calendar", "/grades", "/tasks", "/profile", "/settings", "/help",
    "/about", "/licenses",
    "/pairing", "/messages", "/attendance", "/sanctions", "/news",
    "/canteen", "/alerts", "/revision-sheets", "/course-notes", "/prof",
    // Aliases kept so a saved route or old deep link still resolves.
    "/fiches", "/cahier",
)

/**
 * Sous-routes du contrat, sans hôte de deep link dédié (le manifest DEBUG ne
 * peut pas exprimer un paramètre). Le mirror de parité les inclut.
 */
val WEB_SUBROUTES: Set<String> = setOf("/messages/new", "/messages/:id")

/** Le fil porte un id concret : la route du contrat est `/messages/:id`, mais
 *  l'état doit préserver l'URL réelle pour retrouver la discussion. */
private val MESSAGES_THREAD_ROUTE = Regex("^/messages/[^/]+$")

/** Route servie : une entrée du contrat, une sous-route, ou un fil identifié. */
fun isServedRoute(path: String?): Boolean =
    path != null &&
        (path in WEB_ROUTES || path in WEB_SUBROUTES || MESSAGES_THREAD_ROUTE.matches(path))

/**
 * Paramètres de requête du fragment ignorés : c'est le CHEMIN qui compte.
 * `null` = pas de hash, hash hors chemin ou hors contrat ; l'appelant retombe
 * alors sur l'accueil.
 */
fun routePathFromUrl(url: String?): String? {
    val fragment = url?.substringAfter('#', "") ?: return null
    if (!fragment.startsWith("/")) return null
    val path = fragment.substringBefore('?')
    return path.takeIf { isServedRoute(it) }
}

/** Un chemin hors contrat n'est pas une route : REFUSÉ, jamais servi tel quel. */
fun routePathFromState(path: String?): String? = path?.takeIf { isServedRoute(it) }
