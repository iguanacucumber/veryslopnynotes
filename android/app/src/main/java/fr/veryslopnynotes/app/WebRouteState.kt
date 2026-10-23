package fr.veryslopnynotes.app

/**
 * Route de l'interface web : le CHEMIN porté par le HASH de l'URL (#400).
 *
 * L'interface est une SPA à routes par hash (`web/src/main.tsx` : `HashRouter`).
 * La route vit donc dans l'URL de la WebView
 * (`https://<hôte>/index.html#/grades`) et NULLE PART ailleurs : la perdre,
 * c'est retomber sur l'accueil — ce qui arrivait à chaque rotation de l'écran.
 *
 * Fichier PUR (aucun import `android.*`) : il compile seul sous `kotlinc`,
 * donc le harnais de parité le rejoue sur du VRAI code
 * (`tests/unit/kotlin-web-route.test.ts`).
 */

/** Route d'accueil : l'écran de départ, sans paramètre. */
const val HOME_ROUTE = "/"

/**
 * Clé de l'ÉTAT SAUVEGARDÉ où vit le chemin de la route (#400).
 *
 * L'état sauvegardé de l'activité porte deux choses : l'état de la WebView
 * (historique, page) et le CHEMIN de la route. Le chemin est le REPLI : si
 * l'état de la WebView est perdu (mort du processus), la route est relue
 * dans le Bundle et rouverte.
 */
const val ROUTE_STATE_KEY = "fr.veryslopnynotes.app.route"

/**
 * Routes hash connues (miroir de `web/src/App.tsx`).
 *
 * Une route hors de ce tableau n'est pas une route : la WebView n'en sert
 * jamais, et la restaurer ramènerait l'utilisateur sur un écran qui n'existe
 * pas. D'où le tri ici, et non dans l'appelant.
 */
val WEB_ROUTES: Set<String> = setOf(
    "/", "/calendar", "/grades", "/tasks", "/profile", "/settings",
    "/pairing", "/messages", "/attendance", "/sanctions", "/news",
    "/canteen", "/alerts", "/fiches", "/cahier",
)

/**
 * Route (chemin) portée par l'URL d'une WebView : le fragment après le `#`.
 *
 * `"…/index.html#/grades"` -> `"/grades"`. Les paramètres de requête du
 * fragment (`#/grades?tab=x`) sont ignorés : c'est le CHEMIN qui compte.
 *
 * Renvoie `null` — donc « aucune route » — quand l'URL ne porte pas de hash,
 * quand le hash n'est pas un chemin, ou quand le chemin est hors contrat.
 * L'appelant retombe alors sur l'accueil : jamais sur une route inventée.
 *
 * @param url URL courante de la WebView (avec son fragment).
 * @return le chemin de route, ou `null` si l'URL n'en porte pas.
 */
fun routePathFromUrl(url: String?): String? {
    val fragment = url?.substringAfter('#', "") ?: return null
    if (!fragment.startsWith("/")) return null
    val path = fragment.substringBefore('?')
    return path.takeIf { it in WEB_ROUTES }
}

/**
 * Route relue dans l'ÉTAT SAUVEGARDÉ : le chemin tel qu'il y a été écrit.
 *
 * Un chemin hors contrat n'est pas une route : il est REFUSÉ (l'appelant
 * retombe alors sur l'accueil), jamais servi tel quel.
 *
 * @param path chemin lu dans l'état sauvegardé.
 * @return le chemin de route, ou `null` s'il est absent ou hors contrat.
 */
fun routePathFromState(path: String?): String? = path?.takeIf { it in WEB_ROUTES }
