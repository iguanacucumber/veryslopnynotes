package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import fr.veryslopnynotes.core.ManualCatalog
import fr.veryslopnynotes.core.ManualUrl
import fr.veryslopnynotes.core.ManualUrlResult
import fr.veryslopnynotes.core.ServerConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

// Manuel de l'élève, côté appareil :
// - `ManualStore` garde l'adresse choisie (catalogue ou ouvrage précis), les
//   indices de classe/spécialités et les extraits déjà récupérés ;
// - `ManualsClient` confie une adresse au scraper facultatif (jamais à
//   l'établissement).
//
// L'extrait est une DONNÉE externe : il ne sert QUE de source citée, et il est
// marqué Untrusted par le prompt (`HomeworkAi` / `RevisionAi`). Aucune URL ni
// aucun contenu n'est journalisé : l'adresse peut révéler un établissement.

data class ManualDoc(
    val title: String,
    val subject: String,
    val page: Int,
    val excerpt: String,
) {
    /** Bornes du contrat `ManualsScrapeDoc` (shared/contracts/api.ts). */
    fun isValid(): Boolean =
        title.isNotBlank() && title.length <= 200 &&
            subject.isNotBlank() && subject.length <= 100 &&
            page >= 1 &&
            excerpt.isNotBlank() && excerpt.length <= 8000
}

/**
 * L'extrait gardé parle-t-il de la matière demandée ?
 *
 * Une adresse d'ouvrage PRÉCIS ne dit pas sa matière : seule la fiche le dit.
 * La comparaison passe par la clé du catalogue (`ManualCatalog.subjectKey` :
 * casse, accents, « MATHS » et « Mathématiques ») — une seule règle de matière
 * dans l'app.
 *
 * Matière vide ou absente de la table : refus (fail-closed), comme le catalogue
 * (« mieux vaut pas de source qu'un mauvais ouvrage »). Ainsi un extrait de
 * maths ne part jamais dans un devoir d'histoire.
 */
fun manualMatchesSubject(docSubject: String, requested: String): Boolean {
    val wanted = ManualCatalog.subjectKey(requested) ?: return false
    return ManualCatalog.subjectKey(docSubject) == wanted
}

/**
 * Une fiche d'ouvrage précis parle-t-elle de la matière demandée ?
 *
 * Le titre de page (« 1. Relation de divisibilité dans Z ») ne nomme pas
 * toujours la matière ; l'en-tête du manuel, lui, est dans le début de
 * l'extrait. On accepte donc la fiche si son titre OU le début de son extrait
 * porte la matière — jamais le corps entier, où un exercice de maths pourrait
 * citer l'histoire par hasard.
 */
fun manualMatchesSubject(doc: ManualDoc, requested: String): Boolean =
    manualMatchesSubject(doc.subject, requested) ||
        manualMentionsSubject(doc.title, requested) ||
        manualMentionsSubject(doc.excerpt, requested)

internal fun manualMentionsSubject(docText: String, requested: String): Boolean {
    val wanted = ManualCatalog.subjectKey(requested) ?: return false
    // Début seulement : le corps d'un exercice peut citer une autre matière.
    return ManualCatalog.subjectKey(docText.take(1_000)) == wanted
}

/**
 * Une adresse + des extraits, dans des préférences PROPRES (comme le serveur).
 *
 * Les RÉGLAGES d'usage (invitation déjà vue) survivent à une déconnexion ; le
 * CONTENU (adresse, extraits, classe, matières), lui, est la donnée d'UN compte
 * et part avec lui (I16) : [clearAccountData].
 */
class ManualStore(context: Context) {
    /**
     * Données du manuel, dans `offline/` : la purge de compte les efface avec
     * le cache. `prompt_seen` reste dans les préférences (réglage d'interface,
     * jamais une donnée du compte).
     */
    private val file: File? = try {
        File(context.applicationContext.filesDir, "offline/manual.json")
    } catch (_: Exception) {
        null
    }

    private val prefs: SharedPreferences? = try {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    } catch (_: Exception) {
        // Préfs KO = pas de drapeau d'invitation, aucun crash au démarrage.
        null
    }

    private val lock = SerializedUpdate()

