package fr.veryslopnynotes.core

// Garde LLM I4/I5 : sans outils, sans reseau, sans secrets. Sortie texte/JSON validee.
// Port fidele de server/ai/guard.ts (supprimé en #210 : ce port est la source
// de vérité). Aucun acces reseau/env/outil ici (scan
// check-architecture). Stdlib + java.util uniquement, sans dependance.
// Les appels provider sont BLOQUANTS (pas de coroutines sans dependance,
// meme doctrine que le module pronote) : jamais sur le thread UI.
//
// --- Le plafond de sortie I5 (#411) : UN SEUL endroit, des bornes LIEES ---
//
// Le fournisseur compte en TOKENS, la garde compte en CARACTERES. Les deux
// plafonds doivent tenir ensemble : sinon une reponse VALIDE est payée au
// fournisseur puis jetee par la garde (« sortie LLM trop longue (I5) »), et
// l'eleve lit « Echec de l'assistant. ».
//
// AVANT (#411) : `MAX_OUTPUT_TOKENS = 4000` justifie par « ~2 caracteres/token »
// — une hypothèse FAUSSE pour le francais et le JSON (~3-4 caracteres/token).
// Le fournisseur produisait donc ~12-16 k caracteres pour une garde a 8 000 :
// une reponse VALIDE de 9 000 caracteres (finish_reason=stop) etait jetee.
//
// MAINTENANT : le budget de tokens est DEDUIT du plafond de caracteres, avec
// la borne HAUTE de densite (4 caracteres/token : texte dense, anglais, code,
// longs identifiants). Le budget du fournisseur ne peut donc pas produire une
// sortie plus longue que la garde — et la garde nomme la LIMITE REELLE quand
// elle refuse.

/**
 * Plafond de caracteres d'une sortie LLM (garde I5) : 12 000 caracteres.
 *
 * Assez pour ce que le fournisseur peut produire (3 000 tokens, cf.
 * [MAX_OUTPUT_TOKENS]) : la garde ne jette plus une reponse valide.
 */
const val MAX_OUTPUT_CHARS = 12000

/**
 * Densite de reference d'un token : 4 caracteres par token.
 *
 * Le francais est plus dense en tokens (~3 caracteres/token) ; 4 est la
 * borne HAUTE plausible (anglais dense, code, longs identifiants). On
 * retient cette borne : le budget de tokens deduit ne peut alors pas
 * produire une sortie plus longue que la garde.
 */
const val CHARS_PER_TOKEN = 4

/**
 * Budget de tokens du fournisseur : DEDUIT du plafond de caracteres
 * (arrondi en bas : jamais plus de tokens que le budget de la garde).
 *
 * 3 000 tokens x 4 caracteres/token = 12 000 caracteres : la sortie que le
 * fournisseur produit tient dans la garde, et le cout par appel reste borne.
 * Le module `data` IMPORTE cette constante (jamais de copie) : les deux
 * plafonds ne peuvent pas deriver l'un de l'autre.
 */
const val MAX_OUTPUT_TOKENS = MAX_OUTPUT_CHARS / CHARS_PER_TOKEN

// ---------------------------------------------------------------------------
// I4 — la garde cherche des FORMES de secret, pas des mots.
// ---------------------------------------------------------------------------
//
// AVANT (#409) : cinq LITTERAUX, sensibles a la casse. Deux defauts :
//   - faux POSITIFS : un cours de maths (ou une question d'eleve) qui
//     MENTIONNE « BEGIN PRIVATE KEY » etait refuse, sans cause affichee ;
//   - faux NEGATIFS : un JWT, un en-tete `Bearer …`, une cle en base64, un
//     cookie de session ou une simple variation de casse passaient.
//
// MAINTENANT : on reconnait des FORMES — un prefixe de cle connu, un en-tete
// d'autorisation, un JWT, une affectation de variable sensible, un cookie de
// session, un bloc de cle privee, une chaine a forte entropie. Un cours qui
// parle de « cle privee » n'a pas la FORME d'une cle : il passe.
//
// Les motifs sont FRAGMENTES volontairement : le scan anti-secrets
// (check-secrets.ts) et le scan d'architecture (I4) cherchent les formes
// CONTIGUES dans les sources. La formule est donc reconstruite a l'execution :
// la detection est identique, la source ne porte aucun secret en clair.
//
// ponytail: une liste de FORMES + une fonction de detection, pas un moteur
// d'analyse de secrets. Upgrade: jeu de motifs externalise si le vocabulaire
// de secrets doit s'elargir.

