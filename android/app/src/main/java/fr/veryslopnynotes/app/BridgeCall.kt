package fr.veryslopnynotes.app

/**
 * Admission d'un appel du pont, décidée AVANT tout fil (#539).
 *
 * `runCall` traversait ces refus en tête de fonction ; ils vivent ici, en
 * Kotlin PUR, pour que le harnais de parité les EXÉCUTE (aucun parseur de
 * source, donc un reformatage de `VsnBridge.kt` ne casse plus le gate).
 *
 * La règle : toute entrée du pont répond EXACTEMENT une fois. Un identifiant
 * mal formé et un pont fermé (WebView détruite) sont REFUSÉS — jamais ignorés,
 * sinon la promesse JS pend, pour TOUJOURS sur `pairing.scanQr` dont le délai
 * JS est 0. L'abandon (`bridge.cancel`) est traité ici, hors file.
 *
 * Fichier PUR (aucun import Android) : il se compile seul.
 */

/** Les effets de réponse d'un appel précoce, injectés pour être exécutés hors Android. */
interface BridgeEarlySink {
    /** Rejet borné : code de `web/src/bridge/types.ts`, message français. */
    fun reject(requestId: String, code: String, message: String)

    /** Résolution immédiate `{ok:true}` (abandon d'appel). */
    fun resolveOk(requestId: String)

    /** Marque l'appel visé par `bridge.cancel` (best-effort). */
    fun cancel(requestId: String, paramsJson: String)
}

/** Identifiant d'appel accepté par le pont (miroir de `web/src/bridge/client.ts`). */
fun validBridgeId(id: String): Boolean =
    id.length in 1..64 && id.all { it.isLetterOrDigit() || it == '_' || it == '-' }

const val MAX_METHOD_CHARS = 64
const val MAX_PARAMS_CHARS = 256 * 1024

/** Méthode d'abandon d'un appel (allowlistée, comme toute autre). */
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
    "teacher.load", "teacher.save", "teacher.delete",
    "revision.list", "revision.load", "revision.exportPdf",
    "profile.me", "profile.photo",
    "bridge.cancel",
)

/**
 * Décide le sort d'un appel AVANT tout fil. Renvoie true si le pont a DÉJÀ
 * répondu (le sink a reçu exactement une réponse) ; false = l'appel part sur
 * un fil, qui répondra.
 *
 * Aucune branche ne sort sans réponse : c'est la règle #539, exécutée par
 * `tests/unit/android-bridge-call.test.ts`.
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
