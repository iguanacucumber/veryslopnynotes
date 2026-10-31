package fr.veryslopnynotes.data

/**
 * Santé du stockage CHIFFRÉ du process.
 *
 * Le Keystore peut être indisponible : le repli MÉMOIRE garde le secret hors du
 * disque, mais fait perdre la session et la clé de l'assistant au redémarrage.
 * L'échec était SILENCIEUX (l'app croyait ne pas être appairée) ; ici il est
 * DIT : décision pure et état du process, publiés par le pont.
 * ponytail: un enum et un drapeau, pas un tableau de bord de santé.
 */
enum class StoreHealth {
    AVAILABLE,

    UNAVAILABLE,
}

/**
 * DÉCISION pure : que vaut l'état du stockage après l'appel au Keystore ?
 * `false` -> [StoreHealth.UNAVAILABLE] : repli mémoire assumé, mais PUBLIÉ.
 */
fun storeHealth(keystoreAvailable: Boolean): StoreHealth =
    if (keystoreAvailable) StoreHealth.AVAILABLE else StoreHealth.UNAVAILABLE

/**
 * L'état du stockage chiffré du PROCESS : un seul drapeau, car la session et la
 * clé partagent la même MasterKey et un Keystore mort les frappe ensemble. Le
 * repli mémoire reste la règle, mais l'échec est un état publié.
 */
object SecureStorage {
    @Volatile
    private var state: StoreHealth = StoreHealth.AVAILABLE

    fun health(): StoreHealth = state

    fun markUnavailable() {
        state = storeHealth(keystoreAvailable = false)
    }
}
