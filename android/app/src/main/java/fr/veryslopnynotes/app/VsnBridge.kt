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
import fr.veryslopnynotes.core.AiContext
import fr.veryslopnynotes.core.AiContextEntry
import fr.veryslopnynotes.core.AiContextItem
import fr.veryslopnynotes.core.AiContextResult
import fr.veryslopnynotes.core.AiContextType
import fr.veryslopnynotes.core.AiError
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.core.CapabilitiesJson
import fr.veryslopnynotes.core.ChildAccount
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.core.ExamCandidate
import fr.veryslopnynotes.core.ExerciseHelpMode
import fr.veryslopnynotes.core.Exercises
import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.core.HomeworkAi
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.core.LessonNote
import fr.veryslopnynotes.core.LessonNotes
import fr.veryslopnynotes.core.ManualCatalog
import fr.veryslopnynotes.core.ManualUrl
import fr.veryslopnynotes.core.ManualUrlResult
import fr.veryslopnynotes.core.OutputTooLongException
import fr.veryslopnynotes.core.RevisionChunk
import fr.veryslopnynotes.core.RevisionExam
import fr.veryslopnynotes.core.RevisionFailure
import fr.veryslopnynotes.core.RevisionKv
import fr.veryslopnynotes.core.RevisionPdf
import fr.veryslopnynotes.core.RevisionSheet
import fr.veryslopnynotes.core.RevisionAi
import fr.veryslopnynotes.core.SecretDetectedException
import fr.veryslopnynotes.core.TeacherChat
import fr.veryslopnynotes.core.TeacherChatMessage
import fr.veryslopnynotes.core.TeacherMode
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.core.VisionImage
import fr.veryslopnynotes.core.assembleRevisionSheet
import fr.veryslopnynotes.core.listRevisionSheets
import fr.veryslopnynotes.core.loadRevisionSheet
import fr.veryslopnynotes.core.revisionFailureMessage
import fr.veryslopnynotes.core.saveRevisionSheet
import fr.veryslopnynotes.core.secretRefusalMessage
import fr.veryslopnynotes.core.transcribeLesson
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.AssignmentsRepository
import fr.veryslopnynotes.data.AttachmentText
import fr.veryslopnynotes.data.AttachmentTextResult
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.DeviceAuth
import fr.veryslopnynotes.data.DiscussionsRepository
import fr.veryslopnynotes.data.DiscussionWriteOutcome
import fr.veryslopnynotes.data.DownloadedFiles
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
import fr.veryslopnynotes.data.LessonNotesWrite
import fr.veryslopnynotes.data.LlmError
import fr.veryslopnynotes.data.LlmKeys
import fr.veryslopnynotes.data.LocalDataStore
import fr.veryslopnynotes.data.ManualDoc
import fr.veryslopnynotes.data.ManualStore
import fr.veryslopnynotes.data.ManualsClient
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
import fr.veryslopnynotes.data.TeacherChatLocalStore
import fr.veryslopnynotes.data.parseTeacherThreadOrNull
import fr.veryslopnynotes.data.parseSchoolQr
import fr.veryslopnynotes.data.teacherThreadJson
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
    private val manuals = ManualStore(ctx)
    // #586 : cahier de cours local, dans `offline/` (donc purgé avec le cache
    // du compte). Le fichier est relu avant chaque fusion par le dépôt.
    private val lessons = LessonNotesRepository(
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
    private val photos = PhotoCapture(activity)
    // #633 : fil local du professeur IA. Dans `offline/`, donc purgé avec le
    // compte à la déconnexion (I16 bis) ; l'écriture passe par la garde d'époque.
    private val teacherChat: TeacherChatLocalStore = try {
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

    /** Dernier profil publié (jamais persisté) : sert à éviter un aller-retour
     *  Pronote quand on a déjà la classe sous la main. */
    @Volatile
    private var cachedProfile: UserProfile? = null

    /** Échecs de scrape récents (adresse -> millis) : ne pas repayer 35 s à
     *  chaque question quand le scraper est injoignable. */
    private val manualFailures = ConcurrentHashMap<String, Long>()

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
            "llm.askHomework" -> askHomework(p, epoch)
            "llm.solvePhoto" -> solveHomeworkPhoto(p, epoch)
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
        cachedProfile = null
        manualFailures.clear()
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
        manualFailures.clear()
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
                cachedProfile = null
                manualFailures.clear()
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
        val result = synchronized(restoreLock) {
            pairing.pairDemoBlocking()
        }
        return when (result) {
            is PairingResult.Ok -> {
                sessionReady = true
                cachedProfile = null
                manualFailures.clear()
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

    private fun settings(): JSONObject {
        val known = knownSubjects()
        return JSONObject()
            .put("theme", theme())
            // Hôte seul, jamais une URL de session ni un jeton.
            .put("serverHost", currentBaseUrl().substringAfter("://").trimEnd('/').take(300))
            .put("llmConfigured", llmKeys.isConfigured())
            .put("accountCount", accounts.count())
            // Adresse du manuel : réglage saisi par l'utilisateur, jamais un secret.
            .put("manualUrl", manuals.url() ?: "")
            .put("manualConfigured", manuals.url() != null)
            .put("manualAuto", manuals.url()?.let { ManualCatalog.isCatalog(it) } == true)
            .put("manualReady", manuals.hasDoc())
            .put("manualLevel", ManualCatalog.levelLabel(ManualCatalog.levelOf(manuals.classLabel(), manuals.subjects())))
            .put("manualSpecialties", JSONArray(ManualCatalog.specialties(manuals.classLabel(), manuals.subjects())))
            .put("manualPromptSeen", manuals.promptSeen())
            // #586 : l'interface n'active l'assistant texte que si la matière a
            // VRAIMENT une source (manuel résolu ou cours mémorisé). Une liste
            // vide n'est pas une erreur : elle dit « aucune source connue ».
            .put("manualSubjects", JSONArray(known.filter { manualAvailableForSubject(it, known) }))
            .put("lessonSubjects", JSONArray(lessons.subjects()))
    }

    private fun saveServer(p: JSONObject): JSONObject {
        var host = bounded(p.string("host"), 300)
        if (!host.contains("://")) {
            val scheme = if (host.startsWith("localhost") || host.startsWith("10.0.2.2")) "http" else "https"
            host = "$scheme://$host"
        }
        return when (val result = serverStore.save(host)) {
            is fr.veryslopnynotes.core.ServerUrlResult.Ok -> {
                // Nouveau scraper = nouvelle chance pour les manuels.
                manualFailures.clear()
                JSONObject().put("ok", true)
            }
            is fr.veryslopnynotes.core.ServerUrlResult.Rejected ->
                JSONObject().put("ok", false).put("message", result.message)
        }
    }

    /**
     * Enregistre l'adresse du manuel puis prépare le choix :
     * - adresse de CATALOGUE (`/manuels`) : la classe et la matière décideront
     *   de l'ouvrage à chaque devoir — rien n'est scrapé ici ;
     * - adresse d'un ouvrage PRÉCIS : son extrait est récupéré tout de suite.
     *
     * La classe vient du profil (une seule lecture, mise en cache), les
     * matières des caches locaux. L'adresse reste enregistrée même quand la
     * récupération échoue.
     *
     * Le corps vide = « oublier le manuel » (et ses extraits).
     */
    private fun saveManualUrl(p: JSONObject): JSONObject {
        val raw = bounded(p.string("url"), ManualUrl.MAX_CHARS)
        if (raw.isEmpty()) {
            manuals.clear()
            return JSONObject().put("ok", true).put("ready", false).put("auto", false)
        }
        return when (val saved = manuals.save(raw)) {
            is ManualUrlResult.Rejected ->
                JSONObject().put("ok", false).put("message", saved.message)
            is ManualUrlResult.Ok -> {
                val classLabel = profileClassLabel()
                val subjects = knownSubjects()
                manuals.saveGuess(classLabel, subjects)
                val auto = ManualCatalog.isCatalog(saved.url)
                var warning: String? = null
                if (!auto && manuals.doc(saved.url) == null) {
                    // Enregistrement explicite = nouvelle tentative, même si
                    // la précédente a échoué.
                    manualFailures.remove(saved.url)
                    val fetched = ManualsClient(currentBaseUrl()).fetch(saved.url)
                    if (fetched.doc != null) {
                        fetched.doc?.let { manuals.saveDoc(saved.url, it) }
                        manualFailures.remove(saved.url)
                    } else {
                        manualFailures[saved.url] = System.currentTimeMillis()
                    }
                    warning = fetched.error
                }
                val ready = manuals.hasDoc()
                val level = ManualCatalog.levelOf(classLabel, subjects)
                JSONObject()
                    .put("ok", true)
                    .put("ready", ready)
                    .put("auto", auto)
                    .put("level", ManualCatalog.levelLabel(level))
                    .put("specialties", JSONArray(ManualCatalog.specialties(classLabel, subjects)))
                    .apply {
                        if (!auto && !ready && warning != null) put("message", warning)
                    }
            }
        }
    }

    private fun dismissManualPrompt(): JSONObject {
        manuals.markPromptSeen()
        return JSONObject().put("ok", true)
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

    // --- Cahier de cours (#586) -------------------------------------------------

    /**
     * Matières proposées par le Cahier : celles déjà connues des caches
     * (notes, devoirs, EDT), les préférences et les notes existantes. Aucune
     * lecture réseau ici : l'écran s'ouvre même hors ligne.
     */
    private fun lessonsList(): JSONObject {
        val known = LinkedHashSet<String>()
        knownSubjects().forEach { known.add(it) }
        lessons.subjects().forEach { known.add(it) }
        prefsRepo.prefs().forEach { known.add(it.subject) }
        val arr = JSONArray()
        for (subject in known.take(64)) {
            val notes = lessons.notesFor(subject)
            arr.put(
                JSONObject()
                    .put("subject", subject)
                    .put("manualEnabled", manuals.isEnabled(subject))
                    .put("manualAvailable", manualAvailableForSubject(subject, known.toList()))
                    .put(
                        "notes",
                        JSONArray().apply {
                            for (note in notes) {
                                put(
                                    JSONObject()
                                        .put("id", note.id)
                                        .put("title", note.title)
                                        .put("createdAt", note.createdAt)
                                        .put("chars", note.text.length),
                                )
                            }
                        },
                    ),
            )
        }
        return JSONObject()
            .put("subjects", arr)
            .put("maxNotesPerSubject", LessonNotes.MAX_PER_SUBJECT)
            .put("maxTextChars", LessonNote.MAX_TEXT_CHARS)
            .put("maxTitleChars", LessonNote.MAX_TITLE_CHARS)
    }

    private fun lessonsLoad(p: JSONObject): JSONObject {
        val id = bounded(p.string("id"), LessonNote.MAX_ID_CHARS)
        val note = lessons.find(id)
            ?: return JSONObject().put("ok", false).put("message", "Cours introuvable.")
        return JSONObject().put("ok", true).put("note", lessonJson(note))
    }

    private fun lessonsSave(p: JSONObject, epoch: Long): JSONObject {
        val id = bounded(p.string("id"), LessonNote.MAX_ID_CHARS)
        val subject = bounded(p.string("subject"), LessonNote.MAX_SUBJECT_CHARS)
        val title = bounded(p.string("title"), LessonNote.MAX_TITLE_CHARS)
        val text = bounded(p.string("text"), LessonNote.MAX_TEXT_CHARS)
        return when (lessons.save(id, subject, title, text, epoch)) {
            LessonNotesWrite.WRITTEN -> JSONObject().put("ok", true)
            LessonNotesWrite.INVALID -> JSONObject().put("ok", false)
                .put("message", "Cours invalide : matière, titre et texte sont obligatoires (texte 4000 caractères maximum).")
            LessonNotesWrite.LIMIT -> JSONObject().put("ok", false)
                .put("message", "Cours non ajouté : ${LessonNotes.MAX_PER_SUBJECT} cours maximum par matière.")
            LessonNotesWrite.NOT_FOUND -> JSONObject().put("ok", false)
                .put("message", "Cours introuvable : recharge le cahier.")
            LessonNotesWrite.REFUSED -> JSONObject().put("ok", false)
                .put("message", "Session modifiée : cours non enregistré.")
        }
    }

    private fun lessonsDelete(p: JSONObject, epoch: Long): JSONObject {
        val id = bounded(p.string("id"), LessonNote.MAX_ID_CHARS)
        return when (lessons.delete(id, epoch)) {
            LessonNotesWrite.WRITTEN -> JSONObject().put("ok", true)
            LessonNotesWrite.NOT_FOUND -> JSONObject().put("ok", false)
                .put("message", "Cours introuvable.")
            LessonNotesWrite.REFUSED -> JSONObject().put("ok", false)
                .put("message", "Session modifiée : cours non supprimé.")
            else -> JSONObject().put("ok", false).put("message", "Cours non supprimé.")
        }
    }

    private fun lessonsSetManual(p: JSONObject): JSONObject {
        val subject = bounded(p.string("subject"), LessonNote.MAX_SUBJECT_CHARS)
        if (subject.isEmpty()) {
            return JSONObject().put("ok", false).put("message", "Matière invalide.")
        }
        val enabled = p.optBoolean("enabled", true)
        return if (manuals.setEnabled(subject, enabled)) {
            JSONObject().put("ok", true).put("enabled", enabled)
        } else {
            JSONObject().put("ok", false).put("message", "Réglage du manuel non enregistré.")
        }
    }

    /**
     * Photo de cours -> brouillon de note (#587). La photo ne traverse JAMAIS
     * le pont : elle est lue ici, ré-encodée, envoyée au fournisseur vision,
     * puis supprimée. Le texte revient pour relecture avant enregistrement.
     *
     * L'attente inclut le temps que l'élève cadre la photo : le JS met cette
     * méthode à 0 (timeout illimité), comme le scan du QR. Le plafond natif
     * évite seulement un fil pendu pour toujours.
     */
    private fun lessonsAddPhoto(p: JSONObject): JSONObject {
        val subject = bounded(p.string("subject"), LessonNote.MAX_SUBJECT_CHARS)
        if (subject.isEmpty()) return JSONObject().put("ok", false).put("message", "Choisis une matière.")
        val source = bounded(p.string("source"), 16).ifEmpty { "camera" }
        val apiKey = llmKeys.apiKey()?.trim()
            ?: return JSONObject().put("ok", false).put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
        if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
            return JSONObject().put("ok", false).put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
        }
        return when (val shot = awaitPhoto(source)) {
            is PhotoCapture.Result.Cancelled ->
                JSONObject().put("ok", false).put("cancelled", true)
            is PhotoCapture.Result.Error ->
                JSONObject().put("ok", false).put("message", shot.message)
            is PhotoCapture.Result.Ok -> {
                val bytes = try {
                    PhotoPrep.prepare(shot.file)
                } finally {
                    photos.discard(shot.file)
                }
                if (bytes == null) {
                    return JSONObject().put("ok", false)
                        .put("message", "Photo illisible ou trop lourde : reprends-la.")
                }
                val image = VisionImage(
                    mime = "image/jpeg",
                    base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                )
                try {
                    val draft = transcribeLesson(
                        provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
                        image = image,
                        apiKey = apiKey,
                    )
                    JSONObject().put("ok", true).put("title", draft.title).put("text", draft.text)
                } catch (e: SecretDetectedException) {
                    JSONObject().put("ok", false).put("message", secretRefusalMessage(e.kind))
                } catch (e: OutputTooLongException) {
                    JSONObject().put("ok", false).put("message", e.userMessage)
                } catch (e: LlmError) {
                    JSONObject().put("ok", false).put("message", e.userMessage)
                } catch (_: AiError) {
                    JSONObject().put("ok", false).put("message", "Transcription hors format : réessaie avec une photo plus nette.")
                } catch (_: Exception) {
                    JSONObject().put("ok", false).put("message", "Transcription impossible : réessaie dans un instant.")
                }
            }
        }
    }

    /**
     * Attend la capture. Le callback de l'activité arrive sur le thread
     * principal ; le résultat est publié au fil du pont via le latch.
     */
    private fun awaitPhoto(source: String): PhotoCapture.Result {
        val latch = CountDownLatch(1)
        var result: PhotoCapture.Result? = null
        photos.capture(source) {
            result = it
            latch.countDown()
        }
        if (!latch.await(AWAIT_PHOTO_MS, TimeUnit.MILLISECONDS)) {
            photos.cancel()
            return PhotoCapture.Result.Error("Photo annulée : délai dépassé.")
        }
        return result ?: PhotoCapture.Result.Error("Photo indisponible : réessaie.")
    }

    private fun lessonJson(note: LessonNote): JSONObject = JSONObject()
        .put("id", note.id)
        .put("subject", note.subject)
        .put("title", note.title)
        .put("text", note.text)
        .put("createdAt", note.createdAt)

    /** Le manuel est-il utilisable pour cette matière, sans réseau ? */
    private fun manualAvailableForSubject(
        subject: String,
        known: List<String>,
    ): Boolean {
        val url = manuals.url() ?: return false
        if (!manuals.isEnabled(subject)) return false
        if (!ManualCatalog.isCatalog(url)) return true
        val classLabel = manuals.classLabel().ifEmpty { cachedProfile?.classLabel.orEmpty() }
        val subjects = (known + subject).distinct()
        return ManualCatalog.resolve(url, classLabel, subjects, subject) != null
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
        // #595 : ASCII imprimable SEUL. OkHttp refuse tout caractère hors
        // 0x20..0x7E dans un en-tête : une clé collée avec NBSP, zéro-largeur
        // ou accent était ENREGISTRÉE puis cassait chaque appel (IAE à
        // l'envoi) — l'élève lisait « Échec de l'assistant. » pour tout,
        // clé « configurée » d'apparence. isWhitespace ne voit PAS le NBSP.
        if (key.any { it.isISOControl() || it.isWhitespace() || it > '~' }) {
            return JSONObject().put("ok", false).put("message", "Caractère interdit dans la clé.")
        }
        return try {
            llmKeys.save(key)
            JSONObject().put("ok", true)
        } catch (_: IllegalArgumentException) {
            JSONObject().put("ok", false).put("message", "Clé LLM refusée.")
        }
    }

    private fun askHomework(p: JSONObject, epoch: Long): JSONObject {
        val id = bounded(p.string("assignmentId"), 128)
        if (id.isEmpty()) throw BridgeFailure("bad_request", "Devoir introuvable.")
        // #369 : la semaine AFFICHÉE : le devoir demandé peut venir d'une
        // semaine non courante (le cache ne porte que la dernière lue).
        val week = bounded(p.string("weekStart"), 10)
        val assignment = loadAssignments(id, week).firstOrNull { it.id == id }
            ?: return JSONObject().put("ok", false).put("message", "Devoir introuvable.")
        val context = aiContextFor(assignment, AiContextEntry.HOMEWORK, week, epoch)
        // #628 : corpus vide = refus DÉTERMINISTE avec CTA, AVANT tout appel
        // payant. L'ancien chemin payait un aller-retour pour lire « aucune
        // source » et n'offrait aucune action.
        if (context.sources.isEmpty()) {
            return refusalJson(context)
        }
        val sources = context.sources.map { it.toHomeworkSource() }
        val question = fr.veryslopnynotes.data.HomeworkRepository.questionFor(assignment)
        val result = await<fr.veryslopnynotes.data.HomeworkResult>(AWAIT_LLM_MS) { cb ->
            // Même délai que les chemins photo (#594) : un modèle gratuit lent
            // ne doit pas mourir à 20 s (« Erreur réseau LLM ») alors que
            // l'attente du pont couvre 45 s.
            OpenRouterHomework(OpenRouterLlm(timeoutMs = AWAIT_LLM_MS), llmKeys).generate(question, sources, cb)
        } ?: return JSONObject().put("ok", false).put("message", "L'assistant n'a pas répondu.")
            .withAiContext(context)
        val outcome = result.outcome
            ?: return JSONObject().put("ok", false)
                .put("message", result.error ?: OpenRouterHomework.GENERIC_ERROR_MESSAGE)
                .withAiContext(context)
        return when (outcome) {
            is HomeworkOutcome.Answer -> homeworkAnswerJson(outcome).withAiContext(context)
            // #416 : le motif du modèle est un texte LIBRE (echo de la consigne
            // possible) : il ne franchit JAMAIS le pont. Le pont rend une
            // phrase française bornée, dans le champ `message` que l'UI lit.
            is HomeworkOutcome.Refused -> homeworkRefusalJson(outcome, context)
        }
    }

    /**
     * Corrigé validé -> réponse de pont BORNÉE (#629) : le texte, les étapes
     * ordonnées et les sources réellement citées traversent la frontière. Le
     * schéma est déjà validé par `HomeworkAi` ; on borne ici ce que l'UI
     * affiche pour qu'un lot de citations ne fasse pas grossir la réponse.
     */
    private fun homeworkAnswerJson(outcome: HomeworkOutcome.Answer): JSONObject =
        JSONObject()
            .put("ok", true)
            .put("answer", outcome.answer.trim().take(Homework.MAX_ANSWER_CHARS))
            .put("steps", JSONArray().apply {
                outcome.steps.take(Homework.MAX_STEPS).forEach {
                    put(it.trim().take(Homework.MAX_STEP_CHARS))
                }
            })
            .put("sources", JSONArray().apply {
                outcome.sources.map { it.trim() }
                    .filter { it.isNotEmpty() }
                    .distinct()
                    .take(Homework.MAX_SOURCES)
                    .forEach { put(it.take(Homework.MAX_LABEL_CHARS)) }
            })

    /**
     * Refus du modèle : la phrase bornée du pont, jamais le motif libre. Les
     * CTA ne sont proposés que pour le refus « sources insuffisantes » ; les
     * autres causes ne reçoivent pas un faux diagnostic.
     */
    private fun homeworkRefusalJson(
        outcome: HomeworkOutcome.Refused,
        context: AiContextResult,
    ): JSONObject {
        val json = JSONObject()
            .put("ok", true)
            .put("refused", true)
            .put("message", homeworkRefusalMessage(outcome.reason))
            .withAiContext(context)
        if (outcome.reason.trim() == Homework.REFUSAL_SOURCES_INSUFFICIENT) {
            json.put("actions", JSONArray(AiContext.REFUSAL_ACTIONS))
        }
        return json
    }

    /**
     * Contexte IA unique pour un devoir (#628/#631). TOUS les points d'entrée
     * (aide texte, photo, fiche, futur chat) partent d'ici : consigne, TOUS
     * les cours Pronote, pièces jointes lisibles, cahier, manuel, web,
     * historique.
     *
     * #631 : les pièces jointes du devoir ET de ses cours sont téléchargées
     * avec le client local (I1), bornées, puis extraites LOCALEMENT en texte
     * (I6 : Untrusted au prompt). Une pièce jointe illisible reste une source
     * NOMMÉE, jamais une exception. Le cache passe par [DownloadedFiles] : il
     * est borné et purgé avec le compte (I26).
     *
     * Les pages web ne sont admises que si leur TEXTE est déjà disponible : une
     * URL ne devient jamais une source inventée (#634).
     */
    private fun aiContextFor(
        assignment: Assignment,
        entry: AiContextEntry,
        week: String = "",
        epoch: Long = SessionEpoch.current(),
        webPages: List<AiContextItem> = emptyList(),
        history: List<AiContextItem> = emptyList(),
    ): AiContextResult {
        val items = mutableListOf<AiContextItem>()
        items.addAll(
            fr.veryslopnynotes.data.HomeworkRepository.contextItems(
                assignment,
                attachmentContextItems(assignment, week, epoch),
            ),
        )
        for (note in LessonNotes.forSubject(lessons.notes(), assignment.subject)) {
            items.add(AiContext.note(note.title, note.text))
        }
        manualDocFor(assignment.subject)?.let { doc ->
            items.add(AiContext.manual(doc.title, doc.excerpt))
        }
        items.addAll(webPages)
        items.addAll(history)
        return AiContext.assembleFor(entry, items)
    }

    /**
     * Sources des pièces jointes d'un devoir, dans l'ordre du payload. Le
     * téléchargement est BORNÉ (nombre, taille) et passe par le cache du
     * compte : une pièce déjà ouverte n'est pas re-téléchargée. Chaque coupe ou
     * échec devient une source nommée, jamais un crash.
     */
    private fun attachmentContextItems(
        assignment: Assignment,
        week: String,
        epoch: Long,
    ): List<AiContextItem> {
        val attachments = assignment.allAttachments()
        if (attachments.isEmpty()) return emptyList()
        val out = mutableListOf<AiContextItem>()
        var visionCalls = 0
        // Budget TOTAL : le plafond d'attente natif (100 s) ne doit pas être
        // dépassé par une pile de téléchargements. Passé le budget, les pièces
        // restantes sont NOMMÉES « délai », jamais perdues en silence.
        val deadline = System.nanoTime() + ATTACHMENT_BUDGET_MS * 1_000_000L
        for ((index, att) in attachments.withIndex()) {
            if (index >= AttachmentText.MAX_ATTACHMENTS || System.nanoTime() > deadline) {
                val remaining = attachments.size - index
                out.add(
                    AiContext.attachmentUnreadable(
                        "$remaining pièces jointes non lues",
                        if (index >= AttachmentText.MAX_ATTACHMENTS) {
                            "Limite de ${AttachmentText.MAX_ATTACHMENTS} pièces jointes par envoi."
                        } else {
                            "Délai de lecture des pièces jointes dépassé : elles n'ont pas été lues."
                        },
                    ),
                )
                break
            }
            val file = attachmentFile(assignment, att, week, epoch)
            if (file == null) {
                out.add(
                    AiContext.attachmentUnreadable(
                        att.label,
                        "Téléchargement indisponible : la pièce jointe n'a pas été lue.",
                    ),
                )
                continue
            }
            val mime = mimeOf(att.label)
            val result = try {
                if (mime.startsWith("image/")) {
                    if (visionCalls >= AttachmentText.MAX_VISION_ATTACHMENTS) {
                        AttachmentTextResult.Unreadable("image_vision")
                    } else {
                        visionCalls += 1
                        imageAttachmentText(file)
                    }
                } else {
                    AttachmentText.extract(att.label, mime, file.readBytes())
                }
            } catch (_: Exception) {
                AttachmentTextResult.Unreadable("extraction_impossible")
            }
            out.add(AttachmentText.toAiContextItem(att.label, result))
        }
        return out
    }

    /**
     * Fichier de pièce jointe dans le cache du compte, ou téléchargé puis écrit
     * sous la garde d'époque. `null` = session changée ou téléchargement refusé :
     * aucun texte n'est ajouté, donc le cache purgé ne ressuscite pas.
     */
    private fun attachmentFile(
        assignment: Assignment,
        att: AssignmentAttachment,
        week: String,
        epoch: Long,
    ): File? {
        val root = File(ctx.cacheDir, DownloadedFiles.ATTACHMENTS)
        DownloadedFiles.cachedFor(root, assignment.id, att.id, att.label)?.let { return it }
        val data = await<fr.veryslopnynotes.data.AttachmentData?> { cb ->
            assignments.fetchAttachment(assignment.id, att.id, week, cb)
        } ?: return null
        if (data.bytes.isEmpty() || data.bytes.size > DownloadedFiles.MAX_BYTES) return null
        return DownloadedFiles.write(root, assignment.id, att.id, att.label, data.bytes, epoch)
    }

    /**
     * Image de pièce jointe -> texte par le MÊME chemin vision que la photo de
     * cours (#587) : ré-encodage JPEG borné (métadonnées retirées), prompt
     * gardé, sortie validée. Aucune clé = source illisible explicite.
     */
    private fun imageAttachmentText(file: File): AttachmentTextResult {
        val apiKey = llmKeys.apiKey()?.trim().orEmpty()
        if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
            return AttachmentTextResult.Unreadable("image_vision_indisponible")
        }
        val bytes = PhotoPrep.prepare(file)
            ?: return AttachmentTextResult.Unreadable("image_vision")
        return try {
            val draft = transcribeLesson(
                provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
                image = VisionImage(
                    mime = "image/jpeg",
                    base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                ),
                apiKey = apiKey,
            )
            if (draft.text.isBlank()) {
                AttachmentTextResult.Unreadable("image_vision")
            } else {
                AttachmentTextResult.Readable(draft.text, false)
            }
        } catch (_: Exception) {
            AttachmentTextResult.Unreadable("image_vision")
        }
    }

    /** Métadonnées « Ce qui est envoyé » : type, libellé, taille, troncature. */
    private fun aiContextJson(context: AiContextResult): JSONArray = JSONArray().apply {
        for (source in context.sources) {
            put(
                JSONObject()
                    .put("type", source.type.wire)
                    .put("label", source.label)
                    .put("chars", source.text.length)
                    .put("truncated", source.truncated),
            )
        }
    }

    private fun JSONObject.withAiContext(context: AiContextResult): JSONObject =
        put("context", aiContextJson(context))
            .put("contextChars", context.totalChars)
            .put("contextOmitted", context.omitted.size)

    /** Refus déterministe du corpus vide, avec CTA stables (jamais de motif libre). */
    private fun refusalJson(context: AiContextResult, ok: Boolean = true): JSONObject {
        val refusal = context.refusal
        return JSONObject()
            .put("ok", ok)
            .put("refused", true)
            .put("message", refusal?.message ?: AiContext.REFUSAL_MESSAGE)
            .put("refusal", refusal?.code ?: AiContext.REFUSAL_CODE)
            .put("actions", JSONArray(refusal?.actions ?: AiContext.REFUSAL_ACTIONS))
            .withAiContext(context)
    }

    /**
     * Photo d'énoncé -> corrigé (#588). Même schéma et mêmes citations que
     * l'aide texte ; la photo est une source citable supplémentaire. Aucun
     * enregistrement du corrigé, aucun effet métier (I7).
     */
    private fun solveHomeworkPhoto(p: JSONObject, epoch: Long): JSONObject {
        val id = bounded(p.string("assignmentId"), 128)
        if (id.isEmpty()) throw BridgeFailure("bad_request", "Devoir introuvable.")
        val week = bounded(p.string("weekStart"), 10)
        val assignment = loadAssignments(id, week).firstOrNull { it.id == id }
            ?: return JSONObject().put("ok", false).put("message", "Devoir introuvable.")
        val apiKey = llmKeys.apiKey()?.trim()
            ?: return JSONObject().put("ok", false)
                .put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
        if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
            return JSONObject().put("ok", false)
                .put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
        }
        // Même corpus que l'aide texte. Une photo est une source à part entière :
        // un corpus texte vide reste valide pour ce chemin (allowEmpty).
        val context = aiContextFor(assignment, AiContextEntry.PHOTO, week, epoch)
        return when (val shot = awaitPhoto(bounded(p.string("source"), 16).ifEmpty { "camera" })) {
            is PhotoCapture.Result.Cancelled -> JSONObject().put("ok", false).put("cancelled", true)
                .withAiContext(context)
            is PhotoCapture.Result.Error -> JSONObject().put("ok", false).put("message", shot.message)
                .withAiContext(context)
            is PhotoCapture.Result.Ok -> {
                val bytes = try {
                    PhotoPrep.prepare(shot.file)
                } finally {
                    photos.discard(shot.file)
                }
                if (bytes == null) {
                    return JSONObject().put("ok", false)
                        .put("message", "Photo illisible ou trop lourde : reprends-la.")
                        .withAiContext(context)
                }
                try {
                    val outcome = HomeworkAi.generateHomeworkFromPhoto(
                        provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
                        question = fr.veryslopnynotes.data.HomeworkRepository.questionFor(assignment),
                        sources = context.sources.map { it.toHomeworkSource() },
                        image = VisionImage(
                            mime = "image/jpeg",
                            base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                        ),
                        apiKey = apiKey,
                    )
                    when (outcome) {
                        is HomeworkOutcome.Answer ->
                            homeworkAnswerJson(outcome).withAiContext(context)
                        is HomeworkOutcome.Refused ->
                            homeworkRefusalJson(outcome, context)
                    }
                } catch (e: SecretDetectedException) {
                    JSONObject().put("ok", false).put("message", secretRefusalMessage(e.kind))
                        .withAiContext(context)
                } catch (e: OutputTooLongException) {
                    JSONObject().put("ok", false).put("message", e.userMessage)
                        .withAiContext(context)
                } catch (e: LlmError) {
                    JSONObject().put("ok", false).put("message", e.userMessage)
                        .withAiContext(context)
                } catch (_: AiError) {
                    JSONObject().put("ok", false)
                        .put("message", "Réponse de l'assistant hors format : réessaie avec une photo plus nette.")
                        .withAiContext(context)
                } catch (_: Exception) {
                    JSONObject().put("ok", false).put("message", "Aide photo indisponible : réessaie dans un instant.")
                        .withAiContext(context)
                }
            }
        }
    }

    /**
     * Fiche de révision locale : même pipeline validé que le reste de l'app
     * (`RevisionAi.requestRevisionSheet` + `assembleRevisionSheet`), clé lue à
     * l'appel, sortie contrôlée par core (I4/I5). Aucune donnée du devoir ne
     * sort de l'appareil ailleurs que dans ce prompt OpenRouter déclaré comme
     * donnée (I6).
     */
    private fun generateRevision(p: JSONObject, epoch: Long): JSONObject {
        val id = bounded(p.string("assignmentId"), 128)
        val store = revisions ?: throw BridgeFailure("unavailable", "Stockage des fiches indisponible.")
        // #369 comme l'aide devoirs (#596) : la semaine AFFICHÉE. Le repli
        // réseau sans semaine ne couvre que now−7 j / now+21 j — un devoir
        // affiché hors de cette fenêtre était « introuvable ».
        val week = bounded(p.string("weekStart"), 10)
        val assignment = loadAssignments(id, week).firstOrNull { it.id == id }
            ?: return JSONObject().put("ok", false).put("message", "Devoir introuvable.")
        // #628 : la fiche part du MÊME assembleur que l'aide texte et la photo.
        // Le corpus est évalué AVANT la clé : un devoir sans source refuse avec
        // CTA de façon déterministe, même sans clé configurée.
        val context = aiContextFor(assignment, AiContextEntry.REVISION, week, epoch)
        val chunks = context.sources.map { RevisionChunk(it.text, it.label) }
        if (chunks.isEmpty()) {
            // Corpus vide : refus déterministe + CTA, aucun appel payant.
            return refusalJson(context, ok = false)
        }
        val apiKey = llmKeys.apiKey()?.trim()
            ?: return JSONObject().put("ok", false)
                .put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
        // Clé trop courte = refus AVANT l'appel : pas d'aller-retour inutile,
        // et un message qui dit la vraie cause (« clé absente »).
        if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
            return JSONObject().put("ok", false)
                .put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
        }
        val date = assignment.dueDate.take(10)
        if (date.length != 10) {
            return JSONObject().put("ok", false).put("message", "Devoir sans date exploitable.")
                .withAiContext(context)
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
            // #594 : même délai que l'aide photo — la fiche (manuel + consigne)
            // prend souvent plus de 20 s sur un modèle gratuit.
            val sheet = RevisionAi.requestRevisionSheet(OpenRouterLlm(timeoutMs = AWAIT_LLM_MS), exam, chunks, apiKey)
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
                assembleRevisionSheet(candidate, sheet, chunks.map { it.source }),
                epoch,
            )
            if (!saved) {
                return JSONObject().put("ok", false)
                    .put("message", "Session modifiée : fiche non enregistrée.")
                    .withAiContext(context)
            }
            JSONObject().put("ok", true).withAiContext(context)
        } catch (e: SecretDetectedException) {
            // #409 : un SECRET dans le cours (forme detectee par la garde I4).
            // On dit POURQUOI (le type), jamais le secret. Cette branche passe
            // AVANT le repli generique, sinon un secret serait affiche comme
            // une sortie hors format.
            JSONObject().put("ok", false).put("message", secretRefusalMessage(e.kind))
                .withAiContext(context)
        } catch (e: OutputTooLongException) {
            // #411 : la sortie depasse la garde I5. « Format attendu » serait
            // un diagnostic FAUX (la fiche est bien formee, juste trop longue) :
            // on nomme la LIMITE REELLE.
            JSONObject().put("ok", false).put("message", e.userMessage)
                .withAiContext(context)
        } catch (e: LlmError) {
            // Cause identifiée (clé, crédits, modèle, quota, réseau) : message
            // précis, distinct du repli « fiche non générée » (#359).
            JSONObject().put("ok", false).put("message", e.userMessage)
                .withAiContext(context)
        } catch (e: Exception) {
            // La cause RÉELLE, en français et bornée : « Fiche non générée. »
            // avalait tout, sortie invalide comprise (#367). Jamais le message
            // brut de l'exception : il peut nommer un compte ou un hôte.
            JSONObject().put("ok", false)
                .put("message", revisionFailureMessage(revisionFailure(e)))
                .withAiContext(context)
        }
    }

    /**
     * Exercices du manuel (#632) : proposition LOCALE, sans appel payant.
     *
     * Le texte vient du manuel déjà extrait par le scraper (ou du cahier de
     * cours). On ne fabrique jamais un énoncé : sans marqueur numéroté, la
     * liste est vide et l'UI propose d'ajouter une source. `hint` (page ou
     * chapitre libre) ne fait que FILTRER les énoncés déjà extraits.
     */
    private fun exercisesPropose(p: JSONObject): JSONObject {
        val subject = bounded(p.string("subject"), TeacherChat.MAX_SUBJECT_CHARS)
        if (subject.isEmpty()) {
            return JSONObject().put("ok", false).put("message", "Choisis une matière.")
        }
        val hint = bounded(p.string("hint"), Exercises.MAX_HINT_CHARS)
        val doc = manualDocFor(subject)
        val subjects = knownSubjects()
        val manualReady = manualAvailableForSubject(subject, subjects)
        val found = mutableListOf<fr.veryslopnynotes.core.Exercise>()
        doc?.let { manual ->
            found.addAll(
                Exercises.extract(
                    text = manual.excerpt,
                    page = manual.page,
                    source = "Manuel : ${manual.title}",
                    max = Exercises.MAX_EXERCISES,
                ),
            )
        }
        for (note in LessonNotes.forSubject(lessons.notes(), subject)) {
            found.addAll(
                Exercises.extract(
                    text = note.text,
                    page = 0,
                    source = "Cahier : ${note.title}",
                    max = Exercises.MAX_EXERCISES,
                ),
            )
        }
        val unique = found.distinctBy { it.statement.lowercase() }
        val items = Exercises.filter(unique, hint).take(Exercises.MAX_EXERCISES)
        val json = JSONObject()
            .put("ok", true)
            .put("manual", doc != null)
            .put("manualReady", manualReady)
            .put("manualTitle", doc?.title ?: "")
            .put("manualPage", doc?.page ?: 0)
            .put("exercises", JSONArray().apply {
                for (item in items) {
                    put(
                        JSONObject()
                            .put("number", item.number)
                            .put("statement", item.statement)
                            .put("page", item.page)
                            .put("difficulty", item.difficulty)
                            .put("source", item.source),
                    )
                }
            })
        if (items.isEmpty()) {
            json.put(
                "message",
                if (hint.isNotEmpty()) {
                    "Aucun exercice ne correspond à « $hint » dans le manuel ou le cahier."
                } else {
                    "Aucun exercice numéroté lisible dans le manuel ou le cahier de cette matière."
                },
            )
            val actions = mutableListOf("add_course")
            if (!manualReady) actions.add(0, "enable_manual")
            json.put("actions", JSONArray(actions))
        }
        return json
    }

    /**
     * Aide progressive sur UN exercice (#632) : indice, méthode ou correction
     * complète (choix explicite du web). La réponse de l'élève (texte ou photo)
     * est une DONNÉE Untrusted. Aucun effet Pronote, aucune écriture.
     */
    private fun exercisesHelp(p: JSONObject): JSONObject {
        val subject = bounded(p.string("subject"), TeacherChat.MAX_SUBJECT_CHARS)
        if (subject.isEmpty()) {
            return JSONObject().put("ok", false).put("message", "Choisis une matière.")
        }
        val number = bounded(p.string("number"), Exercises.MAX_NUMBER_CHARS)
        val statement = bounded(p.string("statement"), Exercises.MAX_STATEMENT_CHARS)
        if (statement.isEmpty()) {
            return JSONObject().put("ok", false).put("message", "Choisis un exercice.")
        }
        val mode = ExerciseHelpMode.fromWire(p.string("mode")) ?: ExerciseHelpMode.HINT
        val apiKey = llmKeys.apiKey()?.trim()
            ?: return JSONObject().put("ok", false)
                .put("code", "key")
                .put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
        if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
            return JSONObject().put("ok", false)
                .put("code", "key")
                .put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
        }
        var studentAnswer = bounded(p.string("answer"), Exercises.MAX_ANSWER_CHARS)
        val photoSource = bounded(p.string("photoSource"), 16)
        if (photoSource == "camera" || photoSource == "gallery") {
            when (val shot = awaitPhoto(photoSource)) {
                is PhotoCapture.Result.Cancelled -> return JSONObject().put("ok", false).put("cancelled", true)
                is PhotoCapture.Result.Error ->
                    return JSONObject().put("ok", false).put("message", shot.message)
                is PhotoCapture.Result.Ok -> {
                    val bytes = try {
                        PhotoPrep.prepare(shot.file)
                    } finally {
                        photos.discard(shot.file)
                    }
                    if (bytes == null) {
                        return JSONObject().put("ok", false)
                            .put("message", "Photo illisible ou trop lourde : reprends-la.")
                    }
                    studentAnswer = try {
                        transcribeLesson(
                            provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
                            image = VisionImage(
                                mime = "image/jpeg",
                                base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                            ),
                            apiKey = apiKey,
                        ).text
                    } catch (e: SecretDetectedException) {
                        return JSONObject().put("ok", false).put("code", "secret")
                            .put("message", secretRefusalMessage(e.kind))
                    } catch (e: OutputTooLongException) {
                        return JSONObject().put("ok", false).put("code", "format").put("message", e.userMessage)
                    } catch (_: Exception) {
                        return JSONObject().put("ok", false).put("code", "format")
                            .put("message", "Photo illisible : reprends-la ou écris ta réponse.")
                    }
                    if (studentAnswer.isBlank()) {
                        return JSONObject().put("ok", false).put("code", "format")
                            .put("message", "Aucune réponse lisible sur la photo : reprends-la ou écris ta réponse.")
                    }
                }
            }
        }
        // L'énoncé est la source la PLUS prioritaire : il vient de la page que
        // l'élève a choisie, pas d'une reconstitution du modèle.
        val label = "Exercice ${number.ifEmpty { "?" }}"
        val items = mutableListOf(
            AiContextItem(AiContextType.ASSIGNMENT, label, statement),
        )
        for (source in aiContextForSubject(subject, emptyList()).sources) {
            items.add(
                AiContextItem(
                    type = source.type,
                    label = source.label,
                    text = source.text,
                    truncated = source.truncated,
                    originalChars = source.originalChars,
                ),
            )
        }
        val context = AiContext.assembleFor(AiContextEntry.REVISION, items)
        if (context.sources.isEmpty()) return refusalJson(context, ok = false)
        return try {
            val reply = Exercises.requestHelp(
                provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
                mode = mode,
                context = context,
                exerciseNumber = number,
                statement = statement,
                studentAnswer = studentAnswer,
                apiKey = apiKey,
            )
            JSONObject()
                .put("ok", true)
                .put("answer", reply.answer)
                .put("sources", JSONArray(reply.sources))
                .put("unsourced", reply.unsourced)
                .put("mode", mode.wire)
                .withAiContext(context)
        } catch (e: SecretDetectedException) {
            JSONObject().put("ok", false).put("code", "secret").put("message", secretRefusalMessage(e.kind))
                .withAiContext(context)
        } catch (e: OutputTooLongException) {
            JSONObject().put("ok", false).put("code", "format").put("message", e.userMessage)
                .withAiContext(context)
        } catch (e: LlmError) {
            JSONObject().put("ok", false).put("code", teacherFailureCode(e)).put("message", e.userMessage)
                .withAiContext(context)
        } catch (e: AiError) {
            JSONObject().put("ok", false)
                .put("code", teacherFailureCode(e))
                .put("message", "Réponse du professeur illisible ou vide : réessaie.")
                .withAiContext(context)
        } catch (_: Exception) {
            JSONObject().put("ok", false)
                .put("code", "network")
                .put("message", "Le professeur est indisponible : réessaie dans un instant.")
                .withAiContext(context)
        }
    }

    /**
     * Professeur IA contextualisé (#633) : un tour de conversation sur le
     * corpus de la matière. Aucun outil, aucun secret dans le prompt, aucun
     * effet métier : le modèle rend un texte + des libellés cités.
     *
     * Le corpus vient de l'assembleur UNIQUE (#628), avec l'historique borné
     * (CHAT). Les tours anciens sont résumés localement, sans appel payant.
     * Une réponse sans citation est marquée `unsourced` (jamais masquée).
     */
    private fun teacherTurn(p: JSONObject): JSONObject {
        val subject = bounded(p.string("subject"), TeacherChat.MAX_SUBJECT_CHARS)
        if (subject.isEmpty()) {
            return JSONObject().put("ok", false).put("message", "Choisis une matière.")
        }
        val message = bounded(p.string("message"), TeacherChat.MAX_MESSAGE_CHARS)
        if (message.isEmpty()) {
            return JSONObject().put("ok", false).put("message", "Écris ta question.")
        }
        val mode = TeacherMode.fromWire(p.string("mode")) ?: TeacherMode.EXPLAIN
        val history = teacherHistory(p.optJSONArray("history"))
        val summary = TeacherChat.summaryOf(history)
        val context = aiContextForSubject(subject, history)
        // Corpus vide = refus DÉTERMINISTE avec CTA, AVANT tout appel payant.
        // Un contexte qui ne porte QUE l'historique n'est PAS une source : sans
        // matière (cahier, manuel, page web), aucun appel payant n'est lancé.
        if (context.sources.isEmpty() || context.sources.none { it.type != AiContextType.HISTORY }) {
            return refusalJson(context, ok = false).withTeacherHistory(context, summary.length)
        }
        val apiKey = llmKeys.apiKey()?.trim()
            ?: return JSONObject().put("ok", false)
                .put("code", "key")
                .put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
                .withTeacherHistory(context, summary.length)
        if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
            return JSONObject().put("ok", false)
                .put("code", "key")
                .put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
                .withTeacherHistory(context, summary.length)
        }
        return try {
            val reply = TeacherChat.requestTurn(
                provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
                mode = mode,
                context = context,
                message = message,
                summary = summary,
                apiKey = apiKey,
            )
            JSONObject()
                .put("ok", true)
                .put("answer", reply.answer)
                .put("sources", JSONArray(reply.sources))
                .put("unsourced", reply.unsourced)
                .withTeacherHistory(context, summary.length)
        } catch (e: SecretDetectedException) {
            JSONObject().put("ok", false).put("code", "secret").put("message", secretRefusalMessage(e.kind))
                .withTeacherHistory(context, summary.length)
        } catch (e: OutputTooLongException) {
            JSONObject().put("ok", false).put("code", "format").put("message", e.userMessage)
                .withTeacherHistory(context, summary.length)
        } catch (e: LlmError) {
            JSONObject().put("ok", false).put("code", teacherFailureCode(e)).put("message", e.userMessage)
                .withTeacherHistory(context, summary.length)
        } catch (e: AiError) {
            JSONObject().put("ok", false)
                .put("code", teacherFailureCode(e))
                .put("message", "Réponse du professeur illisible ou vide : réessaie.")
                .withTeacherHistory(context, summary.length)
        } catch (_: Exception) {
            JSONObject().put("ok", false)
                .put("code", "network")
                .put("message", "Le professeur est indisponible : réessaie dans un instant.")
                .withTeacherHistory(context, summary.length)
        }
    }

    /**
     * Code STABLE d'un échec de tour : l'UI choisit le message et le geste
     * (clé, quota, timeout, vide, réseau). Jamais un texte d'exception.
     */
    private fun teacherFailureCode(e: Throwable): String = when (e) {
        is SecretDetectedException -> "secret"
        is OutputTooLongException -> "format"
        is LlmError -> when (e.status) {
            401, 403 -> "key"
            402, 429 -> "quota"
            else -> if (e.userMessage.contains("timeout", ignoreCase = true) ||
                e.userMessage.contains("délai", ignoreCase = true)
            ) {
                "timeout"
            } else {
                "network"
            }
        }
        is AiError -> if (e.message?.contains("vide", ignoreCase = true) == true) "empty" else "format"
        else -> "network"
    }

    /**
     * Contexte IA d'une MATIÈRE (pas d'un devoir) : cahier de cours, manuel
     * enregistré, puis historique. Même assembleur et mêmes budgets que #628.
     * #631/#634 pourront ajouter pièces jointes/page web via les paramètres.
     */
    private fun aiContextForSubject(
        subject: String,
        history: List<TeacherChatMessage>,
    ): AiContextResult {
        val items = mutableListOf<AiContextItem>()
        for (note in LessonNotes.forSubject(lessons.notes(), subject)) {
            items.add(AiContext.note(note.title, note.text))
        }
        manualDocFor(subject)?.let { doc ->
            items.add(AiContext.manual(doc.title, doc.excerpt))
        }
        items.addAll(TeacherChat.historyItems(history))
        return AiContext.assembleFor(AiContextEntry.CHAT, items)
    }

    /** Historique reçu du web : borné, validé, jamais une écriture. */
    private fun teacherHistory(raw: JSONArray?): List<TeacherChatMessage> {
        if (raw == null) return emptyList()
        val payload = JSONObject().put("subject", "").put("messages", raw)
        return try {
            parseTeacherThreadOrNull(payload.toString())?.messages ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun JSONObject.withTeacherHistory(context: AiContextResult, summaryChars: Int): JSONObject {
        val historySources = context.sources.filter { it.type == AiContextType.HISTORY }
        return withAiContext(context)
            .put("historyCount", historySources.size)
            .put("historyChars", historySources.sumOf { it.text.length })
            .put("summaryChars", summaryChars)
    }

    /** Fil local : lecture seule, aucune donnée scolaire hors de l'appareil. */
    private fun teacherLoad(): JSONObject = try {
        JSONObject(teacherThreadJson(teacherChat.load()))
    } catch (_: Exception) {
        JSONObject().put("subject", "").put("messages", JSONArray())
    }

    /**
     * Sauvegarde du fil local. Le web envoie la matière + les tours ; le pont
     * borne, valide, puis écrit sous la garde d'époque. Un refus d'écriture
     * n'est JAMAIS un « ok » (I10) : le répertoire purgé ne ressuscite pas.
     */
    private fun teacherSave(p: JSONObject, epoch: Long): JSONObject {
        val rawCount = p.optJSONArray("messages")?.length() ?: 0
        val thread = try {
            parseTeacherThreadOrNull(p.toString())
        } catch (_: Exception) {
            null
        } ?: return JSONObject().put("ok", false).put("message", "Discussion invalide.")
        if (!TeacherChat.isThreadValid(thread)) {
            return JSONObject().put("ok", false).put("message", "Discussion invalide.")
        }
        // Un tour invalide a été ÉCARTÉ par le parseur : ne pas l'enregistrer
        // en silence (le web doit savoir que rien n'a été écrit tel quel).
        val expected = minOf(rawCount, TeacherChat.MAX_STORED_MESSAGES)
        if (thread.messages.size != expected) {
            return JSONObject().put("ok", false).put("message", "Discussion invalide.")
        }
        val bounded = TeacherChat.trimThread(thread)
        if (!teacherChat.save(bounded, epoch)) {
            return JSONObject().put("ok", false)
                .put("message", "Session modifiée : discussion non enregistrée.")
        }
        return JSONObject().put("ok", true).put("count", bounded.messages.size)
    }

    /** Suppression du fil local sous la garde d'époque. */
    private fun teacherDelete(epoch: Long): JSONObject =
        if (!teacherChat.delete(epoch)) {
            JSONObject().put("ok", false).put("message", "Session modifiée : discussion non supprimée.")
        } else {
            JSONObject().put("ok", true)
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

    /**
     * Extrait du manuel pour `subject`. Catalogue = choix par classe/matière ;
     * ouvrage précis = adresse telle quelle. Un ouvrage inconnu de la table ne
     * produit AUCUNE source (jamais un manuel d'une autre matière).
     */
    private fun manualDocFor(subject: String): ManualDoc? {
        // #586 : une matière peut explicitement ne pas utiliser le manuel.
        if (!manuals.isEnabled(subject)) return null
        val stored = manuals.url() ?: return null
        val target = if (ManualCatalog.isCatalog(stored)) {
            val classLabel = cachedProfile?.classLabel?.takeIf { it.isNotBlank() } ?: manuals.classLabel()
            val known = manuals.subjects()
            val subjects = (if (known.isEmpty()) knownSubjects() else known + subject).distinct()
            if (known.isEmpty() && subjects.isNotEmpty()) manuals.saveGuess(classLabel, subjects)
            ManualCatalog.resolve(stored, classLabel, subjects, subject) ?: return null
        } else {
            stored
        }
        manuals.doc(target)?.let { return it }
        val now = System.currentTimeMillis()
        val lastFailure = manualFailures[target] ?: 0L
        if (now - lastFailure < MANUAL_RETRY_MS) return null
        val fetched = ManualsClient(currentBaseUrl()).fetch(target)
        val doc = fetched.doc
        if (doc == null) {
            manualFailures[target] = now
            return null
        }
        manualFailures.remove(target)
        manuals.saveDoc(target, doc)
        return doc
    }

    /**
     * Matières réellement présentes dans les caches (notes, devoirs, EDT) :
     * elles servent à deviner les spécialités, jamais à les inventer. Aucun
     * accès réseau ici — hors ligne, la liste est simplement plus courte.
     */
    private fun knownSubjects(): List<String> {
        val out = LinkedHashSet<String>()
        fun add(raw: String) {
            val subject = raw.trim()
            if (subject.isNotEmpty() && subject.length <= 100) out.add(subject)
        }
        for (payload in repo.payloads(CachePolicy.GRADES)) {
            try {
                val root = JSONObject(payload)
                val averages = root.optJSONObject("averages")?.optJSONArray("subjects")
                for (i in 0 until (averages?.length() ?: 0)) {
                    averages?.optJSONObject(i)?.let { add(it.optString("subject")) }
                }
                val grades = root.optJSONArray("grades")
                for (i in 0 until (grades?.length() ?: 0)) {
                    grades?.optJSONObject(i)?.let { add(it.optString("subject")) }
                }
            } catch (_: Exception) {
                // Payload illisible : il ne prouve aucune matière.
            }
        }
        for (payload in repo.payloads(CachePolicy.ASSIGNMENTS)) {
            try {
                AssignmentsRepository.parse(payload).forEach { add(it.subject) }
            } catch (_: Exception) {
                // Idem : le cache suivant suffira peut-être.
            }
        }
        for (payload in repo.payloads(CachePolicy.TIMETABLE)) {
            try {
                val entries = JSONObject(payload).optJSONArray("entries")
                for (i in 0 until (entries?.length() ?: 0)) {
                    entries?.optJSONObject(i)?.let { add(it.optString("subject")) }
                }
            } catch (_: Exception) {
                // Idem.
            }
        }
        return out.take(ManualStore.MAX_SUBJECTS)
    }

    /** Classe du profil, lue au plus une fois et gardée en mémoire. */
    private fun profileClassLabel(): String {
        cachedProfile?.classLabel?.takeIf { it.isNotBlank() }?.let { return it }
        val result = await<MeResult> { cb -> profileRepo.fetchMe(cb) } ?: return ""
        return when (result) {
            is MeResult.Ok -> {
                cachedProfile = result.profile
                result.profile?.classLabel.orEmpty()
            }
            is MeResult.Err -> {
                sessionOrThrow(result.message)
                ""
            }
        }
    }

    /**
     * Devoirs pour l'assistant : le cache d'abord (TOUTES les semaines en
     * cache, #477), puis une lecture LOCALE de la fenêtre AFFICHÉE si le
     * cache ne porte pas le devoir demandé (#369 : semaine non courante, ou
     * cache purgé par une écriture). `fetchAsync` n'écrase pas le cache.
     */
    private fun loadAssignments(wantedId: String, weekStart: String): List<Assignment> {
        // #570 : le cache garde une entrée par requête (fenêtre de semaine),
        // donc le même devoir peut être présent dans PLUSIEURS payloads : la
        // fusion est DÉDUPLIQUÉE par identifiant (une entrée par devoir).
        val fromCache = repo.payloads(CachePolicy.ASSIGNMENTS)
            .flatMap { payload -> runCatching { AssignmentsRepository.parse(payload) }.getOrDefault(emptyList()) }
            .distinctBy { it.id }
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
            is MeResult.Ok -> {
                cachedProfile = result.profile
                JSONObject()
                    .put("payload", JSONObject().put("user", result.profile?.let { profileJson(it) } ?: JSONObject.NULL).toString())
            }
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
        cachedProfile = profile
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
        private const val THEME_PREFS = "settings"
        private const val THEME_KEY = "theme"

        /** Journal du pont (jamais de secret : cf. le `init` de la classe). */
        private const val TAG = "vsn-bridge"

        /** Attente par défaut d'un dépôt (`await`). */
        const val AWAIT_DEFAULT_MS = 20_000L

        /** Attente de l'appel LLM : le plus long du pont. */
        const val AWAIT_LLM_MS = 45_000L

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
        private const val MANUAL_RETRY_MS = 10 * 60 * 1000L

        /**
         * Budget TOTAL de lecture des pièces jointes (#631) : il tient dans le
         * plafond d'attente natif (défaut + manuel + LLM) pour que le JS ne
         * perde jamais la réponse. Passé ce délai, les pièces restantes sont
         * nommées « délai dépassé », jamais abandonnées en silence.
         */
        private const val ATTACHMENT_BUDGET_MS = 20_000L

        /**
         * Plafond d'attente natif : le chemin le plus long (chargement des
         * devoirs 20 s + manuel 35 s + appel LLM 45 s). Le JS doit attendre
         * PLUS que ce plafond, sinon il abandonne avant la réponse native et
         * la perd définitivement (#371). Miroir : `web/src/bridge/types.ts`.
         */
        const val MAX_NATIVE_WAIT_MS = AWAIT_DEFAULT_MS + AWAIT_MANUAL_MS + AWAIT_LLM_MS
    }
}
