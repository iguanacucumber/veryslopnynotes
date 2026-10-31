package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.ExpiredObject
import fr.veryslopnynotes.pronote.MFAError
import fr.veryslopnynotes.pronote.PronoteAPIError
import fr.veryslopnynotes.pronote.RateLimitedError

/**
 * Échec de session : l'app doit se ré-appairer, pas afficher un état vide.
 *
 * Fichier pur, compilé et EXÉCUTÉ par le harnais de parité (hors Gradle).
 *
 * LA DÉCISION TRANCHE PAR TYPE ET PAR CODE `G` — JAMAIS PAR UN MOT DU MESSAGE.
 * Le message est en partie écrit par l'ÉTABLISSEMENT : un mot suffisait à
 * détruire la session ET tout le cache hors ligne, et à renvoyer l'élève vers
 * l'appairage. Le `G` et le TYPE portent l'information ; le texte, le récit.
 */
internal fun isSessionFailure(e: Throwable): Boolean {
    // G=22 (« objet d'une session précédente ») n'est PAS une session morte :
    // son message contient « session », c'est le TYPE qui tranche.
    if (e is ExpiredObject) return false
    // Vérification que l'app ne sait pas faire (un PIN) : la session ne rouvrira pas.
    if (e is MFAError) return true
    // Hors erreur de PRONOTE (enveloppe illisible, réseau, parsing) : on
    // RÉESSAIE. Le cache reste — mieux vaut une donnée périmée qu'un cache vidé.
    if (e !is PronoteAPIError) return false
    // G=10 = la session MORTE ; G=22 (objet périmé) et G=25 (rate-limit) non.
    if (e.pronoteErrorCode == G_SESSION_EXPIRED) return true
    // 401 : jeton plus accepté. C'est le STATUT HTTP, pas un mot du message.
    return e.httpStatus == HTTP_UNAUTHORIZED
}

/** `G=10` : l'établissement dit que la session est expirée et n'a pas pu la rouvrir. */
private const val G_SESSION_EXPIRED = 10

/**
 * La lecture en cours doit REMONTER telle quelle, jamais être avalée en
 * « donnée absente » : une session morte n'est pas un trimestre vide, et un
 * rate-limit publié comme payload vide serait écrit dans le cache puis servi
 * pendant des heures.
 */
internal fun mustPropagateReadFailure(e: Throwable): Boolean =
    isSessionFailure(e) || e is RateLimitedError

private const val HTTP_UNAUTHORIZED = 401