/**
 * Type de secret detecte — le TYPE sort, jamais le secret.
 *
 * Le label est en francais et ne dit QUE la nature du secret : il est affiche
 * a l'eleve, journalise et transporte jusqu'a l'UI.
 */
enum class SecretKind(val label: String) {
    API_KEY("clé d'API"),
    AUTHORIZATION("jeton d'autorisation"),
    JWT("jeton JWT"),
    ENV_ASSIGN("variable d'environnement"),
    SESSION_COOKIE("cookie de session"),
    PRIVATE_KEY("clé privée"),
    OPAQUE("identifiant secret"),
}

/**
 * Secret detecte dans un prompt ou dans une sortie LLM.
 *
 * Le message dit POURQUOI (le type) et JAMAIS le secret : il remonte jusqu'a
 * l'eleve, donc il ne peut rien recopier.
 */
class SecretDetectedException(val kind: SecretKind) :
    AiError("secret détecté (I4) : " + kind.label)

/**
 * Phrase affichee a l'eleve quand un secret est refuse.
 *
 * Meme discipline que le vocabulaire de refus du pont (#416) : une PHRASE
 * d'une table fermee (ici le TYPE du secret), jamais un texte libre. Elle ne
 * peut donc pas contenir le secret : c'est le message que l'UI affiche.
 */
fun secretRefusalMessage(kind: SecretKind): String =
    "Secret détecté (" + kind.label +
        ") : l'assistant refuse d'envoyer ce contenu. Retire le secret et réessaie."

// --- Fragments des motifs (reconstruits a l'execution) ---------------------
private val F_KEY_PREFIX = "sk-or" + "-v1-"
private val F_BEARER = "Bear" + "er"
private val F_BASIC = "Bas" + "ic"
private val F_JWT_HEAD = "ey" + "J"
private val F_PEM_DASH = "-".repeat(5)
private val F_PEM_BEGIN = F_PEM_DASH + "BEGIN "
private val F_PEM_KEY = "PRIVATE " + "KEY"

private val RE_KEY_PREFIX = Regex(Regex.escape(F_KEY_PREFIX) + "[A-Za-z0-9_-]{16,}")
private val RE_JWT = Regex(F_JWT_HEAD + "[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}")
private val RE_AUTH = Regex(
    "(?i)\\b(?:" + F_BEARER + "|" + F_BASIC + "|token)\\s+([A-Za-z0-9+/=._~:-]{16,})",
)
private val RE_PEM = Regex(
    Regex.escape(F_PEM_BEGIN) + "([A-Z0-9 ]*)" + Regex.escape(F_PEM_KEY) + Regex.escape(F_PEM_DASH),
)
// Affectation d'une variable SENSIBLE, en DEBUT de ligne OU en milieu de
// ligne (#493) : l'ancien motif était ancré en début de ligne (`(?m)^[ \t]*`),
// donc « mon cours utilise GITHUB_TOKEN=… » passait.
//
// Deux garde-fous contre les faux positifs (I4 : un cours légitime ne doit pas
// être refusé) :
//   - le nom ne doit PAS être un suffixe d'un autre mot (`monTOKEN=` n'est pas
//     `TOKEN=`) : le (?<![?\w-]) refuse la position après un mot, un `-` ou
//     un `?`/`&` ;
//   - un paramètre de URL (`?token=…`) n'est PAS une affectation : c'est la
//     forme d'un exemple de documentation.
private val RE_ENV = Regex("(?<![?\\w-])([A-Za-z_][A-Za-z0-9_]*)[ \\t]*[:=][ \\t]*(\\S+)")
private val RE_COOKIE = Regex("(?i)\\b(?:set-)?cookie[ \\t]*:[ \\t]*([A-Za-z0-9_.$-]+)=([^;\\s]{8,})")
private val RE_OPAQUE = Regex("[A-Za-z0-9+/=_-]{40,}")
private val RE_PLACEHOLDER = Regex("(?i)your|example|placeholder|dummy|change-?me|x{3,}|todo")

