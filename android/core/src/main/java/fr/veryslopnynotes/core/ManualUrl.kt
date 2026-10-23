package fr.veryslopnynotes.core

// Adresse du manuel de l'élève (saisie UNE fois dans l'app, réutilisée par
// l'assistant devoirs et les fiches de révision).
//
// L'app ne télécharge JAMAIS cette page elle-même : elle la confie au scraper
// facultatif (`POST /v1/manuals/scrape`). Le serveur refait donc sa propre
// garde SSRF, et cette validation n'est qu'un premier filtre lisible : schéma
// http(s), hôte présent, pas d'identifiants, pas d'espace ni de caractère de
// contrôle. Un nom qui résout vers une IP privée est refusé par le SERVEUR
// (I8) — inutile de dupliquer ici une résolution DNS que l'app ne fait pas.
sealed interface ManualUrlResult {
    data class Ok(val url: String) : ManualUrlResult
    data class Rejected(val message: String) : ManualUrlResult
}

object ManualUrl {
    /** Miroir de `MANUALS_SCRAPE_URL_MAX_CHARS` (shared/contracts/api.ts). */
    const val MAX_CHARS = 2000

    fun validate(raw: String): ManualUrlResult {
        val input = raw.trim()
        if (input.isEmpty()) {
            return rejected("Adresse vide : colle l'adresse de ton manuel.")
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
        // Autorité = jusqu'au premier séparateur de chemin / paramètres / ancre.
        val afterScheme = input.substring(sep + 3)
        val authority = afterScheme.takeWhile { it != '/' && it != '?' && it != '#' }
        if (authority.isEmpty()) {
            return rejected("Domaine manquant après le schéma.")
        }
        if (authority.contains('@')) {
            // Le scraper ne s'authentifie pas : des identifiants dans l'URL
            // laisseraient croire le contraire (et seraient stockés pour rien).
            return rejected("Identifiants dans l'adresse refusés : le scraper ne s'authentifie pas.")
        }
        if (authority.contains('\\')) {
            return rejected("Caractère interdit dans le domaine.")
        }
        return ManualUrlResult.Ok(input)
    }

    private fun rejected(message: String): ManualUrlResult = ManualUrlResult.Rejected(message)
}
