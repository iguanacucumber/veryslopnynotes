package fr.veryslopnynotes.core

// Une page web choisie par l'élève devient une source CITÉE, même contrat que le
// manuel : texte borné, libellé « Web : titre », contenu marqué Untrusted (I6).
//
// L'URL ne vit QUE dans la saisie / l'appel au scraper : jamais dans [WebPageDoc],
// jamais dans [HomeworkSource], donc jamais dans le prompt ni dans un log.
sealed interface WebUrlResult {
    data class Ok(val url: String) : WebUrlResult
    data class Rejected(val message: String) : WebUrlResult
}

/**
 * Validation de la page web saisie : MÊMES règles que [ManualUrl]. Premier
 * filtre lisible seulement : le SERVEUR refait sa garde SSRF, y compris la
 * résolution DNS d'un nom public vers une IP privée.
 */
object WebUrl {
    /** Miroir de `WEB_SCRAPE_URL_MAX_CHARS` (shared/contracts/api.ts). */
    const val MAX_CHARS = 2000

    fun validate(raw: String): WebUrlResult {
        val input = raw.trim()
        if (input.isEmpty()) {
            return rejected("Adresse vide : colle l'adresse de la page web.")
        }
        if (input.length > MAX_CHARS) {
            return rejected("Adresse trop longue ($MAX_CHARS caractères maximum).")
        }
        if (input.any { it.isWhitespace() || it.isISOControl() }) {
            return rejected("Espace ou caractère interdit dans l'adresse.")
        }
        val sep = input.indexOf("://")
        if (sep <= 0) {
            return rejected("Adresse incomplète : commence par http ou https.")
        }
        val scheme = input.substring(0, sep).lowercase()
        if (scheme != "http" && scheme != "https") {
            return rejected("Schéma refusé : utilisez http ou https.")
        }
        val afterScheme = input.substring(sep + 3)
        val authority = afterScheme.takeWhile { it != '/' && it != '?' && it != '#' }
        if (authority.isEmpty()) {
            return rejected("Domaine manquant après le schéma.")
        }
        if (authority.contains('@')) {
            // Aucune authentification, aucun cookie de l'élève.
            return rejected("Identifiants dans l'adresse refusés : le scraper ne s'authentifie pas.")
        }
        if (authority.contains('\\')) {
            return rejected("Caractère interdit dans le domaine.")
        }
        return WebUrlResult.Ok(input)
    }

    private fun rejected(message: String): WebUrlResult = WebUrlResult.Rejected(message)
}

/** Titre + texte rendus par le scraper : aucune URL, aucun cookie. */
data class WebPageDoc(
    val title: String,
    val excerpt: String,
) {
    /** Bornes du contrat `WebScrapeDoc` (shared/contracts/api.ts). */
    fun isValid(): Boolean =
        title.isNotBlank() && title.length <= 200 &&
            excerpt.isNotBlank() && excerpt.length <= 8000
}

/**
 * Source citable d'une page web. Sans texte, aucune source n'est ajoutée : jamais
 * une page inventée. Le libellé suit le contrat du manuel (« Web : titre »).
 */
object WebPage {
    const val TITLE_MAX_CHARS = 200
    const val DEFAULT_LABEL = "Web"

    fun source(doc: WebPageDoc): HomeworkSource? {
        val excerpt = capped(doc.excerpt, Homework.MAX_SOURCE_CHARS)
        if (excerpt.isEmpty()) return null
        // Un titre qui EST une URL ne doit pas devenir un libellé : l'adresse
        // demandée ne part jamais dans le prompt.
        val rawTitle = capped(doc.title, TITLE_MAX_CHARS).takeUnless { it.contains("://") } ?: ""
        val title = rawTitle.ifEmpty { "Page web" }
        val label = capped("Web : $title", Homework.MAX_LABEL_CHARS).ifEmpty { DEFAULT_LABEL }
        return HomeworkSource(label = label, text = excerpt).takeIf { it.isValid() }
    }

    private fun capped(raw: String, max: Int): String {
        val trimmed = raw.trim()
        return if (trimmed.length > max) trimmed.take(max) else trimmed
    }
}