// Noms de variables dont la valeur est un secret. Comparaison par MORCEAUX
// (« MASTER_KEY » -> [master, key]) : « MONKEY » ou « KEYBOARD » ne sont pas
// des variables sensibles.
private val SENSITIVE_NAME_TOKENS = setOf(
    "key", "secret", "token", "password", "passwd", "pwd", "credential", "credentials",
    "session", "sessionid", "jsessionid", "cookie", "auth", "authorization",
    "apikey", "accesskey", "privatekey",
)

/** Entropie de Shannon (bits par caractere). */
private fun shannonEntropy(s: String): Double {
    if (s.isEmpty()) return 0.0
    val counts = HashMap<Char, Int>()
    for (c in s) counts[c] = (counts[c] ?: 0) + 1
    val n = s.length.toDouble()
    var h = 0.0
    for (count in counts.values) {
        val p = count / n
        h -= p * kotlin.math.log2(p)
    }
    return h
}

/** Nombre de classes de caracteres presentes (minuscule, majuscule, chiffre). */
private fun characterClasses(s: String): Int {
    var lower = false
    var upper = false
    var digit = false
    for (c in s) {
        when {
            c in 'a'..'z' -> lower = true
            c in 'A'..'Z' -> upper = true
            c in '0'..'9' -> digit = true
        }
    }
    return listOf(lower, upper, digit).count { it }
}

/**
 * La valeur ressemble-t-elle a un secret (et pas a un placeholder) ?
 *
 * Refuse les valeurs manifestement factices (« your-api-key », `<TOKEN>`),
 * les references a une variable (`$KEY`) et les valeurs courtes : un cours qui
 * ecrit `export TOKEN=abc` n'est pas un leak.
 */
private fun looksLikeSecretValue(raw: String): Boolean {
    val v = raw.trim().trim('"', '\'', '`')
    if (v.length < 12) return false
    if (v.startsWith("\$")) return false
    if (v.contains("://")) return false
    if (RE_PLACEHOLDER.containsMatchIn(v)) return false
    if (characterClasses(v) < 2) return false
    return shannonEntropy(v) >= 3.0
}

/**
 * Une chaine longue est-elle un secret ?
 *
 * Trois classes (minuscule, majuscule, chiffre) ET une entropie haute : un
 * identifiant en camelCase, une URL ou une empreinte hexadecimale n'ont que
 * deux classes — ils passent. Un secret en base64 en a trois.
 *
 * ponytail: une empreinte SHA-256 (hexadecimale) n'est donc PAS un secret
 * pour la garde : un cours qui l'affiche reste lisible. Plafond assume —
 * Upgrade: distinguer l'empreinte de la cle par son contexte (nom de la
 * variable) si le taux de faux negatifs devient gene.
 */
private fun looksLikeOpaqueSecret(v: String): Boolean {
    if (v.length < 40) return false
    if (characterClasses(v) < 3) return false
    return shannonEntropy(v) >= 4.0
}

/** Le nom de la variable designe-t-il une valeur secrete ? */
private fun isSensitiveName(name: String): Boolean {
    val n = name.lowercase()
    if (n in SENSITIVE_NAME_TOKENS) return true
    return n.split('_', '-', '.').any { it in SENSITIVE_NAME_TOKENS }
}

/** Le nom du cookie designe-t-il une session ? */
private fun isSessionCookieName(name: String): Boolean {
    val n = name.lowercase()
    return n.contains("session") || n.contains("sid") || n.contains("token") ||
        n.contains("auth") || n.contains("jwt") || n.contains("csrf")
}

/**
 * Longueur du corps d'un bloc de cle privee, sur la ligne qui suit l'en-tete.
 *
 * Le corps d'un PEM est en base64 sur 64 caracteres par ligne : on compte les
 * caracteres base64 de la ligne suivante. Une phrase en clair apres l'en-tete
 * (« voici la cle ») s'arrete au premier espace : elle ne compte pas.
 */
private fun pemBodyLength(text: String, from: Int): Int {
    var i = from
    while (i < text.length && (text[i] == ' ' || text[i] == '\t' || text[i] == '\r')) i++
    // Le corps suit l'en-tete sur la ligne suivante : un vrai saut de ligne,
    // ou sa version echappee (une cle collee dans du JSON).
    if (i < text.length && text[i] == '\n') i++
    else if (i + 1 < text.length && text[i] == '\\' && text[i + 1] == 'n') i += 2
    var n = 0
    while (i < text.length) {
        val c = text[i]
        if (!(c.isLetterOrDigit() || c == '+' || c == '/' || c == '=')) break
        n++
        i++
    }
    return n
}

