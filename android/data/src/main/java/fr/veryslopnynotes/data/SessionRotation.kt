package fr.veryslopnynotes.data

/**
 * Persiste le jeton d'une session DÉJÀ appairée, sous le verrou de session.
 *
 * L'identité attendue est celle du client qui a tourné le jeton : après une
 * déconnexion ou une bascule de compte, le store ne contient plus cette
 * session et rien n'est écrit (`EpochRefused`). L'issue est rendue, jamais
 * avalée : un `commit()` refusé ne peut pas passer pour un disque à jour.
 */
fun saveRotatedToken(
    sessions: SessionStore,
    expected: AccountIdentity,
    token: String,
): WriteResult = SessionGate.serialized {
    if (token.isEmpty() || token.length > SessionCompleteness.MAX_SECRET_CHARS) {
        return@serialized WriteResult.Refused("jeton invalide")
    }
    val stored = try {
        sessions.load()
    } catch (_: Exception) {
        return@serialized WriteResult.Failed("session illisible")
    } ?: return@serialized WriteResult.Refused("session absente")
    val actual = AccountIdentity.of(stored.endpointUrl, stored.username)
    if (actual == null || !actual.sameAccount(expected)) {
        return@serialized WriteResult.EpochRefused
    }
    if (stored.password == token) return@serialized WriteResult.Written
    try {
        sessions.save(stored.withToken(token))
    } catch (_: Exception) {
        WriteResult.Failed("session non enregistrée")
    }
}

/**
 * Vrai si le dernier jeton tourné n'a pas atteint le disque. Un refresh peut
 * arriver hors de tout appel : l'état est publié par le pont au statut suivant.
 */
object RotatedTokenWrite {
    @Volatile
    private var failed = false

    fun report(result: WriteResult) {
        failed = !result.ok
    }

    fun failed(): Boolean = failed

    fun reset() {
        failed = false
    }
}
