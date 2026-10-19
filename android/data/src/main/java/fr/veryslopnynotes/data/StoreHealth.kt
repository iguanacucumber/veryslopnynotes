package fr.veryslopnynotes.data

/**
 * Santé du stockage CHIFFRÉ du process (#401).
 *
 * Le Keystore peut être indisponible (écran de verrouillage changé, appareil
 * verrouillé depuis le démarrage) : le repli MÉMOIRE garde le secret HORS du
 * disque — c'est le bon choix — mais il fait PERDRE la session et la clé de
 * l'assistant au prochain redémarrage. Avant, l'échec était SILENCIEUX :
 * l'app croyait ne pas être appairée, la clé disparaissait sans un mot.
 *
 * Ici : la DÉCISION (pure, testée) et l'ÉTAT du process. Le `catch` du
 * Keystore — qui a besoin du SDK — appelle [SecureStorage.markUnavailable] ;
 * le pont publie l'état, l'interface l'affiche.
 * ponytail: un enum et un drapeau, pas un tableau de bord de santé.
 */
enum class StoreHealth {
    /** Le Keystore répond : le secret est chiffré au repos. */
    AVAILABLE,

    /** Le Keystore a échoué : repli mémoire, dégradation SIGNALÉE. */
    UNAVAILABLE,
}

/**
 * DÉCISION pure : que vaut l'état du stockage après l'appel au Keystore ?
 *
 * `false` -> [StoreHealth.UNAVAILABLE] : le repli mémoire est assumé (jamais
 * un secret en clair), mais il est PUBLIÉ (état + journal), jamais un silence.
 */
fun storeHealth(keystoreAvailable: Boolean): StoreHealth =
    if (keystoreAvailable) StoreHealth.AVAILABLE else StoreHealth.UNAVAILABLE

/**
 * L'état du stockage chiffré du PROCESS.
 *
 * Un seul drapeau : la session et la clé de l'assistant partagent la même
 * MasterKey, donc un Keystore mort les frappe ensemble. Le repli mémoire
 * reste la règle (jamais un secret en clair) ; ce qui change, c'est que
 * l'échec est DIT — un état publié, pas une exception avalée.
 */
object SecureStorage {
    @Volatile
    private var state: StoreHealth = StoreHealth.AVAILABLE

    /** L'état courant du stockage chiffré. */
    fun health(): StoreHealth = state

    /** L'échec du Keystore est SIGNALÉ : l'état passe à dégradé. */
    fun markUnavailable() {
        state = storeHealth(keystoreAvailable = false)
    }
}
