package fr.veryslopnynotes.app

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import fr.veryslopnynotes.core.RevisionKv
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.data.AccountIdentity
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.AssignmentsRepository
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.DeviceAuth
import fr.veryslopnynotes.data.DiscussionsRepository
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.FileRevisionStore
import fr.veryslopnynotes.data.FileSubjectPrefsStore
import fr.veryslopnynotes.data.FileTeacherChatStore
import fr.veryslopnynotes.data.InMemoryCacheStore
import fr.veryslopnynotes.data.InMemoryTeacherChatStore
import fr.veryslopnynotes.data.InMemorySubjectPrefsStore
import fr.veryslopnynotes.data.FileLessonNotesStore
import fr.veryslopnynotes.data.InMemoryLessonNotesStore
import fr.veryslopnynotes.data.LessonNotesRepository
import fr.veryslopnynotes.data.LlmKeys
import fr.veryslopnynotes.data.LocalDataStore
import fr.veryslopnynotes.data.ManualStore
import fr.veryslopnynotes.data.ManualsClient
import fr.veryslopnynotes.data.PairingInput
import fr.veryslopnynotes.data.PairingRepository
import fr.veryslopnynotes.data.PairingResult
import fr.veryslopnynotes.data.ProfileRepository
import fr.veryslopnynotes.data.RestoreResult
import fr.veryslopnynotes.data.SchoolQr
import fr.veryslopnynotes.data.SecureStorage
import fr.veryslopnynotes.data.ServerStore
import fr.veryslopnynotes.data.SessionEpoch
import fr.veryslopnynotes.data.SessionStores
import fr.veryslopnynotes.data.StoreHealth
import fr.veryslopnynotes.data.SubjectPrefsRepository
import fr.veryslopnynotes.data.SyncedRepository
import fr.veryslopnynotes.data.TeacherChatLocalStore
import fr.veryslopnynotes.data.parseSchoolQr
import org.json.JSONObject
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
    internal val ctx: Context = activity.applicationContext
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
    internal val serverStore = ServerStore(ctx)
    internal val manuals = ManualStore(ctx)
    // #586 : cahier de cours local, dans `offline/` (donc purgé avec le cache
    // du compte). Le fichier est relu avant chaque fusion par le dépôt.
    internal val lessons = LessonNotesRepository(
        try {
            FileLessonNotesStore(
                File(ctx.filesDir, "offline/course-notes.json"),
                legacyFile = File(ctx.filesDir, "offline/cahier.json"),
            )
        } catch (_: Exception) {
            InMemoryLessonNotesStore()
        },
    )
    /** #587 : capture native, fichier temporaire privé, jamais exposé au JS. */
    internal val photos = PhotoCapture(activity)
    // #633 : fil local du professeur IA. Dans `offline/`, donc purgé avec le
    // compte à la déconnexion (I16 bis) ; l'écriture passe par la garde d'époque.
    internal val teacherChat: TeacherChatLocalStore = try {
        FileTeacherChatStore(File(ctx.filesDir, "offline/teacher_chat.json"))
    } catch (_: Exception) {
        InMemoryTeacherChatStore()
    }
    // #540 : le store englobe le CACHE (`cacheDir/attachments/`,
    // `cacheDir/exports/`) : une purge de compte efface les pièces jointes
    // téléchargées comme le cache, sans chemin de purge qui en oublie.
    private val cacheStore = try {
        LocalDataStore(FileCacheStore(File(ctx.filesDir, "offline")), ctx.cacheDir)
    } catch (_: Exception) {
        InMemoryCacheStore()
    }
    private val sessions = SessionStores.get(ctx)
    internal val repo = SyncedRepository(cacheStore)
    internal val assignments = AssignmentsRepository(cacheStore)
    internal val discussions = DiscussionsRepository(cacheStore)
    internal val profileRepo = ProfileRepository()
    internal val accounts = AccountStore(ctx, cacheStore, sessions)
    internal val llmKeys = LlmKeys.get(ctx)

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
    internal val prefsRepo = SubjectPrefsRepository(
        try {
            FileSubjectPrefsStore(File(ctx.filesDir, "offline/subject_prefs.json"))
        } catch (_: Exception) {
            InMemorySubjectPrefsStore()
        },
    )
    internal val revisions: RevisionKv? = try {
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

    /** Dernier profil publié (jamais persisté) : sert à éviter un aller-retour
     *  Pronote quand on a déjà la classe sous la main. */
    @Volatile
    internal var cachedProfile: UserProfile? = null

    /** Échecs de scrape récents (adresse -> millis) : ne pas repayer 35 s à
     *  chaque question quand le scraper est injoignable. */
    internal val manualFailures = ConcurrentHashMap<String, Long>()

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

    /** Réponse précoce : le pont a déjà répondu, l'appel ne part pas sur un fil. */
    private val earlySink = object : BridgeEarlySink {
        override fun reject(requestId: String, code: String, message: String) {
            this@VsnBridge.reject(requestId, code, message)
        }

        override fun resolveOk(requestId: String) {
            resolve(requestId, JSONObject().put("ok", true))
        }

        override fun cancel(requestId: String, paramsJson: String) {
            cancelled.remove(requestId)
            cancelRequest(paramsJson)
        }
    }

    private fun runCall(requestId: String, method: String, paramsJson: String) {
        // #539 : la réponse ne manque JAMAIS (I10). L'admission est PURE et
        // EXÉCUTÉE par le harnais de parité : identifiant mal formé, méthode
        // inconnue, requête trop volumineuse, abandon et pont fermé répondent
        // exactement une fois, sans sortie muette.
        if (handleBridgeEarly(requestId, method, paramsJson, executors.isShutdown, earlySink)) {
            return
        }
        cancelled.remove(requestId)
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
        if (validBridgeId(target) && inFlight.contains(target)) cancelled.add(target)
    }

    /** Fin de vie de la WebView : aucun fil ne survit à la rotation. */
    fun close() {
        photos.cancel()
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
            "pairing.pairDemo" -> pairDemo()
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
            "settings.saveManualUrl" -> saveManualUrl(p)
            "settings.dismissManualPrompt" -> dismissManualPrompt()
            "settings.subjectPrefs" -> subjectPrefs()
            "settings.saveSubject" -> saveSubject(p, epoch)
            "lessons.list" -> lessonsList()
            "lessons.load" -> lessonsLoad(p)
            "lessons.save" -> lessonsSave(p, epoch)
            "lessons.delete" -> lessonsDelete(p, epoch)
            "lessons.setManual" -> lessonsSetManual(p)
            "lessons.addPhoto" -> lessonsAddPhoto(p)
            "llm.status" -> JSONObject().put("configured", llmKeys.isConfigured())
            "llm.saveKey" -> saveLlmKey(p)
            "llm.forgetKey" -> {
                llmKeys.clear()
                JSONObject().put("ok", true)
            }
            "llm.askHomework" -> askHomework(p, epoch, requestId)
            "llm.solvePhoto" -> solveHomeworkPhoto(p, epoch, requestId)
            "llm.generateRevision" -> generateRevision(p, epoch)
            "llm.teacherTurn" -> teacherTurn(p)
            "exercises.propose" -> exercisesPropose(p)
            "exercises.help" -> exercisesHelp(p)
            "teacher.load" -> teacherLoad()
            "teacher.save" -> teacherSave(p, epoch)
            "teacher.delete" -> teacherDelete(epoch)
            "revision.list" -> revisionList()
            "revision.load" -> revisionLoad(p)
            "revision.exportPdf" -> revisionExportPdf(p)
            "profile.me" -> profileMe()
            "profile.photo" -> profilePhoto()
            else -> throw BridgeFailure("bad_request", "Méthode inconnue.")
        }
    }

    // --- Application / session -------------------------------------------------

    internal fun theme(): String = when (themePrefs?.getString(THEME_KEY, null)) {
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
                is RestoreResult.Dead -> {
                    // I16 : session morte = donnée de compte purgée.
                    // `PairingRepository` a déjà purgé le cache ; le manuel
                    // (adresse, extraits, classe, matières) part ici, sinon il
                    // resservirait au prochain appairage.
                    purgeManualAccountData()
                    JSONObject().put("state", "dead").put("message", result.message)
                }
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
        cachedProfile = null
        purgeManualAccountData()
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
        cachedProfile = null
        purgeManualAccountData()
        accounts.logout()
    }

    /**
     * I16 : le manuel (adresse, extraits déjà récupérés, classe, matières) est
     * la donnée d'UN compte. Il est purgé avec le cache — déconnexion, session
     * morte, appairage d'un AUTRE compte — sinon le compte B reçoit le manuel
     * du compte A dans `aiContextFor` / `manualDocFor`.
     *
     * `manualFailures` part avec : ses clés sont des adresses de manuel, donc
     * de la donnée du compte, et une adresse oubliée n'a plus à bloquer un
     * scrape du nouveau compte.
     */
    private fun purgeManualAccountData() {
        manuals.clearAccountData()
        manualFailures.clear()
    }

    /** Identité du compte de la session PERSISTÉE ; `null` = inconnue ou illisible. */
    private fun storedIdentity(): AccountIdentity? = try {
        sessions.load()?.let { AccountIdentity.of(it.endpointUrl, it.username) }
    } catch (_: Exception) {
        null
    }

    /**
     * I16 : le compte a-t-il CHANGÉ ? La purge du manuel suit celle du cache
     * (`CacheScope.switchAccount` dans `PairingRepository`, qui ne connaît pas
     * `ManualStore`). Le pont refait donc la MÊME comparaison, avec la même
     * règle fail-closed : une identité INCONNUE (avant ou après) purge aussi.
     */
    private fun purgeManualIfAccountChanged(previous: AccountIdentity?) {
        val next = storedIdentity()
        if (previous == null || next == null || !previous.sameAccount(next)) {
            purgeManualAccountData()
        }
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
        // I16 : identité AVANT l'appairage — la purge du manuel (et du cache,
        // dans `PairingRepository`) ne vise que le compte précédent.
        val previous = storedIdentity()
        // Même verrou que la restauration : un appairage et un restore
        // concurrents écriraient deux sessions dans le même store.
        val result = synchronized(restoreLock) {
            pairing.pairBlocking(PairingInput(qr = qr, pin = pin))
        }
        return when (result) {
            is PairingResult.Ok -> {
                sessionReady = true
                cachedProfile = null
                purgeManualIfAccountChanged(previous)
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

    /**
     * Connexion à l'établissement de DÉMONSTRATION : un clic, sans QR ni PIN.
     *
     * Même verrou que l'appairage et la restauration : une seule session à la
     * fois dans le process. Le pont ne renvoie que le CODE d'échec et une
     * phrase choisie par lui — jamais le message brut d'une exception, qui
     * pourrait nommer l'hôte (I10, #396).
     */
    private fun pairDemo(): JSONObject {
        // I16 : la démonstration est un AUTRE compte que l'établissement
        // appairé — la comparaison d'identité décide de la purge du manuel.
        val previous = storedIdentity()
        val result = synchronized(restoreLock) {
            pairing.pairDemoBlocking()
        }
        return when (result) {
            is PairingResult.Ok -> {
                sessionReady = true
                cachedProfile = null
                purgeManualIfAccountChanged(previous)
                result.accountId?.let { accounts.add(it); accounts.select(it) }
                JSONObject().put("ok", true)
            }
            is PairingResult.Err -> JSONObject()
                .put("ok", false)
                .put("code", result.code)
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


    // --- Utilitaires -----------------------------------------------------------

    internal fun currentBaseUrl(): String = serverStore.baseUrl(baseUrlSeed)

    internal fun cacheKey(key: String): String? = when (key) {
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

    internal fun openFile(file: File, mime: String) {
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
    internal fun <T> await(timeoutMs: Long = AWAIT_DEFAULT_MS, start: ((T) -> Unit) -> Unit): T? {
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

    /**
     * Étape réelle d'un appel long, poussée au JS sur le thread principal.
     * Ce n'est PAS une interface `@JavascriptInterface` : le seul point
     * d'entrée reste `call`, et le JS ignore un identifiant qu'il n'attend pas.
     */
    internal fun emitProgress(requestId: String?, phase: String, sources: Int = -1, chars: Int = -1) {
        if (requestId.isNullOrEmpty() || !validBridgeId(requestId)) return
        val payload = JSONObject().put("phase", phase.take(24))
        if (sources >= 0) payload.put("sources", sources)
        if (chars >= 0) payload.put("chars", chars)
        postJs(
            "window.__vsnProgress && window.__vsnProgress(${JSONObject.quote(requestId)}, " +
                "${JSONObject.quote(payload.toString())})",
        )
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

    /** Session morte = code dédié, seule façon de déclencher la porte JS. */
    internal fun sessionOrThrow(error: String?) {
        if (error == DeviceAuth.REJECTED_MESSAGE) {
            throw BridgeFailure("auth_required", error)
        }
    }

    internal fun bounded(value: String, max: Int): String {
        val trimmed = value.trim()
        if (trimmed.length > max) throw BridgeFailure("bad_request", "Champ trop long.")
        return trimmed
    }

    internal fun JSONObject.string(key: String): String =
        if (isNull(key)) "" else optString(key, "")

    companion object {
        private const val THEME_PREFS = "settings"
        private const val THEME_KEY = "theme"

        /** Journal du pont (jamais de secret : cf. le `init` de la classe). */
        private const val TAG = "vsn-bridge"

        /** Attente par défaut d'un dépôt (`await`). */
        const val AWAIT_DEFAULT_MS = 20_000L

        /**
         * Attente native d'un appel LLM : STRICTEMENT plus longue que le
         * budget fournisseur de l'aide aux devoirs ([HOMEWORK_LLM_TIMEOUT_MS]).
         * À budget égal, la réponse produite par la reprise arrive au même
         * instant que l'abandon et est perdue.
         */
        const val AWAIT_LLM_MS = 40_000L

        /**
         * Budget fournisseur de `llm.askHomework` : le client le répartit sur
         * deux tentatives, donc l'appel se termine avant [AWAIT_LLM_MS] et la
         * réponse de la reprise a le temps d'arriver.
         */
        const val HOMEWORK_LLM_TIMEOUT_MS = 35_000L

        /**
         * Attente d'une photo : l'élève cadre, l'appareil écrit, puis la
         * transcription. Le JS ne met PAS de timeout sur cette méthode ;
         * ce plafond natif évite seulement un fil pendu pour toujours.
         */
        const val AWAIT_PHOTO_MS = 180_000L

        /**
         * Récupération d'un extrait de manuel via le scraper, avant l'appel
         * LLM. Bornée par le client (`ManualsClient`), mais comptée dans le
         * plafond pour que le JS n'abandonne jamais trop tôt.
         */
        const val AWAIT_MANUAL_MS = 35_000L

        /** Après un échec de scrape, on ne réessaie pas à chaque question. */
        internal const val MANUAL_RETRY_MS = 10 * 60 * 1000L

        /**
         * Budget TOTAL de lecture des pièces jointes (#631) : il est COMPTÉ
         * dans le plafond d'attente natif (défaut + manuel + pièces jointes +
         * LLM) pour que le JS ne perde jamais la réponse. Passé ce délai, les
         * pièces restantes sont nommées « délai dépassé », jamais abandonnées
         * en silence.
         */
        internal const val ATTACHMENT_BUDGET_MS = 20_000L

        /**
         * Plafond d'attente natif : le chemin le plus long d'un devoir
         * (chargement des devoirs 20 s + manuel 35 s + pièces jointes 20 s +
         * attente LLM 40 s = 115 s). Le JS doit attendre PLUS que ce plafond,
         * sinon il abandonne avant la réponse native et la perd définitivement
         * (#371). Miroir : `web/src/bridge/types.ts`.
         */
        const val MAX_NATIVE_WAIT_MS =
            AWAIT_DEFAULT_MS + AWAIT_MANUAL_MS + ATTACHMENT_BUDGET_MS + AWAIT_LLM_MS
    }
}