    /** Adresse courante revalidée à la lecture (fichier altéré, version passée). */
    fun url(): String? = lock.run {
        try {
            storedUrl(data())
        } catch (e: LocalDataUnreadable) {
            throw e
        } catch (_: Exception) {
            null
        }
    }

    private fun storedUrl(obj: JSONObject): String? =
        obj.optString(KEY_URL, null)?.let { (ManualUrl.validate(it) as? ManualUrlResult.Ok)?.url }

    /** L'invitation a-t-elle déjà été montrée (une seule fois) ? */
    fun promptSeen(): Boolean = try {
        prefs?.getBoolean(KEY_PROMPT_SEEN, false) == true
    } catch (_: Exception) {
        false
    }

    /**
     * Le manuel est-il autorisé pour cette matière ? (défaut : oui)
     *
     * Une matière absente de la table, ou dont l'élève n'utilise pas le
     * manuel, doit pouvoir s'appuyer uniquement sur le cahier de cours.
     */
    fun isEnabled(subject: String): Boolean = !disabledSubjects().contains(normalizeSubject(subject))

    /**
     * Active/désactive le manuel pour une matière. Une matière invalide ou un
     * stockage indisponible renvoie `false` : l'interface ne doit pas annoncer
     * un réglage qui n'a pas été écrit.
     */
    fun setEnabled(subject: String, enabled: Boolean): Boolean {
        val key = normalizeSubject(subject)
        if (key.isEmpty() || key.length > MAX_SUBJECT_CHARS) return false
        return update { obj ->
            val next = disabledSubjects(obj).toMutableSet()
            if (enabled) next.remove(key) else next.add(key)
            obj.put(KEY_DISABLED_SUBJECTS, jsonArray(next.take(MAX_SUBJECTS)).toString())
        }
    }

    private fun disabledSubjects(): Set<String> = storage(emptySet()) { disabledSubjects(data()) }

    private fun disabledSubjects(obj: JSONObject): Set<String> = try {
        val raw = obj.optString(KEY_DISABLED_SUBJECTS, null)
        if (raw.isNullOrBlank()) emptySet() else {
            val arr = JSONArray(raw)
            val out = LinkedHashSet<String>()
            for (i in 0 until arr.length()) {
                val key = normalizeSubject(arr.optString(i))
                if (key.isNotEmpty() && key.length <= MAX_SUBJECT_CHARS) out.add(key)
                if (out.size >= MAX_SUBJECTS) break
            }
            out
        }
    } catch (_: Exception) {
        emptySet()
    }

    private fun normalizeSubject(raw: String): String =
        raw.trim().lowercase(java.util.Locale.ROOT)

    /** Classe lue sur le profil (ex. « TG2 ») au moment de l'enregistrement. */
    fun classLabel(): String = lock.run {
        try {
            storedClassLabel(data())
        } catch (e: LocalDataUnreadable) {
            throw e
        } catch (_: Exception) {
            ""
        }
    }

    private fun storedClassLabel(obj: JSONObject): String =
        obj.optString(KEY_CLASS_LABEL, "").trim().take(64)

