package fr.veryslopnynotes.app

import fr.veryslopnynotes.core.AiConsentDecision
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.ManualCatalog
import fr.veryslopnynotes.core.ManualUrl
import fr.veryslopnynotes.core.ManualUrlResult
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.ServerUrlResult
import fr.veryslopnynotes.data.AssignmentsRepository
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.ManualDoc
import fr.veryslopnynotes.data.ManualStore
import fr.veryslopnynotes.data.ManualsClient
import fr.veryslopnynotes.data.MeResult
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SessionEpoch
import fr.veryslopnynotes.data.StaleSessionRead
import fr.veryslopnynotes.data.SubjectPrefInput
import fr.veryslopnynotes.data.SubjectPrefRules
import fr.veryslopnynotes.data.SubjectPrefsWrite
import fr.veryslopnynotes.data.manualMatchesSubject
import fr.veryslopnynotes.data.orStale
import org.json.JSONArray
import org.json.JSONObject
import fr.veryslopnynotes.app.VsnBridge.Companion.MANUAL_RETRY_MS

// --- Réglages --------------------------------------------------------------

internal fun VsnBridge.settings(): JSONObject {
    val known = knownSubjects()
    val consent = aiConsent.record()
    return JSONObject()
        .put("theme", theme())
        // Hôte seul, jamais une URL de session ni un jeton.
        .put("serverHost", currentBaseUrl().substringAfter("://").trimEnd('/').take(300))
        .put("llmConfigured", llmKeys.isConfigured())
        // Décision et version : l'interface ne déduit jamais un accord d'une
        // simple présence de clé (PRV-04).
        .put("aiConsent", consent.decision.wire)
        .put("aiConsentVersion", consent.version)
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

internal const val AI_CONSENT_REQUIRED_MESSAGE =
    "Consentement IA requis : lis l’aperçu des données et accepte dans Réglages > Assistant."

/** Refus JSON commun aux chemins IA : aucune clé lue, aucun réseau avant l'accord. */
internal fun VsnBridge.aiConsentRefusal(): JSONObject? =
    if (aiConsent.allowsAi()) {
        null
    } else {
        JSONObject()
            .put("ok", false)
            .put("code", "consent")
            .put("message", AI_CONSENT_REQUIRED_MESSAGE)
    }

/**
 * Point d'écriture UNIQUE du consentement. Un retrait persiste d'abord le
 * refus, puis efface la clé et le fil du professeur : même si un effacement
 * échoue, la porte IA est déjà fermée et l'échec est DIT.
 */
internal fun VsnBridge.setAiConsent(p: JSONObject): JSONObject {
    val decision = AiConsentDecision.fromWire(bounded(p.string("decision"), 16))
    if (decision == AiConsentDecision.NONE) {
        return JSONObject().put("ok", false).put("message", "Choix IA invalide.")
    }
    if (!aiConsent.decide(decision)) {
        return JSONObject().put("ok", false).put("message", "Consentement non enregistré : réessaie dans un instant.")
    }
    val record = aiConsent.record()
    val result = JSONObject()
        .put("ok", true)
        .put("decision", record.decision.wire)
        .put("version", record.version)
    if (decision != AiConsentDecision.WITHDRAWN) return result

    val keyCleared = try {
        llmKeys.clear()
        !llmKeys.isConfigured()
    } catch (_: Exception) {
        false
    }
    val chatCleared = try {
        teacherChat.clear()
    } catch (_: Exception) {
        false
    }
    result.put("keyCleared", keyCleared).put("chatCleared", chatCleared)
    if (!keyCleared || !chatCleared) {
        result.put("ok", false)
            .put("message", "Consentement retiré, mais la clé ou le fil du professeur n’a pas pu être effacé.")
    }
    return result
}

internal fun VsnBridge.saveServer(p: JSONObject, requestId: String): JSONObject? {
    val host = serverHost(p)
    return when (val checked = ServerConfig.validateBaseUrl(host, cleartextPolicy)) {
        is ServerUrlResult.Rejected ->
            JSONObject().put("ok", false).put("message", checked.message)
        is ServerUrlResult.Ok ->
            // Android 17 : l'adresse LAN n'est écrite qu'après l'accord. La
            // réponse est alors différée (`null`) jusqu'au retour du système.
            if (localNetworkPermissionRequired(checked.baseUrl)) {
                requestLocalNetworkPermission(requestId, checked.baseUrl)
            } else {
                completeServerSave(checked.baseUrl)
            }
    }
}

/** `needed` pilote la rationale AVANT de lancer la demande système. */
internal fun VsnBridge.localNetworkStatus(p: JSONObject): JSONObject {
    val checked = ServerConfig.validateBaseUrl(serverHost(p), cleartextPolicy)
    val needed = checked is ServerUrlResult.Ok && localNetworkPermissionRequired(checked.baseUrl)
    return JSONObject().put("needed", needed)
}

private fun VsnBridge.serverHost(p: JSONObject): String {
    var host = bounded(p.string("host"), 300)
    if (!host.contains("://")) {
        // HTTP n'est inféré qu'en debug ; la release reste HTTPS strict (SEC-01).
        val scheme = if (BuildConfig.DEBUG) ServerConfig.schemeFor(host) else "https"
        host = "$scheme://$host"
    }
    return host
}

/** Point d'écriture unique de l'adresse, appelé après la porte réseau local. */
internal fun VsnBridge.completeServerSave(baseUrl: String): JSONObject =
    when (val result = serverStore.save(baseUrl)) {
        is ServerUrlResult.Ok -> {
            // Nouveau scraper = nouvelle chance pour les manuels.
            manualFailures.clear()
            JSONObject().put("ok", true)
        }
        is ServerUrlResult.Rejected ->
            JSONObject().put("ok", false).put("message", result.message)
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
internal fun VsnBridge.saveManualUrl(p: JSONObject): JSONObject {
    val raw = bounded(p.string("url"), ManualUrl.MAX_CHARS)
    if (raw.isEmpty()) {
        if (!manuals.clear()) {
            return JSONObject().put("ok", false)
                .put("message", "Manuel non supprimé : les données locales n'ont pas pu être effacées.")
        }
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

internal fun VsnBridge.dismissManualPrompt(): JSONObject {
    manuals.markPromptSeen()
    return JSONObject().put("ok", true)
}

internal fun VsnBridge.subjectPrefs(): JSONObject = JSONObject()
    .put("prefs", JSONArray().apply { putAllPrefs(prefsRepo.prefs()) })

internal fun VsnBridge.saveSubject(p: JSONObject, epoch: Long): JSONObject {
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


/**
 * Extrait du manuel pour `subject`. Catalogue = choix par classe/matière ;
 * ouvrage précis = adresse telle quelle, mais SEULEMENT si sa fiche parle de
 * cette matière (jamais un manuel d'une autre matière). Un ouvrage inconnu de
 * la table ne produit AUCUNE source.
 */
internal fun VsnBridge.manualDocFor(subject: String, page: Int? = null): ManualDoc? {
    // #586 : une matière peut explicitement ne pas utiliser le manuel.
    if (!manuals.isEnabled(subject)) return null
    val stored = manuals.url() ?: return null
    val catalog = ManualCatalog.isCatalog(stored)
    val target = if (catalog) {
        val classLabel = cachedProfile?.classLabel?.takeIf { it.isNotBlank() } ?: manuals.classLabel()
        val known = manuals.subjects()
        val subjects = (if (known.isEmpty()) knownSubjects() else known + subject).distinct()
        if (known.isEmpty() && subjects.isNotEmpty()) manuals.saveGuess(classLabel, subjects)
        ManualCatalog.resolve(stored, classLabel, subjects, subject) ?: return null
    } else {
        stored
    }
    // Une page précise a SON extrait : la clé de cache la distingue du sommaire.
    val cacheKey = if (page == null) target else "$target#p$page"
    // Le catalogue a déjà choisi l'ouvrage PAR matière ; une adresse précise ne
    // dit rien de la sienne, donc seule la fiche tranche.
    fun matches(doc: ManualDoc): Boolean = catalog || manualMatchesSubject(doc, subject)
    manuals.doc(cacheKey)?.let { doc ->
        if (!matches(doc)) return null
        // Une page non résolue ne vaut pas la page demandée : sans ce contrôle
        // un scrap raté (page 1) serait cité comme « p 192 ».
        if (page == null || doc.page == page) return doc
    }
    val now = System.currentTimeMillis()
    val lastFailure = manualFailures[cacheKey] ?: 0L
    // Horloge reculée : une marque « future » ne bloque pas la reprise.
    if (lastFailure in 1..now && now - lastFailure < MANUAL_RETRY_MS) return null
    val fetched = ManualsClient(currentBaseUrl()).fetch(target, page)
    val doc = fetched.doc
    if (doc == null || (page != null && doc.page != page)) {
        manualFailures[cacheKey] = now
        return null
    }
    manualFailures.remove(cacheKey)
    // Gardé même hors matière : l'adresse rendra toujours le même extrait, le
    // redemander à chaque prompt ne changerait rien.
    manuals.saveDoc(cacheKey, doc)
    return if (matches(doc)) doc else null
}

/**
 * Extraits de toutes les pages citées par la consigne. Une page en échec ne
 * prive pas les autres : chaque extrait reste une source indépendante.
 */
internal fun VsnBridge.manualDocsFor(subject: String, pages: List<Int>): List<ManualDoc> =
    if (pages.isEmpty()) listOfNotNull(manualDocFor(subject))
    else pages.mapNotNull { page -> manualDocFor(subject, page) }

/**
 * Matières réellement présentes dans les caches (notes, devoirs, EDT) :
 * elles servent à deviner les spécialités, jamais à les inventer. Aucun
 * accès réseau ici — hors ligne, la liste est simplement plus courte.
 */
internal fun VsnBridge.knownSubjects(epoch: Long = SessionEpoch.current()): List<String> {
    val out = LinkedHashSet<String>()
    fun add(raw: String) {
        val subject = raw.trim()
        if (subject.isNotEmpty() && subject.length <= 100) out.add(subject)
    }
    for (payload in repo.payloads(CachePolicy.GRADES, epoch = epoch).orStale()) {
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
    for (payload in repo.payloads(CachePolicy.ASSIGNMENTS, epoch = epoch).orStale()) {
        try {
            AssignmentsRepository.parse(payload).forEach { add(it.subject) }
        } catch (_: Exception) {
            // Idem : le cache suivant suffira peut-être.
        }
    }
    for (payload in repo.payloads(CachePolicy.TIMETABLE, epoch = epoch).orStale()) {
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
internal fun VsnBridge.profileClassLabel(): String {
    cachedProfile?.classLabel?.takeIf { it.isNotBlank() }?.let { return it }
    val result = await<MeResult> { cb -> profileRepo.fetchMe(SessionEpoch.current(), cb) } ?: return ""
    return when (result) {
        is MeResult.Ok -> {
            cachedProfile = result.profile
            result.profile?.classLabel.orEmpty()
        }
        is MeResult.Err -> {
            sessionOrThrow(result.message)
            ""
        }
        MeResult.Stale -> throw StaleSessionRead()
    }
}

/**
 * Devoirs pour l'assistant : le cache d'abord (TOUTES les semaines en
 * cache, #477), puis une lecture LOCALE de la fenêtre AFFICHÉE si le
 * cache ne porte pas le devoir demandé (#369 : semaine non courante, ou
 * cache purgé par une écriture). `fetchAsync` n'écrase pas le cache.
 */
internal fun VsnBridge.loadAssignments(wantedId: String, weekStart: String): List<Assignment> {
    // #570 : le cache garde une entrée par requête (fenêtre de semaine),
    // donc le même devoir peut être présent dans PLUSIEURS payloads : la
    // fusion est DÉDUPLIQUÉE par identifiant (une entrée par devoir).
    val fromCache = repo.payloads(CachePolicy.ASSIGNMENTS).orStale()
        .flatMap { payload -> runCatching { AssignmentsRepository.parse(payload) }.getOrDefault(emptyList()) }
        .distinctBy { it.id }
    if (fromCache.any { it.id == wantedId }) return fromCache
    val query = if (weekStart.isNotEmpty()) "weekStart=$weekStart" else ""
    val outcome = await<RefreshOutcome> { cb ->
        repo.fetchAsync(CachePolicy.ASSIGNMENTS, query, cb = cb)
    }
    val payload = when (outcome) {
        is RefreshOutcome.Updated -> outcome.payload
        is RefreshOutcome.OfflineFallback -> outcome.payload
        is RefreshOutcome.Failed -> outcome.cachedPayload
        RefreshOutcome.Stale, null -> null
    } ?: return emptyList()
    return runCatching { AssignmentsRepository.parse(payload) }.getOrDefault(emptyList())
}
