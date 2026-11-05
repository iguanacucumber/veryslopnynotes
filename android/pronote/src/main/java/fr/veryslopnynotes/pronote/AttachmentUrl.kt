package fr.veryslopnynotes.pronote

import java.net.URI

/**
 * Une pièce jointe ne se télécharge QUE sur l'origine de l'établissement (I1).
 *
 * `type == 0` est un LIEN publié par l'enseignant, pas un fichier : le suivre
 * enverrait la session de l'élève à un hôte tiers. Toute `ref` hors origine
 * (`file:`, `data:`, `//hôte`, port ou schéma différent, identifiants dans
 * l'autorité) est refusée avant le premier paquet.
 */
internal object AttachmentUrl {
    fun fetchable(rootSite: String, type: Double, url: String): String {
        if (type == 0.0) throw AttachmentRefused("lien non telechargeable")
        val school = originOf(rootSite) ?: throw AttachmentRefused("origine de l'etablissement illisible")
        val target = originOf(url) ?: throw AttachmentRefused("adresse de piece jointe refusee")
        if (target != school) throw AttachmentRefused("piece jointe hors etablissement")
        return url
    }

    /** Même origine (schéma, hôte, port effectif) : la seule redirection suivie. */
    internal fun sameOrigin(from: String, to: String): Boolean {
        val left = originOf(from) ?: return false
        val right = originOf(to) ?: return false
        return left == right
    }

    private data class Origin(val scheme: String, val host: String, val port: Int)

    private fun originOf(raw: String): Origin? {
        val uri = try {
            URI(raw)
        } catch (_: Exception) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.lowercase()?.trimEnd('.') ?: return null
        if (host.isEmpty()) return null
        // `https://etablissement@attaquant` : l'hôte est l'attaquant, mais une
        // autorité qui porte des identifiants n'a aucune raison d'être ici.
        if (uri.rawUserInfo != null) return null
        val port = if (uri.port == -1) {
            if (scheme == "https") 443 else 80
        } else {
            uri.port
        }
        return Origin(scheme, host, port)
    }
}
