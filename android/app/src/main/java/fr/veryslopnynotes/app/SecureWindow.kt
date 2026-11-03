package fr.veryslopnynotes.app

// La fenêtre entière est protégée, pas seulement un écran : TOUTES les routes
// servies portent une donnée scolaire, la clé LLM ou l'appairage (aucune n'est
// publique). Une décision par route demanderait un signal de navigation JS et
// laisserait une frame où l'écran suivant est déjà dessiné.

/**
 * `FLAG_SECURE` en release seulement. Le build debug reste capturable : `make
 * shot`, le débogage WebView et les captures de développement en dépendent.
 */
fun secureWindowRequired(isDebugBuild: Boolean): Boolean = !isDebugBuild
