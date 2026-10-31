package fr.veryslopnynotes.pronote

/**
 * Compte partagé publié par l'éditeur, sans donnée personnelle : la porte
 * d'entrée « je veux voir l'app ». Ce ne sont pas des identifiants utilisateur.
 *
 * I1 : cet hôte n'existe que dans CE module, le seul qui parle à
 * l'établissement ; `data` ne connaît que le TYPE de ce module.
 *
 * Session ouverte par IDENTIFIANT (le compte démo n'a pas d'app mobile
 * appairée) : mot de passe du compte public, pas un PIN d'appairage.
 */
object DemoSchool {
    const val URL = "https://demo.index-education.net/pronote/eleve.html"

    const val LOGIN = "demonstration"

    const val PASSWORD = "pronotevs"

    /** Bloquant : réseau. */
    fun login(): Client = Client.login(URL, LOGIN, PASSWORD)
}
