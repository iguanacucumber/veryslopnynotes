package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.ExpiredObject
import fr.veryslopnynotes.pronote.MFAError
import fr.veryslopnynotes.pronote.PronoteAPIError
import fr.veryslopnynotes.pronote.RateLimitedError

/**
 * Échec de session : l'app doit se ré-appairer, pas afficher un état vide.
 *
 * Déplacé de `PronotePayloads.kt` (#403) : la décision du job de fond s'en
 * sert, et elle est COMPILED ET EXÉCUTÉE par le harnais de parité — un
 * fichier pur, donc compilable hors Gradle (le reste de `data` ne l'est pas :
 * il lit `org.json`).
 *
 * LA DÉCISION TRANCHE PAR TYPE ET PAR CODE `G` — JAMAIS PAR UN MOT DU
 * MESSAGE (#520). Le message d'une erreur de PRONOTE est en partie ÉCRIT par
 * l'ÉTABLISSEMENT (`Erreur.Titre`) : « Confirmation de connexion requise »,
 * « Erreur de session »… un mot suffisait à détruire la session ET tout le
 * cache hors ligne (notes, devoirs, absences, sanctions, messagerie, fiches,
 * préférences) et à renvoyer l'élève vers l'appairage. Le `G` et le TYPE de
 * l'exception portent l'information ; le texte ne porte que le récit.
 */
internal fun isSessionFailure(e: Throwable): Boolean {
    // G=22 (« l'objet vient d'une session précédente ») n'est PAS une session
    // morte : c'est un objet PÉRIMÉ (une période, un devoir d'avant). Son
    // message contient le mot « session » : c'est le TYPE qui tranche, jamais
    // lui (#485, #520).
    if (e is ExpiredObject) return false
    // Le compte exige une vérification que l'app ne sait pas faire (un PIN) :
    // la session ne rouvrira pas. TYPE, pas motif.
    if (e is MFAError) return true
    // Hors erreur de PRONOTE (une enveloppe illisible, une panne réseau, un
    // `ParsingError`) : on RÉESSAIE. Le cache reste — mieux vaut une donnée
    // périmée qu'un cache vidé.
    if (e !is PronoteAPIError) return false
    // G=10 : « Session has expired and pronotets was not able to
    // reinitialise the connection. » — le code de la session MORTE.
    // G=22 (objet périmé) et G=25 (rate-limit) n'en sont pas : le premier
    // est traité par TYPE, le second n'est pas un logout.
    if (e.pronoteErrorCode == G_SESSION_EXPIRED) return true
    // 401 : le jeton n'est plus accepté par l'établissement. C'est le STATUT
    // HTTP qui le dit (un champ de l'erreur), pas un mot du message.
    return e.httpStatus == HTTP_UNAUTHORIZED
}

/** `G=10` : l'établissement dit que la session est expirée et n'a pas pu la rouvrir. */
private const val G_SESSION_EXPIRED = 10

/**
 * La lecture en cours doit REMONTER telle quelle, jamais être avalée en
 * « donnée absente » par les lectures tolérantes de `PronotePayloads`.
 *
 * Une session morte (`isSessionFailure`) n'est pas un trimestre vide. Et une
 * limitation de débit ([RateLimitedError]) non plus : la publier comme un
 * payload vide ferait écrire ce vide dans le cache, qui serait ensuite servi
 * pendant des heures — alors que la seule bonne réaction est d'attendre la fin
 * de la fenêtre de calme et de relire.
 */
internal fun mustPropagateReadFailure(e: Throwable): Boolean =
    isSessionFailure(e) || e is RateLimitedError

/** HTTP 401 : le jeton n'est plus accepté par l'établissement. */
private const val HTTP_UNAUTHORIZED = 401
