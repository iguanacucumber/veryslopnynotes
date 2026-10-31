package fr.veryslopnynotes.app

// Fichier PUR (aucun import Android) : le harnais de parité l'exécute.

interface BridgeEarlySink {
    /** Rejet borné : code de `web/src/bridge/types.ts`, message français. */
    fun reject(requestId: String, code: String, message: String)

    fun resolveOk(requestId: String)

    fun cancel(requestId: String, paramsJson: String)
}

/** Identifiant d'appel accepté par le pont (miroir de `web/src/bridge/client.ts`). */
fun validBridgeId(id: String): Boolean =
    id.length in 1..64 && id.all { it.isLetterOrDigit() || it == '_' || it == '-' }

const val MAX_METHOD_CHARS = 64
const val MAX_PARAMS_CHARS = 256 * 1024

const val CANCEL_METHOD = "bridge.cancel"

/** Miroir exact de `web/src/bridge/types.ts`. Aucun autre nom n'entre. */
val BRIDGE_METHODS = setOf(
    "app.ready", "app.theme", "app.setTheme", "app.back",
    "session.status", "session.restore", "session.logout", "session.accounts",
    "pairing.scanQr", "pairing.pair", "pairing.pairDemo", "pairing.cancel",
    "resources.cached", "resources.load", "resources.invalidate", "resources.sync",
    "capabilities.load", "capabilities.refresh",
    "news.item",
    "assignments.toggle", "assignments.attachment",
    "messages.list", "messages.thread", "messages.reply", "messages.create",
    "messages.setRead", "messages.delete", "messages.recipients",
    "settings.get", "settings.saveServer", "settings.subjectPrefs", "settings.saveSubject",
    "settings.saveManualUrl", "settings.dismissManualPrompt",
    "lessons.list", "lessons.load", "lessons.save", "lessons.delete", "lessons.setManual",
    "lessons.addPhoto",
    "llm.status", "llm.saveKey", "llm.forgetKey", "llm.askHomework",
    "llm.solvePhoto", "llm.generateRevision", "llm.teacherTurn",
    "exercises.propose", "exercises.help",
    "teacher.load", "teacher.save", "teacher.delete",
    "revision.list", "revision.load", "revision.exportPdf",
    "profile.me", "profile.photo",
    "bridge.cancel",
)

/**
 * true = le sink a déjà répondu ; false = un fil répondra.
 * Aucune branche ne sort sans réponse : une promesse JS non répondue pend à
 * jamais (`pairing.scanQr` a un délai JS de 0).
 */
fun handleBridgeEarly(
    requestId: String,
    method: String,
    paramsJson: String,
    bridgeClosed: Boolean,
    sink: BridgeEarlySink,
): Boolean = when {
    !validBridgeId(requestId) -> {
        sink.reject(requestId, "bad_request", "Identifiant d'appel invalide.")
        true
    }
    method.length > MAX_METHOD_CHARS || method !in BRIDGE_METHODS -> {
        sink.reject(requestId, "bad_request", "Méthode inconnue.")
        true
    }
    paramsJson.length > MAX_PARAMS_CHARS -> {
        sink.reject(requestId, "bad_request", "Requête trop volumineuse.")
        true
    }
    method == CANCEL_METHOD -> {
        sink.cancel(requestId, paramsJson)
        sink.resolveOk(requestId)
        true
    }
    bridgeClosed -> {
        sink.reject(requestId, "unavailable", "Pont fermé.")
        true
    }
    else -> false
}
