package fr.veryslopnynotes.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import fr.veryslopnynotes.core.AiError
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.core.CapabilitiesJson
import fr.veryslopnynotes.core.ChildAccount
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.core.ExamCandidate
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.core.OutputTooLongException
import fr.veryslopnynotes.core.RevisionChunk
import fr.veryslopnynotes.core.RevisionExam
import fr.veryslopnynotes.core.RevisionFailure
import fr.veryslopnynotes.core.RevisionKv
import fr.veryslopnynotes.core.RevisionPdf
import fr.veryslopnynotes.core.RevisionSheet
import fr.veryslopnynotes.core.RevisionAi
import fr.veryslopnynotes.core.SecretDetectedException
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.core.assembleRevisionSheet
import fr.veryslopnynotes.core.listRevisionSheets
import fr.veryslopnynotes.core.loadRevisionSheet
import fr.veryslopnynotes.core.revisionFailureMessage
import fr.veryslopnynotes.core.saveRevisionSheet
import fr.veryslopnynotes.core.secretRefusalMessage
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.AssignmentsRepository
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.DeviceAuth
import fr.veryslopnynotes.data.DiscussionsRepository
import fr.veryslopnynotes.data.DiscussionWriteOutcome
import fr.veryslopnynotes.data.DownloadedFiles
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.FileRevisionStore
import fr.veryslopnynotes.data.FileSubjectPrefsStore
import fr.veryslopnynotes.data.InMemoryCacheStore
import fr.veryslopnynotes.data.InMemorySubjectPrefsStore
import fr.veryslopnynotes.data.LlmError
import fr.veryslopnynotes.data.LlmKeys
import fr.veryslopnynotes.data.LocalDataStore
import fr.veryslopnynotes.data.MeResult
import fr.veryslopnynotes.data.OpenRouterHomework
import fr.veryslopnynotes.data.OpenRouterLlm
import fr.veryslopnynotes.data.PairingInput
import fr.veryslopnynotes.data.PairingRepository
import fr.veryslopnynotes.data.PairingResult
import fr.veryslopnynotes.data.PhotoState
import fr.veryslopnynotes.data.ProfileRepository
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.RestoreResult
import fr.veryslopnynotes.data.SchoolQr
import fr.veryslopnynotes.data.SecureStorage
import fr.veryslopnynotes.data.ServerStore
import fr.veryslopnynotes.data.SessionEpoch
import fr.veryslopnynotes.data.SessionStores
import fr.veryslopnynotes.data.StoreHealth
import fr.veryslopnynotes.data.SubjectPrefInput
import fr.veryslopnynotes.data.SubjectPrefRules
import fr.veryslopnynotes.data.SubjectPrefs
import fr.veryslopnynotes.data.SubjectPrefsRepository
import fr.veryslopnynotes.data.SubjectPrefsWrite
import fr.veryslopnynotes.data.SyncedRepository
import fr.veryslopnynotes.data.parseSchoolQr
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Pont natif de la WebView (#333). Une SEULE interface exposée : [call].
 * Le JS n'a ni fetch ni proxy : chaque méthode est allowlistée (miroir exact
 * de `web/src/bridge/types.ts`) et lue sur les dépôts existants.
 *
 * L'abandon d'un appel passe par la méthode allowlistée `bridge.cancel` :
 * pas de seconde interface exposée au JS (I10), et l'annulation reste
 * best-effort (le JS a déjà lâché la promesse).
 *
 * Fils : un fil par appel et une file LLM à part (`BridgeExecutors`, #393) —
 * le pont ne fait JAMAIS la queue, donc le bouton retour répond même quand
 * l'accueil charge cinq ressources.
 *
 * Secrets : la session Pronote (SessionStore) et la clé LLM (LlmKeys) ne
 * sortent JAMAIS d'ici. Aucun paramètre n'est journalisé (QR, PIN, corps).
 * Tout échec — jusqu'à l'`Error` — devient `{code,message}` borné, jamais un
 * message brut : le pont ne laisse JAMAIS une promesse sans réponse (#394).
 */
class VsnBridge(
    private val activity: ComponentActivity,
    private val webView: WebView,
) {
    private val ctx: Context = activity.applicationContext
    private val main = Handler(Looper.getMainLooper())
    // #393 : un fil par appel (le pont ne fait JAMAIS la queue : `app.back`
    // répond même avec cinq lectures et deux appels LLM en vol) et une file
    // LLM à part (les opérations longues ne gèlent plus le pont).
    private val executors = BridgeExecutors()
    private val cancelled: MutableSet<String> =
        Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    /** Appels acceptés et pas encore terminés : un abandon ne vise que ceux-là. */
    private val inFlight: MutableSet<String> =
        Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

    // Mêmes objets que `AppNav` : une seule session chiffrée, un seul cache.
    private val baseUrlSeed: String = fr.veryslopnynotes.core.ServerConfig.baseUrl(
        BuildConfig.SERVER_SCHEME,
        BuildConfig.SERVER_HOST,
    )
    private val serverStore = ServerStore(ctx)
    // #540 : le store englobe le CACHE (`cacheDir/attachments/`,
    // `cacheDir/exports/`) : une purge de compte efface les pièces jointes
    // téléchargées comme le cache, sans chemin de purge qui en oublie.
    private val cacheStore = try {
        LocalDataStore(FileCacheStore(File(ctx.filesDir, "offline")), ctx.cacheDir)
    } catch (_: Exception) {
        InMemoryCacheStore()
    }
    private val sessions = SessionStores.get(ctx)
    private val repo = SyncedRepository(cacheStore)
    private val assignments = AssignmentsRepository(cacheStore)
    private val discussions = DiscussionsRepository(cacheStore)
    private val profileRepo = ProfileRepository()
    private val accounts = AccountStore(ctx, cacheStore, sessions)
    private val llmKeys = LlmKeys.get(ctx)

    // #401 : l'échec du Keystore est DIT, ici (le pont), pas dans les stores :
    // le store tient le secret, la règle du dépôt est « jamais de log à côté
    // d'un secret ». Le journal ne porte QUE l'état — ni clé, ni jeton, ni
    // chemin, ni hôte. L'interface, elle, affiche le message à l'utilisateur.
    init {
        if (SecureStorage.health() == StoreHealth.UNAVAILABLE) {
            Log.w(TAG, "Stockage chiffré indisponible : les identifiants vivent en mémoire, ils ne sont pas conservés.")
        }
        // #397 : le signal « session morte » a enfin un ABONNÉ — l'app. Il
        // répare par le chemin EXISTANT (`accounts.logout()` : session
        // invalidée ET cache purgé) puis l'interface renvoie à l'appairage.
        // Avant, `reject()` ne purgeait rien : le natif gardait le jeton mort
        // et servait un cache périmé comme frais.
        // UN SEUL abonné : le job de fond NE s'abonne pas (il partage le
        // process : il remplacerait celui de l'app).
        DeviceAuth.setOnRejected { onSessionRejected() }
    }

    private val pairing = PairingRepository(sessions, cacheStore)
    private val prefsRepo = SubjectPrefsRepository(
        try {
            FileSubjectPrefsStore(File(ctx.filesDir, "offline/subject_prefs.json"))
        } catch (_: Exception) {
            InMemorySubjectPrefsStore()
        },
    )
    private val revisions: RevisionKv? = try {
        FileRevisionStore(File(File(ctx.filesDir, "offline"), "revisions"))
    } catch (_: Exception) {
        null
    }

    private val themePrefs = try {
        ctx.getSharedPreferences(THEME_PREFS, Context.MODE_PRIVATE)
    } catch (_: Exception) {
        null
    }

    private val restoreLock = Any()
    private val scanLock = Any()

    // Session reconstruite DANS CE PROCESS (restore ou appairage). Le dépôt
    // garde le client en mémoire ; `hasSession()` seul ne prouve pas qu'il
    // vit encore.
    @Volatile
    private var sessionReady = false

    @Volatile
    private var pendingScanId: String? = null

    private val scanLauncher = activity.registerForActivityResult(ScanContract()) { result ->
        val id = synchronized(scanLock) {
            val pending = pendingScanId
            pendingScanId = null
            pending
        } ?: return@registerForActivityResult
        // #394 : le scan n'a PAS de délai JS (0 s) : une exception ici
        // laisserait la promesse PENDANTE pour toujours. Toute cause — un
        // `Error` compris — devient donc un rejet.
        try {
            val raw = result.contents
            if (raw.isNullOrBlank()) {
                resolve(id, JSONObject().put("qr", JSONObject.NULL).put("cancelled", true))
                return@registerForActivityResult
            }
            val qr = parseSchoolQr(raw)
            if (qr == null) {
                reject(id, "bad_request", "QR illisible : rescanez le code de l'établissement.")
            } else {
                resolve(
                    id,
                    JSONObject()
                        .put("cancelled", false)
                        .put(
                            "qr",
                            JSONObject()
                                .put("login", qr.login)
                                .put("jeton", qr.jeton)
                                .put("url", qr.url),
                        ),
                )
            }
        } catch (_: Throwable) {
            reject(id, "unknown", "Erreur native.")
        }
    }

    /** Appel unique depuis le JS. Retour immédiat : le travail part en fond. */
    @JavascriptInterface
    fun call(requestId: String, method: String, paramsJson: String) {
        try {
            runCall(requestId, method, paramsJson)
        } catch (_: Throwable) {
            // #394 : une exception ici laisserait la promesse JS PENDANTE
            // (le pont n'a pas répondu du tout). Tout devient un rejet.
            reject(requestId, "unknown", "Erreur native.")
        }
    }

    private fun runCall(requestId: String, method: String, paramsJson: String) {
        if (!validId(requestId)) {
            // #539 : la réponse ne manque JAMAIS (I10). Un identifiant mal
            // formé était IGNORÉ : la promesse pendait (pour `pairing.scanQr`,
            // dont le délai JS est 0, elle pendait POUR TOUJOURS). On le
            // refuse donc — l'identifiant est renvoyé TEL QUEL, sinon le JS
            // ne retrouverait pas sa promesse.
            reject(requestId, "bad_request", "Identifiant d'appel invalide.")
            return
        }
        if (method.length > MAX_METHOD_CHARS || method !in METHODS) {
            reject(requestId, "bad_request", "Méthode inconnue.")
            return
        }
        if (paramsJson.length > MAX_PARAMS_CHARS) {
            reject(requestId, "bad_request", "Requête trop volumineuse.")
            return
        }
        cancelled.remove(requestId)
        // Annulation : traitée ICI, jamais dans la file. C'est un signal
        // d'arrêt : il ne doit pas attendre le tour des appels en cours.
        if (method == CANCEL_METHOD) {
            cancelRequest(paramsJson)
            resolve(requestId, JSONObject().put("ok", true))
            return
        }
        if (executors.isShutdown) {
            // #539 : pont fermé (WebView détruite) — l'appel tardif reçoit un
            // REJET borné, pas le silence : une promesse pendrait pour toujours
            // sur une méthode sans délai JS.
            reject(requestId, "unavailable", "Pont fermé.")
            return
        }
        inFlight.add(requestId)
        // #404 : l'époque de session est capturée À L'ARRIVÉE de l'appel, pas
        // à son exécution : le travail part sur un autre fil, donc une écriture
        // demandée AVANT la purge de déconnexion peut être exécutée APRÈS.
        // Capturée ici, elle perd la course d'époque et son écriture est
        // abandonnée — le répertoire purgé ne ressuscite pas.
        val epoch = SessionEpoch.current()
        // #393 : le LLM part sur SA file (bornée) : deux appels LLM simultanés
        // ne prennent plus les fils des appels ordinaires.
        executors.workerFor(method).execute {
            try {
                if (cancelled.contains(requestId)) return@execute
                // #394 : TOUT échec natif — un `Error` compris — devient un
                // REJET. Sans ce filet, l'`Error` tuait le fil du worker
                // SANS `resolve` ni `reject` : la promesse JS pendait (pour
                // `pairing.scanQr`, dont le délai JS est 0, elle pendait
                // POUR TOUJOURS : chargement infini, sans message).
                val failure = bridgeCallOutcome {
                    val params = try {
                        if (paramsJson.isBlank()) JSONObject() else JSONObject(paramsJson)
                    } catch (_: org.json.JSONException) {
                        throw BridgeFailure("bad_request", "Paramètres illisibles.")
                    }
                    // null = réponse différée (scan QR).
                    handle(requestId, method, params, epoch)?.let { resolve(requestId, it) }
                }
                // Jamais le message brut : il peut nommer un hôte ou un compte.
                if (failure != null) reject(requestId, failure.code, failure.message)
            } finally {
                inFlight.remove(requestId)
                cancelled.remove(requestId)
            }
        }
    }

    /**
     * Abandon JS (le JS a déjà lâché la promesse) : l'appel cible est marqué,
     * sa réponse native sera ignorée. Seuls les appels EN COURS sont visés
     * (un appel déjà terminé n'a plus rien à abandonner) : le jeu `cancelled`
     * ne grossit donc jamais.
     */
    private fun cancelRequest(paramsJson: String) {
        val target = try {
            JSONObject(paramsJson).optString("requestId", "")
        } catch (_: Throwable) {
            // org.json RÉCURSE : des `[` imbriqués font déborder la pile
            // (`StackOverflowError`, un `Error` : `Exception` ne le prendrait
            // pas). Un abandon malformé n'est qu'un abandon raté.
            ""
        }
        if (validId(target) && inFlight.contains(target)) cancelled.add(target)
    }

    /** Fin de vie de la WebView : aucun fil ne survit à la rotation. */
    fun close() {
        executors.shutdown()
    }

    private fun handle(requestId: String, method: String, p: JSONObject, epoch: Long): JSONObject? {
        // `bridge.cancel` n'arrive jamais ici : il est intercepté dans `call()`
        // (signal immédiat, hors file d'exécution).
        return when (method) {
            "app.ready" -> JSONObject().put("ok", true)
            "app.theme" -> JSONObject().put("theme", theme())
            "app.setTheme" -> setTheme(p)
            "app.back" -> back()
            "session.status" -> sessionStatus()
            "session.restore" -> restoreSession()
            "session.logout" -> logout()
            "session.accounts" -> JSONObject().put("count", accounts.count())
            "pairing.scanQr" -> {
                scanQr(requestId)
                null
            }
            "pairing.pair" -> pair(p)
            "pairing.cancel" -> cancelPairing()
            "resources.cached" -> resourceCached(p, epoch)
            "resources.load" -> resourceLoad(p)
            "resources.invalidate" -> resourceInvalidate(p)
            "resources.sync" -> resourceSync()
            "capabilities.load" -> capabilitiesJson(force = false)
            "capabilities.refresh" -> capabilitiesJson(force = true)
            "news.item" -> newsItem(p)
            "assignments.toggle" -> toggleAssignment(p)
            "assignments.attachment" -> openAttachment(p)
            "messages.list" -> messagesList()
            "messages.thread" -> messagesThread(p)
            "messages.reply" -> messagesReply(p)
            "messages.create" -> messagesCreate(p)
            "messages.setRead" -> messagesSetRead(p)
            "messages.delete" -> messagesDelete(p)
            "messages.recipients" -> messagesRecipients()
            "settings.get" -> settings()
            "settings.saveServer" -> saveServer(p)
            "settings.subjectPrefs" -> subjectPrefs()
            "settings.saveSubject" -> saveSubject(p, epoch)
            "llm.status" -> JSONObject().put("configured", llmKeys.isConfigured())
            "llm.saveKey" -> saveLlmKey(p)
            "llm.forgetKey" -> {
                llmKeys.clear()
                JSONObject().put("ok", true)
            }
            "llm.askHomework" -> askHomework(p)
            "llm.generateRevision" -> generateRevision(p, epoch)
            "revision.list" -> revisionList()
            "revision.load" -> revisionLoad(p)
            "revision.exportPdf" -> revisionExportPdf(p)
            "profile.me" -> profileMe()
            "profile.photo" -> profilePhoto()
            else -> throw BridgeFailure("bad_request", "Méthode inconnue.")
        }
    }

    // --- Application / session -------------------------------------------------

    private fun theme(): String = when (themePrefs?.getString(THEME_KEY, null)) {
        "LIGHT" -> "LIGHT"
        "DARK" -> "DARK"
        else -> "SYSTEM"
    }

    private fun setTheme(p: JSONObject): JSONObject {
        val next = p.string("theme")
        if (next !in setOf("SYSTEM", "LIGHT", "DARK")) {
            throw BridgeFailure("bad_request", "Thème inconnu.")
        }
        themePrefs?.edit()?.putString(THEME_KEY, next)?.apply()
        return JSONObject().put("ok", true)
    }

    private fun back(): JSONObject {
        activity.runOnUiThread {
            if (webView.canGoBack()) webView.goBack() else activity.finish()
        }
        return JSONObject().put("handled", true)
    }

    private fun sessionStatus(): JSONObject {
        val state = when {
            sessionReady -> "restored"
            sessions.hasSession() -> "offline"
            else -> "no_session"
        }
        return JSONObject().put("state", state).put("storage", storageState())
    }

    private fun restoreSession(): JSONObject {
        val response = synchronized(restoreLock) {
            when (val result = pairing.restoreBlocking()) {
                RestoreResult.Restored -> {
                    sessionReady = true
                    JSONObject().put("state", "restored")
                }
                RestoreResult.NoSession -> JSONObject().put("state", "no_session")
                is RestoreResult.Dead ->
                    JSONObject().put("state", "dead").put("message", result.message)
                RestoreResult.Offline ->
                    JSONObject().put("state", "offline")
                        .put("message", "Réseau indisponible : session conservée.")
            }
        }
        // #401 : l'état du stockage chiffré est PUBLIE avec le statut de la
        // session : un Keystore mort est un état dégradé (repli mémoire), pas
        // un silence — l'interface doit pouvoir le dire à l'utilisateur.
        return response.put("storage", storageState())
    }

    /**
     * L'état du stockage chiffré, PUBLIE à l'interface (#401).
     *
     * `available` : le Keystore répond, les secrets sont chiffrés au repos.
     * `unavailable` : le Keystore a échoué, les secrets vivent en mémoire
     * (jamais en clair) et sont PERDUS au redémarrage — l'interface le dit.
     */
    private fun storageState(): String = SecureStorage.health().name.lowercase()

    private fun logout(): JSONObject {
        sessionReady = false
        accounts.logout()
        return JSONObject().put("ok", true)
    }

    /**
     * Session MORTE (jeton tourné par l'établissement) : la session ET le cache
     * sont purgés, par le chemin EXISTANT (`accounts.logout()` — la purge part
     * sous la garde d'époque, #364/#407).
     *
     * #397 : c'est ici que le signal étaitMUET. Sans cette purge, le natif
     * gardait le jeton mort et le cache continuaient d'être servi comme
     * frais — l'app affichait « session expirée » par-dessus des données
     * périmées.
     *
     * Le fil qui lève le signal est un fil de fond (dépôt, job de fond) : la
     * purge y est légitime (elle n'écrit pas sur l'UI). `sessionReady` tombe :
     * la session n'existe plus, `session.status` ne doit pas dire « restaurée ».
     */
    private fun onSessionRejected() {
        sessionReady = false
        accounts.logout()
    }

    // --- Appairage -------------------------------------------------------------

    private fun scanQr(requestId: String) {
        activity.runOnUiThread {
            synchronized(scanLock) {
                if (pendingScanId != null) {
                    reject(requestId, "unavailable", "Un scan est déjà en cours.")
                    return@runOnUiThread
                }
                pendingScanId = requestId
            }
            try {
                scanLauncher.launch(
                    ScanOptions().apply {
                        setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                        setPrompt("Scannez le QR de l'établissement")
                        setBeepEnabled(false)
                        setBarcodeImageEnabled(false)
                        setOrientationLocked(true)
                    },
                )
            } catch (_: Throwable) {
                // Même un `Error` : le scan n'a PAS de délai JS, une exception
                // qui s'échapperait laisserait la promesse PENDANTE (#394).
                synchronized(scanLock) { pendingScanId = null }
                reject(requestId, "unavailable", "Scan indisponible sur cet appareil.")
            }
        }
    }

    private fun pair(p: JSONObject): JSONObject {
        val qrObj = p.optJSONObject("qr")
            ?: throw BridgeFailure("bad_request", "QR et PIN requis.")
        val qr = SchoolQr(
            login = bounded(qrObj.string("login"), 1024),
            jeton = bounded(qrObj.string("jeton"), 1024),
            url = bounded(qrObj.string("url"), 300),
        )
        if (qr.login.isEmpty() || qr.jeton.isEmpty() || qr.url.isEmpty()) {
            throw BridgeFailure("bad_request", "QR et PIN requis.")
        }
        val pin = bounded(p.string("pin"), PairingRepository.PIN_MAX_CHARS)
        if (pin.isEmpty()) throw BridgeFailure("bad_request", "PIN requis.")
        // Même verrou que la restauration : un appairage et un restore
        // concurrents écriraient deux sessions dans le même store.
        val result = synchronized(restoreLock) {
            pairing.pairBlocking(PairingInput(qr = qr, pin = pin))
        }
        return when (result) {
            is PairingResult.Ok -> {
                sessionReady = true
                // #397 : le compte appairé est ENREGISTRÉ. Le magasin
                // multi-compte n'était jamais alimenté (rien n'écrivait
                // `account_ids` depuis la bascule Compose -> WebView) :
                // `current()` valait toujours `null` et le compte courant
                // n'était jamais connu. L'id est celui de la ressource client
                // (jamais le login, jamais le jeton). Le compte appairé
                // devient le compte COURANT : c'est lui que la relecture
                // (`resources.sync`) annonce.
                result.accountId?.let { accounts.add(it); accounts.select(it) }
                JSONObject().put("ok", true)
            }
            is PairingResult.Err -> JSONObject()
                .put("ok", false)
                .put("code", result.code)
                // Jamais le message de la couche `data` : il peut nommer l'hôte
                // de l'établissement (adresse interne, port) (#396). Le pont
                // choisit la phrase : bornée, sans hôte ni IP.
                .put("message", pairingFailureMessage(result.code))
        }
    }

    private fun cancelPairing(): JSONObject {
        val id = synchronized(scanLock) {
            val pending = pendingScanId
            pendingScanId = null
            pending
        }
        id?.let { resolve(it, JSONObject().put("qr", JSONObject.NULL).put("cancelled", true)) }
        return JSONObject().put("ok", true)
    }

    // --- Ressources ------------------------------------------------------------

    private fun resourceCached(p: JSONObject, epoch: Long): JSONObject {
        // #529 : la session a changé depuis l'ARRIVÉE de l'appel (le cache a
        // été purgé : déconnexion, session morte, OU bascule de compte). L'entrée
        // servie pourrait alors être celle d'un AUTRE compte — on ne sert rien.
        if (SessionEpoch.current() != epoch) return emptyCached()
        val key = p.string("key")
        val resource = cacheKey(key) ?: return emptyCached()
        // #477 : le cache est indexé par (ressource, requête) : l'entrée servie
        // est celle de la requête AFFICHÉE, pas celle d'une autre semaine.
        val query = bounded(p.string("query"), 200)
        val entry = repo.cached(resource, query) ?: return emptyCached()
        return JSONObject()
            .put("payload", entry.payload)
            .put("fetchedAt", entry.fetchedAt)
            .put("stale", repo.isStale(resource, entry))
            .put("error", JSONObject.NULL)
    }

    private fun emptyCached(): JSONObject = JSONObject()
        .put("payload", JSONObject.NULL)
        .put("fetchedAt", 0L)
        .put("stale", false)
        .put("error", JSONObject.NULL)

    private fun resourceLoad(p: JSONObject): JSONObject {
        val key = p.string("key")
        if (key == "profile") {
            return profileMe()
                .put("fetchedAt", System.currentTimeMillis())
                .put("stale", false)
        }
        if (key == "periods") {
            val outcome = await<RefreshOutcome> { cb ->
                repo.fetchPeriods(currentBaseUrl(), cb)
            } ?: throw BridgeFailure("unavailable", "Tranches indisponibles.")
            return resultJson(outcome, null)
        }
        val resource = cacheKey(key) ?: throw BridgeFailure("bad_request", "Ressource inconnue.")
        val query = bounded(p.string("query"), 200)
        val outcome = await<RefreshOutcome> { cb ->
            repo.refreshAsync(resource, currentBaseUrl(), query, p.optBoolean("force", false), cb)
        } ?: throw BridgeFailure("unavailable", "Lecture indisponible.")
        return resultJson(outcome, resource, query)
    }

    private fun resourceInvalidate(p: JSONObject): JSONObject {
        val resource = cacheKey(p.string("key"))
            ?: throw BridgeFailure("bad_request", "Ressource inconnue.")
        repo.invalidate(resource)
        return JSONObject().put("ok", true)
    }

    private fun resourceSync(): JSONObject {
        val outcome = await<RefreshOutcome> { cb ->
            repo.requestSyncRefresh(currentBaseUrl(), accounts.current().orEmpty(), cb)
        } ?: throw BridgeFailure("unavailable", "Relecture indisponible.")
        return resultJson(outcome, null)
    }

    private fun resultJson(outcome: RefreshOutcome, resource: String?, query: String = ""): JSONObject {
        val obj = JSONObject()
        when (outcome) {
            is RefreshOutcome.Updated -> obj
                .put("payload", outcome.payload)
                .put("fetchedAt", outcome.fetchedAt)
                .put("stale", false)
                .put("error", JSONObject.NULL)
            is RefreshOutcome.OfflineFallback -> obj
                .put("payload", outcome.payload)
                .put("fetchedAt", outcome.fetchedAt)
                .put("stale", outcome.stale)
                .put("error", "Données en cache (hors ligne).")
            is RefreshOutcome.Failed -> {
                sessionOrThrow(outcome.message)
                // #477 : l'entrée de cache servie est celle de la MÊME requête.
                val cached = resource?.let { repo.cached(it, query) }
                obj.put("payload", outcome.cachedPayload ?: JSONObject.NULL)
                    .put("fetchedAt", cached?.fetchedAt ?: 0L)
                    .put("stale", true)
                    .put("error", outcome.message)
            }
        }
        return obj
    }

    private fun capabilitiesJson(force: Boolean): JSONObject {
        val outcome = await<RefreshOutcome> { cb ->
            repo.refreshAsync(CachePolicy.CAPABILITIES, currentBaseUrl(), force = force, cb = cb)
        }
        if (outcome is RefreshOutcome.Failed) sessionOrThrow(outcome.message)
        val payload = when (outcome) {
            is RefreshOutcome.Updated -> outcome.payload
            is RefreshOutcome.OfflineFallback -> outcome.payload
            else -> null
        }
        // Capacités inconnues = rien n'est affirmé : liste complète.
        val tabs = CapabilitiesJson.parse(payload)?.tabs ?: Capabilities.TABS
        return JSONObject().put("tabs", JSONArray(tabs))
    }

    // --- Actualités -----------------------------------------------------------

    /**
     * Corps d'une actualité (#475) : lu À LA DEMANDE, au dépliage.
     *
     * La liste ne télécharge plus les corps (21 POST pour un écran dont
     * l'élève ne lit que 2-3 actus) : celui-ci arrive ici, à la demande, en
     * un POST. Le corps est une DONNÉE (texte brut), jamais du HTML (I6) : le
     * JS l'affiche dans un nœud texte.
     */
    private fun newsItem(p: JSONObject): JSONObject {
        val id = bounded(p.string("id"), 64)
        if (id.isEmpty()) throw BridgeFailure("bad_request", "Actualité introuvable.")
        val result = await<Pair<String?, String?>> { cb ->
            repo.fetchNewsBody(id) { body, error -> cb(body to error) }
        } ?: throw BridgeFailure("unavailable", "Actualité indisponible.")
        val (body, error) = result
        sessionOrThrow(error)
        // Un échec de lecture = un REJET borné : la carte affiche son état
        // (« Contenu indisponible. »), jamais une page d'erreur.
        if (error != null) throw BridgeFailure("unavailable", error)
        return JSONObject().put("body", body ?: "")
    }

    // --- Devoirs ---------------------------------------------------------------

    private fun toggleAssignment(p: JSONObject): JSONObject {
        val id = bounded(p.string("id"), 128)
        if (id.isEmpty()) throw BridgeFailure("bad_request", "Devoir introuvable.")
        val done = p.optBoolean("done", false)
        // #369 : la semaine AFFICHÉE (le `weekStart` de l'écran) : la fenêtre
        // de recherche suit le payload affiché, sinon le devoir est visible
        // mais « introuvable ».
        val week = bounded(p.string("weekStart"), 10)
        val outcome = await<fr.veryslopnynotes.data.ToggleOutcome> { cb ->
            assignments.toggle(currentBaseUrl(), id, done, week, cb)
        } ?: throw BridgeFailure("unavailable", "Bascule indisponible.")
        sessionOrThrow(outcome.error)
        return JSONObject()
            .put("ok", outcome.assignment != null)
            .apply { outcome.error?.let { put("error", it) } }
    }

    private fun openAttachment(p: JSONObject): JSONObject {
        val homeworkId = bounded(p.string("homeworkId"), 128)
        val attachmentId = bounded(p.string("attachmentId"), 128)
        if (homeworkId.isEmpty() || attachmentId.isEmpty()) {
            throw BridgeFailure("bad_request", "Pièce jointe introuvable.")
        }
        // Même semaine affichée que le toggle (#369).
        val week = bounded(p.string("weekStart"), 10)
        // #540 : l'époque est capturée AVANT le téléchargement : une pièce
        // jointe téléchargée pendant une déconnexion n'est pas écrite (le
        // cache purgé ne ressuscite pas).
        val epoch = SessionEpoch.current()
        val data = await<fr.veryslopnynotes.data.AttachmentData?> { cb ->
            assignments.fetchAttachment(homeworkId, attachmentId, week, cb)
        } ?: return JSONObject().put("ok", false).put("error", "Pièce jointe indisponible.")
        return try {
            val file = writeAttachmentFile(
                ctx,
                homeworkId,
                AssignmentAttachment(id = attachmentId, label = data.name, ref = ""),
                data.bytes,
                epoch,
            ) ?: return JSONObject().put("ok", false).put("error", "Pièce jointe indisponible.")
            openFile(file, mimeOf(data.name))
            JSONObject().put("ok", true)
        } catch (_: Exception) {
            JSONObject().put("ok", false).put("error", "Pièce jointe illisible.")
        }
    }

    // --- Messagerie ------------------------------------------------------------

    private fun messagesList(): JSONObject {
        val outcome = await<RefreshOutcome> { cb ->
            repo.refreshAsync(CachePolicy.DISCUSSIONS, currentBaseUrl(), force = false, cb = cb)
        }
        if (outcome is RefreshOutcome.Failed) sessionOrThrow(outcome.message)
        val payload = when (outcome) {
            is RefreshOutcome.Updated -> outcome.payload
            is RefreshOutcome.OfflineFallback -> outcome.payload
            is RefreshOutcome.Failed -> outcome.cachedPayload
            null -> null
        }
        return JSONObject().put("payload", payload ?: JSONObject.NULL)
    }

    private fun messagesThread(p: JSONObject): JSONObject {
        val id = bounded(p.string("id"), 64)
        if (id.isEmpty()) throw BridgeFailure("bad_request", "Fil introuvable.")
        val result = await<Pair<fr.veryslopnynotes.data.DiscussionThread?, String?>> { cb ->
            discussions.fetchMessages(id) { thread, error -> cb(thread to error) }
        } ?: throw BridgeFailure("unavailable", "Fil indisponible.")
        val (thread, error) = result
        sessionOrThrow(error)
        val arr = JSONArray()
        for (m in thread?.messages ?: emptyList()) {
            arr.put(
                JSONObject()
                    .put("id", m.id)
                    .put("discussionId", m.discussionId)
                    .put("authorName", m.authorName)
                    .put("body", m.body)
                    .put("sentAt", m.sentAt)
                    .put(
                        "attachments",
                        JSONArray().apply {
                            for (a in m.attachments) {
                                put(
                                    JSONObject()
                                        .put("id", a.id)
                                        .put("label", a.label)
                                        .put("ref", a.ref),
                                )
                            }
                        },
                    ),
            )
        }
        val obj = JSONObject()
            // #476 : les participants voyagent avec le fil ouvert (ils ne sont
            // plus téléchargés pour toute la liste).
            .put(
                "payload",
                JSONObject()
                    .put("messages", arr)
                    .put("participants", JSONArray(thread?.participants ?: emptyList<String>()))
                    .toString(),
            )
        error?.let { obj.put("error", it) }
        return obj
    }

    private fun messagesReply(p: JSONObject): JSONObject {
        val id = bounded(p.string("id"), 64)
        val body = bounded(p.string("body"), 4000)
        return writeOutcome { cb -> discussions.reply(currentBaseUrl(), id, body, cb) }
    }

    private fun messagesCreate(p: JSONObject): JSONObject {
        val ids = p.optJSONArray("recipients") ?: JSONArray()
        if (ids.length() > 8) throw BridgeFailure("bad_request", "Trop de destinataires.")
        val recipients = mutableListOf<String>()
        for (i in 0 until ids.length()) {
            val id = ids.optString(i, "").trim()
            if (id.isNotEmpty()) recipients.add(bounded(id, 64))
        }
        val subject = bounded(p.string("subject"), 200)
        val body = bounded(p.string("body"), 4000)
        return writeOutcome { cb ->
            discussions.create(currentBaseUrl(), subject, body, recipients, cb)
        }
    }

    private fun messagesSetRead(p: JSONObject): JSONObject {
        val id = bounded(p.string("id"), 64)
        val read = p.optBoolean("read", false)
        return writeOutcome { cb -> discussions.setRead(currentBaseUrl(), id, read, cb) }
    }

    private fun messagesDelete(p: JSONObject): JSONObject {
        val id = bounded(p.string("id"), 64)
        return writeOutcome { cb -> discussions.delete(currentBaseUrl(), id, cb) }
    }

    private fun writeOutcome(start: ((DiscussionWriteOutcome) -> Unit) -> Unit): JSONObject {
        val outcome = await<DiscussionWriteOutcome> { start(it) }
            ?: return JSONObject().put("ok", false).put("error", "Connexion indisponible.")
        sessionOrThrow(outcome.error)
        return JSONObject().put("ok", outcome.ok).apply {
            outcome.error?.let { put("error", it) }
        }
    }

    private fun messagesRecipients(): JSONObject {
        val result = await<Pair<List<DiscussionRecipient>, String?>> { cb ->
            discussions.fetchRecipients { list, error -> cb(list to error) }
        } ?: throw BridgeFailure("unavailable", "Destinataires indisponibles.")
        val (recipients, error) = result
        sessionOrThrow(error)
        val arr = JSONArray()
        for (r in recipients) {
            arr.put(
                JSONObject()
                    .put("id", r.id)
                    .put("displayName", r.displayName)
                    .put("kind", r.kind),
            )
        }
        val obj = JSONObject()
            .put("payload", JSONObject().put("recipients", arr).toString())
        error?.let { obj.put("error", it) }
        return obj
    }

    // --- Réglages --------------------------------------------------------------

    private fun settings(): JSONObject = JSONObject()
        .put("theme", theme())
        // Hôte seul, jamais une URL de session ni un jeton.
        .put("serverHost", currentBaseUrl().substringAfter("://").trimEnd('/').take(300))
        .put("llmConfigured", llmKeys.isConfigured())
        .put("accountCount", accounts.count())

    private fun saveServer(p: JSONObject): JSONObject {
        var host = bounded(p.string("host"), 300)
        if (!host.contains("://")) {
            val scheme = if (host.startsWith("localhost") || host.startsWith("10.0.2.2")) "http" else "https"
            host = "$scheme://$host"
        }
        return when (val result = serverStore.save(host)) {
            is fr.veryslopnynotes.core.ServerUrlResult.Ok ->
                JSONObject().put("ok", true)
            is fr.veryslopnynotes.core.ServerUrlResult.Rejected ->
                JSONObject().put("ok", false).put("message", result.message)
        }
    }

    private fun subjectPrefs(): JSONObject = JSONObject()
        .put("prefs", JSONArray().apply { putAllPrefs(prefsRepo.prefs()) })

    private fun saveSubject(p: JSONObject, epoch: Long): JSONObject {
        // #395 : lecture BORNÉE et validée par la MÊME règle que le dépôt
        // (`SubjectPrefRules`). Avant, le pont ne validait que le NOM : la
        // couleur, l'emoji et le libellé arrivaient bruts (jusqu'à 256 Ko),
        // le dépôt abandonnait l'écriture, et le pont répondait quand même
        // `ok` — l'interface affichait « enregistré » sans rien écrire.
        val input = SubjectPrefRules.read(
            subject = p.string("subject"),
            color = p.string("color"),
            emoji = p.string("emoji"),
            label = p.string("label"),
        )
        val valid = when (input) {
            // Refus HONNÊTE : rien n'est écrit, la phrase dit pourquoi.
            is SubjectPrefInput.Invalid -> return JSONObject()
                .put("ok", false)
                .put("message", subjectPrefIssueMessage(input.field))
            is SubjectPrefInput.Valid -> input
        }
        // #404 : l'écriture passe par la garde d'époque. Refusée = la session
        // a changé (déconnexion) depuis l'arrivée de l'appel : rien n'est
        // écrit, le répertoire purgé ne ressuscite pas.
        when (prefsRepo.upsert(valid.subject, valid.color, valid.emoji, valid.label, epoch)) {
            SubjectPrefsWrite.WRITTEN -> Unit
            // Le dépôt a refusé la matière (règle divergente ? garde-fou) :
            // JAMAIS « ok » — l'interface ne doit pas mentir sur l'écriture.
            SubjectPrefsWrite.INVALID -> return JSONObject()
                .put("ok", false)
                .put("message", "Matière refusée : corrige la couleur, l'emoji ou le libellé.")
            SubjectPrefsWrite.REFUSED -> throw BridgeFailure("bad_request", "Session modifiée : matière non enregistrée.")
        }
        return JSONObject().put("ok", true).put("prefs", JSONArray().apply { putAllPrefs(prefsRepo.prefs()) })
    }

    private fun JSONArray.putAllPrefs(prefs: List<SubjectPrefs>) {
        for (pref in prefs) {
            put(
                JSONObject()
                    .put("subject", pref.subject)
                    .put("color", pref.color ?: JSONObject.NULL)
                    .put("emoji", pref.emoji ?: JSONObject.NULL)
                    .put("label", pref.label ?: JSONObject.NULL),
            )
        }
    }

    // --- LLM -------------------------------------------------------------------

    private fun saveLlmKey(p: JSONObject): JSONObject {
        val key = p.string("key").trim()
        if (key.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
            return JSONObject().put("ok", false).put("message", "Clé LLM trop courte.")
        }
        if (key.length > fr.veryslopnynotes.core.Homework.MAX_API_KEY_CHARS) {
            return JSONObject().put("ok", false).put("message", "Clé LLM trop longue.")
        }
        if (key.any { it.isWhitespace() || it.isISOControl() }) {
            return JSONObject().put("ok", false).put("message", "Caractère interdit dans la clé.")
        }
        return try {
            llmKeys.save(key)
            JSONObject().put("ok", true)
        } catch (_: IllegalArgumentException) {
            JSONObject().put("ok", false).put("message", "Clé LLM refusée.")
        }
    }

    private fun askHomework(p: JSONObject): JSONObject {
        val id = bounded(p.string("assignmentId"), 128)
        if (id.isEmpty()) throw BridgeFailure("bad_request", "Devoir introuvable.")
        // #369 : la semaine AFFICHÉE : le devoir demandé peut venir d'une
        // semaine non courante (le cache ne porte que la dernière lue).
        val week = bounded(p.string("weekStart"), 10)
        val assignment = loadAssignments(id, week).firstOrNull { it.id == id }
            ?: return JSONObject().put("ok", false).put("message", "Devoir introuvable.")
        val sources = fr.veryslopnynotes.data.HomeworkRepository.sourcesFor(assignment)
        val question = fr.veryslopnynotes.data.HomeworkRepository.questionFor(assignment)
        val result = await<fr.veryslopnynotes.data.HomeworkResult>(AWAIT_LLM_MS) { cb ->
            OpenRouterHomework(OpenRouterLlm(), llmKeys).generate(question, sources, cb)
        } ?: return JSONObject().put("ok", false).put("message", "L'assistant n'a pas répondu.")
        val outcome = result.outcome
            ?: return JSONObject().put("ok", false)
                .put("message", result.error ?: OpenRouterHomework.GENERIC_ERROR_MESSAGE)
        return when (outcome) {
            is HomeworkOutcome.Answer -> JSONObject().put("ok", true).put("body", outcome.answer)
            // #416 : le motif du modèle est un texte LIBRE (echo de la consigne
            // possible) : il ne franchit JAMAIS le pont. Le pont rend une
            // phrase française bornée, dans le champ `message` que l'UI lit.
            is HomeworkOutcome.Refused -> JSONObject()
                .put("ok", true)
                .put("refused", true)
                .put("message", homeworkRefusalMessage(outcome.reason))
        }
    }

    /**
     * Fiche de révision locale : même pipeline validé que le reste de l'app
     * (`RevisionAi.requestRevisionFiche` + `assembleRevisionSheet`), clé lue à
     * l'appel, sortie contrôlée par core (I4/I5). Aucune donnée du devoir ne
     * sort de l'appareil ailleurs que dans ce prompt OpenRouter déclaré comme
     * donnée (I6).
     */
    private fun generateRevision(p: JSONObject, epoch: Long): JSONObject {
        val id = bounded(p.string("assignmentId"), 128)
        val store = revisions ?: throw BridgeFailure("unavailable", "Stockage des fiches indisponible.")
        val assignment = loadAssignments(id, "").firstOrNull { it.id == id }
            ?: return JSONObject().put("ok", false).put("message", "Devoir introuvable.")
        val apiKey = llmKeys.apiKey()?.trim()
            ?: return JSONObject().put("ok", false)
                .put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
        // Clé trop courte = refus AVANT l'appel : pas d'aller-retour inutile,
        // et un message qui dit la vraie cause (« clé absente »).
        if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
            return JSONObject().put("ok", false)
                .put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
        }
        val chunks = revisionChunks(assignment)
        if (chunks.isEmpty()) {
            return JSONObject().put("ok", false).put("message", "Devoir sans contenu à réviser.")
        }
        val date = assignment.dueDate.take(10)
        if (date.length != 10) {
            return JSONObject().put("ok", false).put("message", "Devoir sans date exploitable.")
        }
        val exam = RevisionExam(
            id = assignment.id,
            subject = assignment.subject.ifBlank { "matière" },
            date = date,
            matched = assignment.title.ifBlank { "devoir" },
        )
        return try {
            // #428 : le point d'entree PUBLIC du core (prompt + schema + cle
            // relayee). Le pont ne forge plus son propre appel fournisseur :
            // un seul endroit decide du prompt et du schema.
            val fiche = RevisionAi.requestRevisionFiche(OpenRouterLlm(), exam, chunks, apiKey)
            val candidate = ExamCandidate(
                source = "assignment",
                id = assignment.id,
                subject = exam.subject,
                date = date,
                confidence = "needs_confirm",
                matched = exam.matched,
            )
            // #404 : l'écriture de la fiche passe par la garde d'époque (la
            // fiche est générée par le modèle : l'appel dure plusieurs
            // secondes, une déconnexion peut survenir entre-temps). Refusée =
            // la session a changé : rien n'est écrit, le répertoire purgé ne
            // ressuscite pas (le contenu scolaire du compte déconnecté ne
            // reste pas sur le disque).
            val saved = saveRevisionSheet(
                store,
                assembleRevisionSheet(candidate, fiche, chunks.map { it.source }),
                epoch,
            )
            if (!saved) {
                return JSONObject().put("ok", false)
                    .put("message", "Session modifiée : fiche non enregistrée.")
            }
            JSONObject().put("ok", true)
        } catch (e: SecretDetectedException) {
            // #409 : un SECRET dans le cours (forme detectee par la garde I4).
            // On dit POURQUOI (le type), jamais le secret. Cette branche passe
            // AVANT le repli generique, sinon un secret serait affiche comme
            // une sortie hors format.
            JSONObject().put("ok", false).put("message", secretRefusalMessage(e.kind))
        } catch (e: OutputTooLongException) {
            // #411 : la sortie depasse la garde I5. « Format attendu » serait
            // un diagnostic FAUX (la fiche est bien formee, juste trop longue) :
            // on nomme la LIMITE REELLE.
            JSONObject().put("ok", false).put("message", e.userMessage)
        } catch (e: LlmError) {
            // Cause identifiée (clé, crédits, modèle, quota, réseau) : message
            // précis, distinct du repli « fiche non générée » (#359).
            JSONObject().put("ok", false).put("message", e.userMessage)
        } catch (e: Exception) {
            // La cause RÉELLE, en français et bornée : « Fiche non générée. »
            // avalait tout, sortie invalide comprise (#367). Jamais le message
            // brut de l'exception : il peut nommer un compte ou un hôte.
            JSONObject().put("ok", false)
                .put("message", revisionFailureMessage(revisionFailure(e)))
        }
    }

    /**
     * Cause d'un échec de génération de fiche, depuis l'exception levée.
     * `AiError` = garde I5 (sortie non conforme au schéma `{"fiche"}`) ;
     * `LlmError` = fournisseur (clé refusée, quota, réseau, sortie tronquée).
     */
    private fun revisionFailure(e: Throwable): RevisionFailure = when {
        e is AiError -> RevisionFailure.FORMAT
        e is LlmError -> when (e.status) {
            401, 403 -> RevisionFailure.KEY
            429 -> RevisionFailure.QUOTA
            else -> RevisionFailure.PROVIDER
        }
        else -> RevisionFailure.UNKNOWN
    }

    private fun revisionChunks(a: Assignment): List<RevisionChunk> {
        val out = mutableListOf<RevisionChunk>()
        if (a.description.isNotBlank()) out.add(RevisionChunk(a.description, "Consigne"))
        a.lessonContent?.takeIf { it.excerpt.isNotBlank() }?.let {
            out.add(RevisionChunk(it.excerpt, it.title.ifBlank { "Cours" }))
        }
        return out
    }

    /**
     * Devoirs pour l'assistant : le cache d'abord (TOUTES les semaines en
     * cache, #477), puis une lecture LOCALE de la fenêtre AFFICHÉE si le
     * cache ne porte pas le devoir demandé (#369 : semaine non courante, ou
     * cache purgé par une écriture). `fetchAsync` n'écrase pas le cache.
     */
    private fun loadAssignments(wantedId: String, weekStart: String): List<Assignment> {
        val fromCache = repo.payloads(CachePolicy.ASSIGNMENTS)
            .flatMap { payload -> runCatching { AssignmentsRepository.parse(payload) }.getOrDefault(emptyList()) }
        if (fromCache.any { it.id == wantedId }) return fromCache
        val query = if (weekStart.isNotEmpty()) "weekStart=$weekStart" else ""
        val outcome = await<RefreshOutcome> { cb ->
            repo.fetchAsync(CachePolicy.ASSIGNMENTS, query, cb)
        }
        val payload = when (outcome) {
            is RefreshOutcome.Updated -> outcome.payload
            is RefreshOutcome.OfflineFallback -> outcome.payload
            is RefreshOutcome.Failed -> outcome.cachedPayload
            null -> null
        } ?: return emptyList()
        return runCatching { AssignmentsRepository.parse(payload) }.getOrDefault(emptyList())
    }

    // --- Fiches de révision ----------------------------------------------------

    private fun revisionList(): JSONObject {
        val store = revisions ?: return JSONObject().put("sheets", JSONArray())
        val sheets = try {
            listRevisionSheets(store).sortedByDescending { it.date }
        } catch (_: Exception) {
            emptyList()
        }
        return JSONObject().put("sheets", JSONArray().apply { sheets.forEach { put(revisionJson(it)) } })
    }

    private fun revisionLoad(p: JSONObject): JSONObject {
        val store = revisions ?: return JSONObject().put("sheet", JSONObject.NULL)
        val sheet = try {
            loadRevisionSheet(store, bounded(p.string("id"), 80))
        } catch (_: Exception) {
            null
        }
        return JSONObject().put("sheet", sheet?.let { revisionJson(it) } ?: JSONObject.NULL)
    }

    private fun revisionExportPdf(p: JSONObject): JSONObject {
        val store = revisions
            ?: return JSONObject().put("ok", false).put("message", "Fiches indisponibles.")
        val id = bounded(p.string("id"), 80)
        val sheet = try {
            loadRevisionSheet(store, id)
        } catch (_: Exception) {
            null
        } ?: return JSONObject().put("ok", false).put("message", "Fiche introuvable.")
        return try {
            // #540 : le MÊME nom que les pièces jointes (l'IDENTIFIANT de la
            // fiche d'abord), la MÊME garde d'époque (une exportation pendant
            // une déconnexion n'est pas écrite) et le MÊME cache borné.
            val epoch = SessionEpoch.current()
            val bytes = ByteArrayOutputStream().use { out ->
                RevisionPdf.writeSheet(sheet, out)
                out.toByteArray()
            }
            val file = DownloadedFiles.write(
                File(ctx.cacheDir, DownloadedFiles.EXPORTS),
                "fiches",
                sheet.id,
                "fiche.pdf",
                bytes,
                epoch,
            ) ?: return JSONObject().put("ok", false).put("message", "Export PDF indisponible.")
            openFile(file, "application/pdf")
            JSONObject().put("ok", true)
        } catch (_: Exception) {
            JSONObject().put("ok", false).put("message", "Export PDF indisponible.")
        }
    }

    private fun revisionJson(sheet: RevisionSheet): JSONObject = JSONObject()
        .put("id", sheet.id)
        .put("title", sheet.title)
        .put("subject", sheet.subject)
        .put("date", sheet.date)
        .put("body", sheet.body)
        .put("sources", JSONArray(sheet.sources))

    // --- Profil ----------------------------------------------------------------

    private fun profileMe(): JSONObject {
        val result = await<MeResult> { cb -> profileRepo.fetchMe(cb) }
            ?: throw BridgeFailure("unavailable", "Profil indisponible.")
        return when (result) {
            is MeResult.Ok -> JSONObject()
                .put("payload", JSONObject().put("user", result.profile?.let { profileJson(it) } ?: JSONObject.NULL).toString())
            is MeResult.Err -> {
                sessionOrThrow(result.message)
                JSONObject()
                    .put("payload", JSONObject.NULL)
                    .put("error", result.message)
            }
        }
    }

    private fun profilePhoto(): JSONObject {
        val me = await<MeResult> { cb -> profileRepo.fetchMe(cb) }
        val profile = (me as? MeResult.Ok)?.profile
            ?: return JSONObject().put("dataUrl", JSONObject.NULL)
        val photo = await<PhotoState> { cb -> profileRepo.fetchPhoto(profile) { bitmap -> cb(bitmap.toState()) } }
        val bitmap = (photo as? PhotoState.Loaded)?.bitmap
            ?: return JSONObject().put("dataUrl", JSONObject.NULL)
        return try {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            val bytes = out.toByteArray()
            if (bytes.isEmpty() || bytes.size > ProfileRepository.PHOTO_MAX_BYTES) {
                JSONObject().put("dataUrl", JSONObject.NULL)
            } else {
                val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
                JSONObject().put("dataUrl", "data:image/png;base64,$encoded")
            }
        } catch (_: Exception) {
            JSONObject().put("dataUrl", JSONObject.NULL)
        }
    }

    private fun Bitmap?.toState(): PhotoState =
        if (this == null) PhotoState.Absent else PhotoState.Loaded(this)

    private fun profileJson(profile: UserProfile): JSONObject = JSONObject()
        .put("accountId", profile.accountId)
        .put("displayName", profile.displayName)
        .put("firstName", profile.firstName)
        .put("lastName", profile.lastName)
        .put("classLabel", profile.classLabel)
        .put("periodName", profile.periodName)
        .put("hasKids", profile.hasKids)
        .put("kids", JSONArray().apply {
            for (k: ChildAccount in profile.kids) {
                put(
                    JSONObject()
                        .put("accountId", k.accountId)
                        .put("displayName", k.displayName)
                        .put("classLabel", k.classLabel),
                )
            }
        })

    // --- Utilitaires -----------------------------------------------------------

    private fun currentBaseUrl(): String = serverStore.baseUrl(baseUrlSeed)

    private fun cacheKey(key: String): String? = when (key) {
        "grades" -> CachePolicy.GRADES
        "assignments" -> CachePolicy.ASSIGNMENTS
        "timetable" -> CachePolicy.TIMETABLE
        "discussions" -> CachePolicy.DISCUSSIONS
        "news" -> CachePolicy.NEWS
        "canteen" -> CachePolicy.MENUS
        "attendance" -> CachePolicy.ATTENDANCE
        "punishments" -> CachePolicy.PUNISHMENTS
        "alerts" -> CachePolicy.SECURITY_ALERTS
        "capabilities" -> CachePolicy.CAPABILITIES
        else -> null
    }

    private fun openFile(file: File, mime: String) {
        val uri = FileProvider.getUriForFile(activity, ATTACHMENT_PROVIDER_AUTHORITY, file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.runOnUiThread {
            try {
                activity.startActivity(intent)
            } catch (_: Exception) {
                // Aucun ouvreur : la pièce reste dans le cache, rien n'est affiché.
            }
        }
    }

    /** Attend un callback de dépôt (toujours livré sur le thread principal). */
    private fun <T> await(timeoutMs: Long = AWAIT_DEFAULT_MS, start: ((T) -> Unit) -> Unit): T? {
        val latch = CountDownLatch(1)
        val holder = arrayOfNulls<Any?>(1)
        try {
            start { value ->
                holder[0] = value
                latch.countDown()
            }
        } catch (e: BridgeFailure) {
            throw e
        } catch (_: Exception) {
            return null
        }
        return if (latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            @Suppress("UNCHECKED_CAST")
            holder[0] as T?
        } else {
            null
        }
    }

    private fun resolve(requestId: String, result: JSONObject) {
        if (cancelled.remove(requestId)) return
        postJs(
            "window.__vsnResolve(${JSONObject.quote(requestId)}, " +
                "${JSONObject.quote(result.toString())})",
        )
    }

    /**
     * Réponse d'échec : elle ne doit JAMAIS échouer.
     *
     * C'est le DERNIER filet du pont : si le rejet lui-même plante (mémoire
     * épuisée), on l'avale plutôt que de laisser l'exception remonter — un
     * `Error` ici tuerait le fil du worker SANS réponse et la promesse JS
     * pendrait (#394). Le délai JS reste le filet de sécurité.
     */
    private fun reject(requestId: String, code: String, message: String) {
        try {
            if (cancelled.remove(requestId)) return
            // Borné : aucune exception brute, aucun hôte, aucun secret.
            val error = JSONObject()
                .put("code", code)
                .put("message", message.replace('\n', ' ').take(200))
            postJs(
                "window.__vsnReject(${JSONObject.quote(requestId)}, " +
                    "${JSONObject.quote(error.toString())})",
            )
        } catch (_: Throwable) {
            // Le rejet n'a pas pu partir : la promesse expirera côté JS.
        }
    }

    private fun postJs(script: String) {
        main.post {
            try {
                webView.evaluateJavascript(script, null)
            } catch (_: Throwable) {
                // WebView détruite (ou `Error` inattendu) : la promesse JS
                // expirera d'elle-même.
            }
        }
    }

    private fun validId(id: String): Boolean =
        id.length in 1..64 && id.all { it.isLetterOrDigit() || it == '_' || it == '-' }

    /** Session morte = code dédié, seule façon de déclencher la porte JS. */
    private fun sessionOrThrow(error: String?) {
        if (error == DeviceAuth.REJECTED_MESSAGE) {
            throw BridgeFailure("auth_required", error)
        }
    }

    private fun bounded(value: String, max: Int): String {
        val trimmed = value.trim()
        if (trimmed.length > max) throw BridgeFailure("bad_request", "Champ trop long.")
        return trimmed
    }

    private fun JSONObject.string(key: String): String =
        if (isNull(key)) "" else optString(key, "")

    companion object {
        private const val MAX_METHOD_CHARS = 64
        private const val MAX_PARAMS_CHARS = 256 * 1024
        private const val THEME_PREFS = "settings"
        private const val THEME_KEY = "theme"

        /** Journal du pont (jamais de secret : cf. le `init` de la classe). */
        private const val TAG = "vsn-bridge"

        /** Méthode d'abandon d'un appel (allowlistée, comme toute autre). */
        private const val CANCEL_METHOD = "bridge.cancel"

        /** Attente par défaut d'un dépôt (`await`). */
        const val AWAIT_DEFAULT_MS = 20_000L

        /** Attente de l'appel LLM : le plus long du pont. */
        const val AWAIT_LLM_MS = 45_000L

        /**
         * Plafond d'attente natif : le chemin le plus long (chargement des
         * devoirs 20 s + appel LLM 45 s). Le JS doit attendre PLUS que ce
         * plafond, sinon il abandonne avant la réponse native et la perd
         * définitivement (#371). Miroir : `web/src/bridge/types.ts`.
         */
        const val MAX_NATIVE_WAIT_MS = AWAIT_DEFAULT_MS + AWAIT_LLM_MS

        /** Miroir exact de `web/src/bridge/types.ts`. Aucun autre nom n'entre. */
        private val METHODS = setOf(
            "app.ready", "app.theme", "app.setTheme", "app.back",
            "session.status", "session.restore", "session.logout", "session.accounts",
            "pairing.scanQr", "pairing.pair", "pairing.cancel",
            "resources.cached", "resources.load", "resources.invalidate", "resources.sync",
            "capabilities.load", "capabilities.refresh",
            "news.item",
            "assignments.toggle", "assignments.attachment",
            "messages.list", "messages.thread", "messages.reply", "messages.create",
            "messages.setRead", "messages.delete", "messages.recipients",
            "settings.get", "settings.saveServer", "settings.subjectPrefs", "settings.saveSubject",
            "llm.status", "llm.saveKey", "llm.forgetKey", "llm.askHomework",
            "llm.generateRevision",
            "revision.list", "revision.load", "revision.exportPdf",
            "profile.me", "profile.photo",
            "bridge.cancel",
        )
    }
}