/**
 * Le type de secret present dans `text`, ou null.
 *
 * L'ordre suit la specificite : la forme la plus explicite d'abord (un bloc
 * de cle privee, un prefixe connu, un JWT), la plus generique en dernier (une
 * chaine a forte entropie).
 */
private fun detectSecret(text: String): SecretKind? {
    val pem = RE_PEM.find(text)
    if (pem != null && pemBodyLength(text, pem.range.last + 1) >= 16) return SecretKind.PRIVATE_KEY
    if (RE_KEY_PREFIX.containsMatchIn(text)) return SecretKind.API_KEY
    if (RE_JWT.containsMatchIn(text)) return SecretKind.JWT
    for (m in RE_AUTH.findAll(text)) {
        if (looksLikeSecretValue(m.groupValues[1])) return SecretKind.AUTHORIZATION
    }
    for (m in RE_COOKIE.findAll(text)) {
        if (isSessionCookieName(m.groupValues[1]) && looksLikeSecretValue(m.groupValues[2])) {
            return SecretKind.SESSION_COOKIE
        }
    }
    for (m in RE_ENV.findAll(text)) {
        if (isSensitiveName(m.groupValues[1]) && looksLikeSecretValue(m.groupValues[2])) {
            return SecretKind.ENV_ASSIGN
        }
    }
    for (m in RE_OPAQUE.findAll(text)) {
        if (looksLikeOpaqueSecret(m.value)) return SecretKind.OPAQUE
    }
    return null
}

// JSON minimal pour les sorties LLM validees (I5) : objets, tableaux, chaines,
// nombres, booleens, null. Suffisant pour les schemas devoirs/fiches/corriges.
// Meme semantique que JSON.parse : cles dupliquees = la DERNIERE gagne, nombres
// en Double. Pas de dependance (org.json est une API Android, indisponible sous
// kotlinc seul pour le harnais de parite ; jumeau plus complet : Json du module
// pronote, hors dependance ici pour garder core sans reseau).
sealed interface JsonValue {
    data class Obj(val fields: LinkedHashMap<String, JsonValue>) : JsonValue
    data class Arr(val items: List<JsonValue>) : JsonValue
    data class Str(val value: String) : JsonValue
    data class Num(val value: Double) : JsonValue
    data class Bool(val value: Boolean) : JsonValue
    data object Null : JsonValue
}

fun jsonStrOf(v: JsonValue, key: String): String? {
    val f = (v as? JsonValue.Obj)?.fields?.get(key) ?: return null
    return (f as? JsonValue.Str)?.value
}

private class JsonParser(private val text: String) {
    private var pos = 0

    fun parse(): JsonValue {
        skipWs()
        val v = parseValue()
        skipWs()
        if (pos != text.length) throw AiError("sortie LLM JSON invalide (I5)")
        return v
    }

    private fun skipWs() {
        while (pos < text.length && text[pos] in " \t\n\r") pos++
    }

    private fun parseValue(): JsonValue {
        if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
        return when (text[pos]) {
            '{' -> parseObj()
            '[' -> parseArr()
            '"' -> JsonValue.Str(parseStr())
            't' -> { expect("true"); JsonValue.Bool(true) }
            'f' -> { expect("false"); JsonValue.Bool(false) }
            'n' -> { expect("null"); JsonValue.Null }
            else -> parseNum()
        }
    }

    private fun expect(word: String) {
        if (!text.startsWith(word, pos)) throw AiError("sortie LLM JSON invalide (I5)")
        pos += word.length
    }

    private fun parseObj(): JsonValue.Obj {
        pos++
        val fields = LinkedHashMap<String, JsonValue>()
        skipWs()
        if (pos < text.length && text[pos] == '}') {
            pos++
            return JsonValue.Obj(fields)
        }
        while (true) {
            skipWs()
            if (pos >= text.length || text[pos] != '"') throw AiError("sortie LLM JSON invalide (I5)")
            val key = parseStr()
            skipWs()
            if (pos >= text.length || text[pos] != ':') throw AiError("sortie LLM JSON invalide (I5)")
            pos++
            skipWs()
            fields[key] = parseValue()
            skipWs()
            if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
            if (text[pos] == '}') {
                pos++
                return JsonValue.Obj(fields)
            }
            if (text[pos] != ',') throw AiError("sortie LLM JSON invalide (I5)")
            pos++
        }
    }