    /** Matières réellement vues dans les caches (notes, devoirs, EDT). */
    fun subjects(): List<String> = lock.run {
        try {
            storedSubjects(data())
        } catch (e: LocalDataUnreadable) {
            throw e
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun storedSubjects(obj: JSONObject): List<String> {
        val out = try {
            val raw = obj.optString(KEY_SUBJECTS, null)
            if (raw.isNullOrBlank()) {
                emptyList()
            } else {
                val arr = JSONArray(raw)
                val values = mutableListOf<String>()
                for (i in 0 until arr.length()) {
                    val s = arr.optString(i).trim()
                    if (s.isNotEmpty()) values.add(s.take(100))
                    if (values.size >= MAX_SUBJECTS) break
                }
                values
            }
        } catch (_: Exception) {
            emptyList()
        }
        return out.distinct()
    }

    /**
     * Valide puis persiste. Un refus n'écrit RIEN. Une adresse différente
     * invalide les extraits (ils ne correspondent plus au manuel choisi).
     */
    fun save(raw: String): ManualUrlResult {
        val validated = ManualUrl.validate(raw)
        if (validated !is ManualUrlResult.Ok) return validated
        // L'ancienne adresse se lit DANS la section critique : deux `save`
        // concurrents ne peuvent pas comparer une adresse déjà remplacée.
        val written = update { obj ->
            val previous = storedUrl(obj)
            obj.put(KEY_URL, validated.url)
            if (previous != validated.url) obj.remove(KEY_DOCS)
        }
        if (!written) return STORAGE_KO
        markPromptSeen()
        return validated
    }

    /** « Plus tard » : l'app ne redemandera plus d'elle-même. */
    fun markPromptSeen() {
        try {
            prefs?.edit()?.putBoolean(KEY_PROMPT_SEEN, true)?.apply()
        } catch (_: Exception) {
            // Rien à faire : au pire l'invitation reviendra.
        }
    }

    /**
     * Oublier le manuel (l'invitation reste vue : pas de rappel intempestif).
     * `false` = le fichier n'a pas pu être effacé ; l'interface le dit.
     */
    fun clear(): Boolean {
        val cleared = clearAccountData()
        try {
            prefs?.edit()?.putBoolean(KEY_PROMPT_SEEN, true)?.apply()
        } catch (_: Exception) {
            // Préfs indisponibles : rien n'était de toute façon lisible.
        }
        return cleared
    }

    /**
     * Purge de COMPTE (I16) : déconnexion, session morte, appairage d'un AUTRE
     * compte. La cible, sa sauvegarde et ses copies en quarantaine partent :
     * aucune version antérieure ne doit rendre le manuel du compte précédent.
     *
     * `prompt_seen` RESTE : c'est un réglage d'interface (une invitation déjà
     * montrée), jamais une donnée du compte — et un rappel intempestif à chaque
     * bascule serait un défaut.
     *
     * `false` = le fichier ou les clés héritées survivent : la bascule de compte
     * ne doit pas publier le suivant sur une purge incomplète.
     */
    fun clearAccountData(): Boolean = lock.run {
        // Les préférences d'une version antérieure au fichier durable portent
        // encore les mêmes clés : elles partent aussi (I16). `commit()` est lu :
        // un `apply()` différé pouvait rendre le manuel au force-stop suivant.
        clearManualAccountData(file) {
            prefs?.edit()
                ?.remove(KEY_URL)
                ?.remove(KEY_DOCS)
                ?.remove(KEY_CLASS_LABEL)
                ?.remove(KEY_SUBJECTS)
                ?.remove(KEY_DISABLED_SUBJECTS)
                ?.commit() ?: true
        }
    }

    /** Indices de choix : classe + matières, jamais un profil complet. */
    fun saveGuess(classLabel: String, subjects: List<String>) {
        update { obj ->
            val label = classLabel.trim().take(64).ifEmpty { storedClassLabel(obj) }
            val clean = subjects.map { it.trim().take(100) }
                .filter { it.isNotEmpty() }
                .distinct()
                .take(MAX_SUBJECTS)
                .ifEmpty { storedSubjects(obj) }
            obj.put(KEY_CLASS_LABEL, label)
            obj.put(KEY_SUBJECTS, jsonArray(clean).toString())
        }
    }

    /** Extrait déjà récupéré pour CETTE adresse, ou null. */
    fun doc(url: String): ManualDoc? {
        val item = docs().optJSONObject(url.trim()) ?: return null
        return try {
            val doc = ManualDoc(
                title = item.optString("title").trim(),
                subject = item.optString("subject").trim(),
                page = item.optInt("page", 0),
                excerpt = item.optString("excerpt").trim(),
            )
            if (doc.isValid()) doc else null
        } catch (_: Exception) {
            null
        }
    }

    fun hasDoc(): Boolean {
        val map = docs()
        val keys = map.keys()
        while (keys.hasNext()) {
            if (doc(keys.next()) != null) return true
        }
        return false
    }

    fun saveDoc(url: String, doc: ManualDoc) {
        val key = url.trim()
        if (key.isEmpty() || !doc.isValid()) return
        update { obj ->
            val map = docs(obj)
            map.put(
                key,
                JSONObject()
                    .put("title", doc.title)
                    .put("subject", doc.subject)
                    .put("page", doc.page)
                    .put("excerpt", doc.excerpt)
                    .put("fetchedAt", System.currentTimeMillis()),
            )
            // Cache borné : les ouvrages changent peu, 8 matières suffisent.
            while (map.length() > MAX_DOCS) {
                var oldestKey: String? = null
                var oldest = Long.MAX_VALUE
                val entries = map.keys()
                while (entries.hasNext()) {
                    val entry = entries.next()
                    val at = map.optJSONObject(entry)?.optLong("fetchedAt", 0) ?: 0
                    if (at < oldest) {
                        oldest = at
                        oldestKey = entry
                    }
                }
                if (oldestKey == null) break
                map.remove(oldestKey)
            }
            obj.put(KEY_DOCS, map.toString())
        }
    }

    private fun docs(): JSONObject = storage(JSONObject()) { docs(data()) }

    private fun docs(obj: JSONObject): JSONObject = try {
        val raw = obj.optString(KEY_DOCS, null)
        if (raw.isNullOrBlank()) JSONObject() else JSONObject(raw)
    } catch (_: Exception) {
        JSONObject()
    }

    private fun data(): JSONObject =
        file?.let { DurableFile.read(it, ::parseObject) } ?: legacyData()

    /**
     * Repli des pannes de stockage, sauf [LocalDataUnreadable] : une donnée
     * corrompue est DITE, jamais transformée en valeur vide (#910).
     */
    private inline fun <T> storage(fallback: T, block: () -> T): T = try {
        block()
    } catch (e: LocalDataUnreadable) {
        throw e
    } catch (_: Exception) {
        fallback
    }

    /**
     * Reprise des clés écrites dans `SharedPreferences` avant le fichier
     * durable : une mise à jour de l'app ne doit pas effacer le manuel déjà
     * choisi. La copie n'est retirée qu'après l'écriture réussie du fichier.
     */
    private fun legacyData(): JSONObject {
        val p = prefs ?: return JSONObject()
        return try {
            val obj = JSONObject()
            p.getString(KEY_URL, null)?.let { obj.put(KEY_URL, it) }
            p.getString(KEY_DOCS, null)?.let { obj.put(KEY_DOCS, it) }
            p.getString(KEY_CLASS_LABEL, null)?.let { obj.put(KEY_CLASS_LABEL, it) }
            p.getString(KEY_SUBJECTS, null)?.let { obj.put(KEY_SUBJECTS, it) }
            p.getString(KEY_DISABLED_SUBJECTS, null)?.let { obj.put(KEY_DISABLED_SUBJECTS, it) }
            if (obj.length() == 0) {
                obj
            } else {
                val target = file ?: return obj
                // Même garde d'époque que le cache : une reprise pendant une
                // déconnexion ne ressuscite pas le dossier purgé.
                if (!OfflineArtifacts.writeText(target, obj.toString(), SessionEpoch.current())) {
                    return JSONObject()
                }
                p.edit()
                    .remove(KEY_URL)
                    .remove(KEY_DOCS)
                    .remove(KEY_CLASS_LABEL)
                    .remove(KEY_SUBJECTS)
                    .remove(KEY_DISABLED_SUBJECTS)
                    .apply()
                obj
            }
        } catch (_: Exception) {
            JSONObject()
        }
    }

    private fun parseObject(raw: String): JSONObject? = try {
        JSONObject(raw)
    } catch (_: Exception) {
        null
    }

    private fun update(block: (JSONObject) -> Unit): Boolean {
        val target = file ?: return false
        return lock.run {
            try {
                val obj = data()
                block(obj)
                // Garde d'époque partagée avec notes/chat/préfs : une écriture
                // en vol pendant la purge de compte est REFUSÉE.
                OfflineArtifacts.writeText(target, obj.toString(), SessionEpoch.current())
            } catch (e: LocalDataUnreadable) {
                // `data()` a levé : ne jamais remplacer la cible corrompue.
                throw e
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun jsonArray(values: Collection<String>): JSONArray {
        val arr = JSONArray()
        for (value in values) arr.put(value)
        return arr
    }

    companion object {
        const val PREFS = "manual"
        const val MAX_DOCS = 8
        const val MAX_SUBJECTS = 32
        const val MAX_SUBJECT_CHARS = 64
        private const val KEY_URL = "url"
        private const val KEY_PROMPT_SEEN = "prompt_seen"
        private const val KEY_DOCS = "docs"
        private const val KEY_CLASS_LABEL = "class_label"
        private const val KEY_SUBJECTS = "subjects"
        private const val KEY_DISABLED_SUBJECTS = "disabled_subjects"
        private val STORAGE_KO = ManualUrlResult.Rejected(
            "Manuel non enregistré (stockage indisponible) : réessaie.",
        )
    }
}

/**
 * Appel au scraper facultatif. Base = adresse choisie dans Réglages (validée
 * par `ServerConfig`) : l'app ne contacte jamais l'hôte du manuel elle-même.
 */
class ManualsClient(
    private val baseUrl: String,
    private val client: OkHttpClient = OkHttpClient(),
) {
    data class Fetch(val doc: ManualDoc?, val error: String?)

    fun fetch(startUrl: String, page: Int? = null): Fetch {
        if (!baseUrl.contains("://")) {
            return Fetch(null, "Scraper non configuré : renseigne son adresse dans Réglages.")
        }
        val payload = JSONObject()
            .put("platform", PLATFORM)
            .put("startUrl", startUrl)
            .apply { if (page != null && page >= 1) put("page", page) }
            .toString()
        val request = Request.Builder()
            .url(ServerConfig.manualsScrapeUrl(baseUrl))
            .post(payload.toRequestBody(JSON))
            .build()
        val http = client.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .readTimeout(READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .callTimeout(CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .build()
        return try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val body = response.peekBody(MAX_ERROR_BYTES).string()
                    return Fetch(null, messageFor(response.code, errorCode(body)))
                }
                val body = response.peekBody(MAX_BODY_BYTES).string()
                parse(body)
            }
        } catch (_: Exception) {
            // Jamais l'exception brute : elle peut nommer l'hôte du scraper.
            Fetch(null, "Scraper injoignable : vérifie son adresse dans Réglages.")
        }
    }

    private fun parse(body: String): Fetch {
        val docs = try {
            JSONObject(body).optJSONArray("docs")
        } catch (_: Exception) {
            null
        } ?: return Fetch(null, "Réponse du scraper illisible.")
        for (i in 0 until docs.length()) {
            val item = docs.optJSONObject(i) ?: continue
            val doc = ManualDoc(
                title = item.optString("title").trim(),
                subject = item.optString("subject").trim(),
                page = item.optInt("page", 0),
                excerpt = item.optString("excerpt").trim(),
            )
            if (doc.isValid()) return Fetch(doc, null)
        }
        return Fetch(null, "Aucun texte lisible sur cette page.")
    }

    /** Code d'erreur du scraper (`{"error":{"code":…}}`), jamais son message brut. */
    private fun errorCode(body: String): String? = try {
        JSONObject(body).optJSONObject("error")?.optString("code")?.takeIf { it.isNotBlank() }
    } catch (_: Exception) {
        null
    }

    companion object {
        /** Nom symbolique envoyé au scraper : ni un hôte, ni une donnée perso. */
        const val PLATFORM = "manuel"
        const val CONNECT_TIMEOUT_MS = 5_000L
        const val READ_TIMEOUT_MS = 32_000L
        const val CALL_TIMEOUT_MS = 35_000L
        /** Réponses bornées : le scraper est choisi par l'utilisateur. */
        const val MAX_BODY_BYTES = 256L * 1024L
        const val MAX_ERROR_BYTES = 4L * 1024L

        private val JSON = "application/json; charset=utf-8".toMediaType()

        fun messageFor(status: Int, code: String? = null): String = when (code) {
            "login_required" -> "Page de connexion détectée : renouvelle la session du scraper."
            "unresolved_host" -> "Nom d'hôte introuvable : vérifie l'adresse du manuel."
            "timeout" -> "Le scraper a dépassé le délai : réessaie."
            "private_host" -> "Adresse privée refusée par le scraper."
            "not_implemented" -> "Le scraper n'a pas de navigateur disponible."
            else -> when (status) {
                400 -> "Adresse refusée par le scraper."
                403 -> "Adresse privée refusée par le scraper."
                404 -> "Scraper introuvable : vérifie son adresse dans Réglages."
                501 -> "Le scraper n'a pas de navigateur disponible."
                502 -> "Le scraper n'a pas pu lire cette page."
                504 -> "Le scraper a dépassé le délai : réessaie."
                else -> "Le scraper a refusé la page (HTTP $status)."
            }
        }
    }
}
