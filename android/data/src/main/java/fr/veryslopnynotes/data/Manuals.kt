package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import fr.veryslopnynotes.core.ManualUrl
import fr.veryslopnynotes.core.ManualUrlResult
import fr.veryslopnynotes.core.ServerConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
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
 * Une adresse + des extraits, dans des préférences PROPRES (comme le serveur,
 * elles survivent à une déconnexion : ce sont des réglages, pas des données
 * de compte).
 */
class ManualStore(context: Context) {
    private val prefs: SharedPreferences? = try {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    } catch (_: Exception) {
        // Préfs KO = pas de manuel, aucun crash au démarrage.
        null
    }

    /** Adresse courante revalidée à la lecture (prefs altérées, version passée). */
    fun url(): String? {
        val stored = try {
            prefs?.getString(KEY_URL, null)
        } catch (_: Exception) {
            null
        } ?: return null
        return (ManualUrl.validate(stored) as? ManualUrlResult.Ok)?.url
    }

    /** L'invitation a-t-elle déjà été montrée (une seule fois) ? */
    fun promptSeen(): Boolean = try {
        prefs?.getBoolean(KEY_PROMPT_SEEN, false) == true
    } catch (_: Exception) {
        false
    }

    /** Classe lue sur le profil (ex. « TG2 ») au moment de l'enregistrement. */
    fun classLabel(): String = try {
        prefs?.getString(KEY_CLASS_LABEL, null)?.trim()?.take(64).orEmpty()
    } catch (_: Exception) {
        ""
    }

    /** Matières réellement vues dans les caches (notes, devoirs, EDT). */
    fun subjects(): List<String> {
        val raw = try {
            prefs?.getString(KEY_SUBJECTS, null)
        } catch (_: Exception) {
            null
        } ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val out = mutableListOf<String>()
            for (i in 0 until arr.length()) {
                val s = arr.optString(i).trim()
                if (s.isNotEmpty()) out.add(s.take(100))
                if (out.size >= MAX_SUBJECTS) break
            }
            out.distinct()
        } catch (_: Exception) {
            emptyList()
        }
    }

    /**
     * Valide puis persiste. Un refus n'écrit RIEN. Une adresse différente
     * invalide les extraits (ils ne correspondent plus au manuel choisi).
     */
    fun save(raw: String): ManualUrlResult {
        val validated = ManualUrl.validate(raw)
        if (validated !is ManualUrlResult.Ok) return validated
        val p = prefs ?: return STORAGE_KO
        return try {
            val previous = p.getString(KEY_URL, null)
            p.edit().putString(KEY_URL, validated.url).putBoolean(KEY_PROMPT_SEEN, true).apply()
            if (previous != validated.url) clearDocs()
            validated
        } catch (_: Exception) {
            STORAGE_KO
        }
    }

    /** « Plus tard » : l'app ne redemandera plus d'elle-même. */
    fun markPromptSeen() {
        try {
            prefs?.edit()?.putBoolean(KEY_PROMPT_SEEN, true)?.apply()
        } catch (_: Exception) {
            // Rien à faire : au pire l'invitation reviendra.
        }
    }

    /** Oublier le manuel (l'invitation reste vue : pas de rappel intempestif). */
    fun clear() {
        try {
            prefs?.edit()
                ?.remove(KEY_URL)
                ?.remove(KEY_DOCS)
                ?.remove(KEY_CLASS_LABEL)
                ?.remove(KEY_SUBJECTS)
                ?.putBoolean(KEY_PROMPT_SEEN, true)
                ?.apply()
        } catch (_: Exception) {
            // Préfs indisponibles : rien n'était de toute façon lisible.
        }
    }

    /** Indices de choix : classe + matières, jamais un profil complet. */
    fun saveGuess(classLabel: String, subjects: List<String>) {
        val label = classLabel.trim().take(64).ifEmpty { this.classLabel() }
        val clean = subjects.map { it.trim().take(100) }
            .filter { it.isNotEmpty() }
            .distinct()
            .take(MAX_SUBJECTS)
            .ifEmpty { this.subjects() }
        try {
            prefs?.edit()
                ?.putString(KEY_CLASS_LABEL, label)
                ?.putString(KEY_SUBJECTS, JSONArray(clean).toString())
                ?.apply()
        } catch (_: Exception) {
            // Le manuel reste utilisable : le choix retombera sur la matière.
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
        val map = docs()
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
        writeDocs(map)
    }

    private fun docs(): JSONObject = try {
        val raw = prefs?.getString(KEY_DOCS, null)
        if (raw.isNullOrBlank()) JSONObject() else JSONObject(raw)
    } catch (_: Exception) {
        JSONObject()
    }

    private fun writeDocs(map: JSONObject) {
        try {
            prefs?.edit()?.putString(KEY_DOCS, map.toString())?.apply()
        } catch (_: Exception) {
            // L'adresse reste enregistrée : l'assistant utilisera le cours seul.
        }
    }

    private fun clearDocs() {
        try {
            prefs?.edit()?.remove(KEY_DOCS)?.apply()
        } catch (_: Exception) {
            // Rien à purger.
        }
    }

    companion object {
        const val PREFS = "manual"
        const val MAX_DOCS = 8
        const val MAX_SUBJECTS = 32
        private const val KEY_URL = "url"
        private const val KEY_PROMPT_SEEN = "prompt_seen"
        private const val KEY_DOCS = "docs"
        private const val KEY_CLASS_LABEL = "class_label"
        private const val KEY_SUBJECTS = "subjects"
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

    fun fetch(startUrl: String): Fetch {
        if (!baseUrl.contains("://")) {
            return Fetch(null, "Scraper non configuré : renseigne son adresse dans Réglages.")
        }
        val payload = JSONObject()
            .put("platform", PLATFORM)
            .put("startUrl", startUrl)
            .put("headless", true)
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