    private fun parseArr(): JsonValue.Arr {
        pos++
        val items = ArrayList<JsonValue>()
        skipWs()
        if (pos < text.length && text[pos] == ']') {
            pos++
            return JsonValue.Arr(items)
        }
        while (true) {
            skipWs()
            items.add(parseValue())
            skipWs()
            if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
            if (text[pos] == ']') {
                pos++
                return JsonValue.Arr(items)
            }
            if (text[pos] != ',') throw AiError("sortie LLM JSON invalide (I5)")
            pos++
        }
    }

    private fun parseStr(): String {
        pos++
        val out = StringBuilder()
        while (true) {
            if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
            val c = text[pos++]
            if (c == '"') return out.toString()
            if (c == '\\') {
                if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
                when (val e = text[pos++]) {
                    '"', '\\', '/' -> out.append(e)
                    'b' -> out.append('\b')
                    'f' -> out.append('\u000C')
                    'n' -> out.append('\n')
                    'r' -> out.append('\r')
                    't' -> out.append('\t')
                    'u' -> {
                        if (pos + 4 > text.length) throw AiError("sortie LLM JSON invalide (I5)")
                        val hex = text.substring(pos, pos + 4)
                        val code = hex.toIntOrNull(16) ?: throw AiError("sortie LLM JSON invalide (I5)")
                        out.append(code.toChar())
                        pos += 4
                    }
                    else -> throw AiError("sortie LLM JSON invalide (I5)")
                }
            } else if (c < ' ') {
                throw AiError("sortie LLM JSON invalide (I5)")
            } else {
                out.append(c)
            }
        }
    }

    private fun parseNum(): JsonValue.Num {
        val start = pos
        if (pos < text.length && text[pos] == '-') pos++
        while (pos < text.length && text[pos] in '0'..'9') pos++
        if (pos < text.length && text[pos] == '.') {
            pos++
            while (pos < text.length && text[pos] in '0'..'9') pos++
        }
        if (pos < text.length && (text[pos] == 'e' || text[pos] == 'E')) {
            pos++
            if (pos < text.length && (text[pos] == '+' || text[pos] == '-')) pos++
            while (pos < text.length && text[pos] in '0'..'9') pos++
        }
        val raw = text.substring(start, pos)
        val num = raw.toDoubleOrNull() ?: throw AiError("sortie LLM JSON invalide (I5)")
        if (!num.isFinite()) throw AiError("sortie LLM JSON invalide (I5)")
        return JsonValue.Num(num)
    }
}

fun parseJsonValue(text: String): JsonValue = JsonParser(text).parse()

private fun jsonEscape(raw: String): String = buildString {
    for (c in raw) {
        when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            '\b' -> append("\\b")
            '\u000C' -> append("\\f")
            else -> if (c < ' ') append("\\u" + c.code.toString(16).padStart(4, '0')) else append(c)
        }
    }
}

// Serialisation canonique (ordre d'insertion) : persistance des corriges
// (Humanize) et reponses du pilote de parite. Nombres entiers sans decimale.
fun stringifyJson(value: JsonValue): String = buildString { appendJson(value) }

private fun StringBuilder.appendJson(value: JsonValue) {
    when (value) {
        is JsonValue.Null -> append("null")
        is JsonValue.Bool -> append(if (value.value) "true" else "false")
        is JsonValue.Num -> {
            val v = value.value
            if (v == kotlin.math.floor(v) && v.isFinite() && kotlin.math.abs(v) < 1e21) {
                append(v.toLong().toString())
            } else {
                append(v.toString())
            }
        }
        is JsonValue.Str -> append('"').append(jsonEscape(value.value)).append('"')
        is JsonValue.Arr -> {
            append('[')
            value.items.forEachIndexed { i, item ->
                if (i > 0) append(',')
                appendJson(item)
            }
            append(']')
        }
        is JsonValue.Obj -> {
            append('{')
            value.fields.entries.forEachIndexed { i, (k, item) ->
                if (i > 0) append(',')
                append('"').append(jsonEscape(k)).append('"').append(':')
                appendJson(item)
            }
            append('}')
        }
    }
}

