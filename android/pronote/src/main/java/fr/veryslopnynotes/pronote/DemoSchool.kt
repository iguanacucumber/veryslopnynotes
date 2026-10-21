package fr.veryslopnynotes.pronote

/**
 * Établissement de DÉMONSTRATION public de l'éditeur.
 *
 * Un compte partagé, publié par l'éditeur lui-même, sans donnée personnelle :
 * c'est la porte d'entrée « je veux voir l'app » sans établissement. Le compte
 * de démonstration est PUBLIC (identifiant et mot de passe affichés par
 * l'éditeur sur son site de démonstration) — ce ne sont pas des identifiants
 * de l'utilisateur, et ils ne sont jamais des données de session.
 *
 * I1 : cet hôte n'existe que dans CE module, le seul qui parle à
 * l'établissement. Le web n'a qu'un bouton (« Connexion démo ») et le pont
 * natif fait le reste ; `data` ne connaît que le TYPE de ce module.
 *
 * La session de démonstration s'ouvre par IDENTIFIANT (et non par jeton) :
 * le compte de démonstration n'a pas d'application mobile appairée. Le mot de
 * passe est donc celui du compte public, pas un PIN d'appairage.
 */
object DemoSchool {
    /** Espace élève du site de démonstration de l'éditeur. */
    const val URL = "https://demo.index-education.net/pronote/eleve.html"

    /** Identifiant public du compte de démonstration. */
    const val LOGIN = "demonstration"

    /** Mot de passe public du compte de démonstration. */
    const val PASSWORD = "pronotevs"

    /** Session ouverte sur le compte de démonstration (bloquant : réseau). */
    fun login(): Client = Client.login(URL, LOGIN, PASSWORD)
}