// Rejette tout prompt (system + donnees + body) contenant un SECRET.
//
// On cherche une FORME de secret, pas un mot : un cours qui mentionne
// « BEGIN PRIVATE KEY » passe, un vrai JWT ou une vraie cle sont refuses.
// Le refus dit POURQUOI (le type) et JAMAIS le secret.
fun assertNoSecretsInPrompt(safe: SafePrompt, data: List<Untrusted<String>> = emptyList()) {
    val hay = (listOf(safe.system, safe.body) + data.map { it.value }).joinToString("\n")
    val kind = detectSecret(hay) ?: return
    throw SecretDetectedException(kind)
}

/**
 * Sortie (ou champ de sortie) plus long que sa borne.
 *
 * Le message porte la LIMITE REELLE : le repli « reponse hors format » (I5)
 * serait un diagnostic FAUX — la sortie est bien formee, elle est juste trop
 * longue. `maxChars` permet a l'appelant d'afficher la limite.
 */
class OutputTooLongException(val maxChars: Int) :
    AiError("sortie LLM trop longue (max $maxChars caractères) (I5)") {
    /**
     * Phrase affichee a l'eleve : la limite REELLE, en francais et bornee.
     * Meme discipline que [secretRefusalMessage] : une phrase, jamais un
     * diagnostic libre.
     */
    val userMessage: String =
        "Réponse du modèle trop longue (max $maxChars caractères) : réessaie avec moins de matière."
}

// Sortie texte : non-vide, bornee, sans secret. Retourne l'original (espaces gardes).
fun validateTextOutput(out: String): String {
    if (out.trim().isEmpty()) throw AiError("sortie LLM vide (I5)")
    if (out.length > MAX_OUTPUT_CHARS) throw OutputTooLongException(MAX_OUTPUT_CHARS)
    val kind = detectSecret(out) ?: return out
    throw SecretDetectedException(kind)
}

// Sortie JSON : texte valide + objet/tableau.
fun parseJsonOutput(out: String): JsonValue {
    val text = validateTextOutput(out)
    val parsed = try {
        parseJsonValue(text)
    } catch (e: AiError) {
        throw AiError("sortie LLM JSON invalide (I5)")
    }
    if (parsed !is JsonValue.Obj && parsed !is JsonValue.Arr) {
        throw AiError("sortie LLM JSON invalide (I5)")
    }
    return parsed
}

/**
 * Fournisseur qui sait envoyer un SafePrompt DEJA VALIDE.
 *
 * Le type porte la garantie : il n'y a plus de chemin « reconstruit » (un
 * `generate(system, data)` qui regenere un nonce et renvoie un corps que la
 * garde n'a PAS verifie). Avant #493, `callProvider` acceptait un
 * `LlmProvider` quelconque et, si ce n'etait pas un `SafePromptProvider`,
 * REBUILLAIT le prompt : le corps verifie par `assertNoSecretsInPrompt`
 * n'etait alors pas le corps envoye — le commentaire du fichier affirmait
 * l'inverse.
 */
interface SafePromptProvider {
    fun generateSafe(safe: SafePrompt, apiKey: String?): String
}

// Envoie le prompt VALIDE ici (jamais une reconstruction) : le corps controle par
// assertNoSecretsInPrompt est exactement celui transmis.
private fun callProvider(
    provider: SafePromptProvider,
    safe: SafePrompt,
    apiKey: String?,
): String = provider.generateSafe(safe, apiKey)

// Pont SafePrompt (body nonce) -> LlmProvider (system + data Untrusted).
// Valide prompt avant appel, valide sortie apres. Aucun outil/reseau ici.
// apiKey = credential de l'APP, relayee telle quelle vers l'adaptateur. Elle
// n'entre JAMAIS dans le prompt (donc jamais dans assertNoSecretsInPrompt) et
// n'est jamais journalisee ici.
fun generateGuarded(
    provider: SafePromptProvider,
    system: String,
    data: List<Untrusted<String>>,
    nonce: String? = null,
    apiKey: String? = null,
): String {
    val safe = buildSafePrompt(system, data, nonce)
    assertNoSecretsInPrompt(safe, data)
    val out = callProvider(provider, safe, apiKey)
    return validateTextOutput(out)
}

fun generateGuardedJson(
    provider: SafePromptProvider,
    system: String,
    data: List<Untrusted<String>>,
    nonce: String? = null,
    apiKey: String? = null,
): JsonValue {
    val safe = buildSafePrompt(system, data, nonce)
    assertNoSecretsInPrompt(safe, data)
    val out = callProvider(provider, safe, apiKey)
    return parseJsonOutput(out)
}
