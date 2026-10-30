package fr.veryslopnynotes.core

import java.time.Instant

// Fiches révision : déclenchement structuré + assemblage + stockage (port Kotlin #207).
//
// Porté de `server/jobs/revision.ts` (supprimé en #210, hors `renderRevisionPdf`,
// le writer PDF-1.4 maison que `RevisionPdf.kt` remplace par `PdfDocument` natif :
// ce port est la source de vérité). Données
// structurées uniquement : `ExamCandidate` (devoir choisi par l'élève). Aucun
// appel modèle ici, aucune sortie libre ne déclenche d'effet (I7).
// Contenu assemblé depuis texte validé + sources citées, gabarit versionné
// stocké par fiche. Logs = compteurs seuls, jamais de token en clair.
//
// L'export PDF rend le corps ENTIER (il pagine) et la liste CANONIQUE des
// sources : le bloc « Sources : » écrit par le modèle est validé puis
// remplacé par cette liste (#412).
//
// `RevisionKv` est bloquant (pas de coroutines dans `core`, zéro dépendance) ;
// l'appelant expose le thread. Le JSON du stockage est lu/écrit à la main
// (stdlib seule) : les fiches survivent à un aller-retour exact.
//
// Pur : aucun réseau, aucun SQLite, aucun Android (I3).
//
// ponytail: index + journal comme la référence (un index illisible ne fait
// jamais disparaître une fiche déjà stockée). Upgrade: stockage versionné
// partagé quand les repositories locaux (#205) branchent ce module.

/** Version gabarit fiches révision, stockée par fiche. */
const val REVISION_TEMPLATE_VERSION = "fiche-v1"

/** Fiche de révision assemblée depuis texte validé + sources citées. */
data class RevisionSheet(
    val id: String,
    val examId: String,
    val subject: String,
    val date: String,
    val title: String,
    val body: String,
    val sources: List<String>,
    val templateVersion: String,
    val createdAt: String,
)

/** Miroir de `isRevisionSheet` : c'est lui qui décide si une fiche compte. */
fun isRevisionSheetValid(s: RevisionSheet): Boolean {
    if (s.id.isBlank() || s.examId.isBlank()) return false
    if (s.subject.isBlank() || s.title.isBlank()) return false
    if (s.body.isBlank()) return false
    if (!isIsoDateLike(s.date) || !isIsoDateLike(s.createdAt)) return false
    if (s.sources.isEmpty() || s.sources.any { it.isBlank() }) return false
    if (s.templateVersion != REVISION_TEMPLATE_VERSION) return false
    return true
}

/**
 * Stockage kv minimal (miroir du provider de stockage, autres lanes actives dessus).
 *
 * #404 : l'écriture porte l'ÉPOQUE de session capturée au DÉBUT de
 * l'opération (une fiche passe par un appel LLM de plusieurs secondes). Le
 * store REFUSE l'écriture si la session a changé depuis (déconnexion,
 * changement de compte) : une fiche générée pendant une déconnexion n'est
 * donc PAS écrite, et le répertoire purgé ne ressuscite pas.
 */
interface RevisionKv {
    fun get(key: String): ByteArray?
    /** false = écriture abandonnée (la session a changé depuis [epoch]). */
    fun set(key: String, value: ByteArray, epoch: Long): Boolean
}

private const val SHEET_PREFIX = "revision:sheet:"
private const val INDEX_KEY = "revision:index"
private const val INDEX_JOURNAL_KEY = "revision:index:journal"

private fun cleanRevision(s: String, max: Int): String {
    val t = s.trim().replace(Regex("\\s+"), " ")
    return if (t.length > max) t.substring(0, max) else t
}

private fun sheetKey(id: String): String = "$SHEET_PREFIX$id"

/**
 * Id déterministe par examen : rejouable, zéro doublon. L'assainissement est
 * PERDANT (« a/b » et « a?b » donneraient la même fiche, l'une écrasant
 * l'autre) : un suffixe dérivé de l'id brut (FNV-1a 32 bits, sans collision
 * pratique) garantit l'unicité tout en gardant un id lisible et rejouable.
 */
fun revisionIdForExam(examId: String): String {
    val raw = examId.trim()
    val safe = Regex("[^A-Za-z0-9_-]+").replace(raw, "-").take(80)
    val base = safe.ifEmpty { "exam" }
    return if (raw == safe) "fiche-$base" else "fiche-$base-${fnv1aRevision(raw)}"
}

/** FNV-1a 32 bits en base 36 : suffixe court, déterministe. */
private fun fnv1aRevision(s: String): String {
    var h = 0x811c9dc5.toInt()
    for (i in s.indices) {
        h = h xor s[i].code
        h = h * 0x01000193
    }
    return h.toUInt().toString(36)
}

fun buildRevisionTitle(exam: ExamCandidate): String {
    val subject = exam.subject.trim().ifEmpty { "matière" }
    return cleanRevision("Fiche révision $subject — ${exam.matched} ${localDay(exam.date)}", 120)
}

private fun dedupeRevisionSources(sources: List<String>): List<String> {
    val out = mutableListOf<String>()
    for (s in sources) {
        // Une source est un LIBELLÉ : il tient sur une ligne (le bloc
        // « Sources : » en dépend — un saut de ligne le déferait hors du
        // bloc et laissait un bout de texte dans le corps).
        val t = s.trim().replace("\r", " ").replace("\n", " ")
        if (t.isEmpty() || out.contains(t)) continue
        out.add(t)
    }
    return out
}

// Assemble fiche depuis texte validé + sources. Exige sources non-vides
// (refus propre si corpus insuffisant). Corps cite toujours.
fun assembleRevisionSheet(
    exam: ExamCandidate,
    ficheText: String,
    sources: List<String>,
    now: String = Instant.now().toString(),
): RevisionSheet {
    val text = ficheText.trim()
    if (text.isEmpty()) throw IllegalArgumentException("fiche vide (refus)")
    val deduped = dedupeRevisionSources(sources)
    if (deduped.isEmpty()) throw IllegalArgumentException("sources insuffisantes (refus)")
    // Le corps est ce qui RESTE après retrait du bloc « Sources » du modèle :
    // une sortie qui n'est qu'une bibliographie est une fiche VIDE, jamais
    // stockée ni exportée (I15 : la fiche garde un cours entier).
    if (revisionContent(text).isEmpty()) throw IllegalArgumentException("fiche vide (refus)")
    val sheet = RevisionSheet(
        id = revisionIdForExam(exam.id),
        examId = exam.id,
        subject = exam.subject,
        date = exam.date,
        title = buildRevisionTitle(exam),
        body = revisionSheetBody(text, deduped),
        sources = revisionSheetSources(text, deduped),
        templateVersion = REVISION_TEMPLATE_VERSION,
        createdAt = now,
    )
    if (!isRevisionSheetValid(sheet)) throw IllegalArgumentException("fiche invalide (contrat)")
    return sheet
}

// --- Stockage kv -------------------------------------------------------------

/** Chaîne entre guillemets à la `JSON.stringify` (échappées + paires valides brutes). */
private fun jsonStr(s: String): String {
    val out = StringBuilder()
    out.append('"')
    var i = 0
    while (i < s.length) {
        val c = s[i]
        when (c) {
            '"' -> out.append("\\\"")
            '\\' -> out.append("\\\\")
            '\n' -> out.append("\\n")
            '\r' -> out.append("\\r")
            '\t' -> out.append("\\t")
            '\b' -> out.append("\\b")
            '\u000C' -> out.append("\\f")
            in '\uD800'..'\uDBFF' -> {
                val lo = if (i + 1 < s.length) s[i + 1] else '\u0000'
                if (lo in '\uDC00'..'\uDFFF') {
                    out.append(c)
                    out.append(lo)
                    i++
                } else {
                    out.append("\\u%04x".format(c.code))
                }
            }
            in '\uDC00'..'\uDFFF' -> out.append("\\u%04x".format(c.code))
            else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
        }
        i++
    }
    out.append('"')
    return out.toString()
}

fun revisionSheetJson(sheet: RevisionSheet): String {
    val sources = sheet.sources.joinToString(",") { jsonStr(it) }
    return "{\"id\":${jsonStr(sheet.id)}," +
        "\"examId\":${jsonStr(sheet.examId)}," +
        "\"subject\":${jsonStr(sheet.subject)}," +
        "\"date\":${jsonStr(sheet.date)}," +
        "\"title\":${jsonStr(sheet.title)}," +
        "\"body\":${jsonStr(sheet.body)}," +
        "\"sources\":[$sources]," +
        "\"templateVersion\":${jsonStr(sheet.templateVersion)}," +
        "\"createdAt\":${jsonStr(sheet.createdAt)}}"
}

private fun revisionIndexJson(ids: List<String>): String =
    "[${ids.joinToString(",") { jsonStr(it) }}]"

/** Mini-lecteur JSON (objets/tableaux/chaînes) : juste ce que le kv stocke. */
private class RevisionJsonReader(private val text: String) {
    private var pos = 0

    fun read(): Any? {
        skipWs()
        if (pos >= text.length) throw IllegalArgumentException("JSON vide")
        return readValue()
    }

    fun end(): Boolean {
        skipWs()
        return pos == text.length
    }

    private fun skipWs() {
        while (pos < text.length && text[pos] in " \t\n\r") pos++
    }

    private fun readValue(): Any? {
        skipWs()
        if (pos >= text.length) throw IllegalArgumentException("fin inattendue")
        return when (val c = text[pos]) {
            '{' -> readObj()
            '[' -> readArr()
            '"' -> readStr()
            't' -> {
                expect("true")
                true
            }
            'f' -> {
                expect("false")
                false
            }
            'n' -> {
                expect("null")
                null
            }
            '-', in '0'..'9' -> readNum()
            else -> throw IllegalArgumentException("caractère '$c' à $pos")
        }
    }

    private fun expect(word: String) {
        if (!text.startsWith(word, pos)) throw IllegalArgumentException("attendu $word à $pos")
        pos += word.length
    }

    private fun readObj(): Map<String, Any?> {
        pos++ // {
        val map = LinkedHashMap<String, Any?>()
        skipWs()
        if (pos < text.length && text[pos] == '}') {
            pos++
            return map
        }
        while (true) {
            skipWs()
            if (pos >= text.length || text[pos] != '"') throw IllegalArgumentException("clé attendue à $pos")
            val key = readStr()
            skipWs()
            if (pos >= text.length || text[pos] != ':') throw IllegalArgumentException("':' attendu à $pos")
            pos++
            map[key] = readValue()
            skipWs()
            if (pos >= text.length) throw IllegalArgumentException("fin d'objet inattendue")
            if (text[pos] == '}') {
                pos++
                return map
            }
            if (text[pos] != ',') throw IllegalArgumentException("',' attendue à $pos")
            pos++
        }
    }

    private fun readArr(): List<Any?> {
        pos++ // [
        val list = mutableListOf<Any?>()
        skipWs()
        if (pos < text.length && text[pos] == ']') {
            pos++
            return list
        }
        while (true) {
            list.add(readValue())
            skipWs()
            if (pos >= text.length) throw IllegalArgumentException("fin de tableau inattendue")
            if (text[pos] == ']') {
                pos++
                return list
            }
            if (text[pos] != ',') throw IllegalArgumentException("',' attendue à $pos")
            pos++
        }
    }

    private fun readStr(): String {
        pos++ // "
        val out = StringBuilder()
        while (true) {
            if (pos >= text.length) throw IllegalArgumentException("chaîne non fermée")
            val c = text[pos++]
            if (c == '"') return out.toString()
            if (c == '\\') {
                if (pos >= text.length) throw IllegalArgumentException("échapée tronquée")
                when (val e = text[pos++]) {
                    '"', '\\', '/' -> out.append(e)
                    'b' -> out.append('\b')
                    'f' -> out.append('\u000C')
                    'n' -> out.append('\n')
                    'r' -> out.append('\r')
                    't' -> out.append('\t')
                    'u' -> {
                        if (pos + 4 > text.length) throw IllegalArgumentException("\\u tronqué")
                        val hi = text.substring(pos, pos + 4).toInt(16)
                        pos += 4
                        if (hi in 0xD800..0xDBFF && pos + 6 <= text.length &&
                            text[pos] == '\\' && text[pos + 1] == 'u'
                        ) {
                            val lo = text.substring(pos + 2, pos + 6).toInt(16)
                            if (lo in 0xDC00..0xDFFF) {
                                out.appendCodePoint(0x10000 + ((hi - 0xD800) shl 10) + (lo - 0xDC00))
                                pos += 6
                                continue
                            }
                        }
                        out.append(hi.toChar())
                    }
                    else -> throw IllegalArgumentException("échapée '\\$e' à $pos")
                }
                continue
            }
            if (c < ' ') throw IllegalArgumentException("contrôle brut en chaîne à $pos")
            out.append(c)
        }
    }

    private fun readNum(): Double {
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
        return text.substring(start, pos).toDouble()
    }
}

private fun parseStringArray(text: String): List<String>? {
    val reader = RevisionJsonReader(text)
    val v = try {
        reader.read()
    } catch (_: Exception) {
        return null
    }
    if (!reader.end() || v !is List<*>) return null
    if (v.any { it !is String }) return null
    @Suppress("UNCHECKED_CAST")
    return v as List<String>
}

fun parseRevisionSheetJson(text: String): RevisionSheet? {
    return try {
        val reader = RevisionJsonReader(text)
        val v = reader.read()
        if (!reader.end() || v !is Map<*, *>) return null
        @Suppress("UNCHECKED_CAST")
        val o = v as Map<String, Any?>
        fun str(key: String): String? = o[key] as? String
        val sources = o["sources"] as? List<*> ?: return null
        if (sources.any { it !is String }) return null
        @Suppress("UNCHECKED_CAST")
        val sheet = RevisionSheet(
            id = str("id") ?: return null,
            examId = str("examId") ?: return null,
            subject = str("subject") ?: return null,
            date = str("date") ?: return null,
            title = str("title") ?: return null,
            body = str("body") ?: return null,
            sources = sources as List<String>,
            templateVersion = str("templateVersion") ?: return null,
            createdAt = str("createdAt") ?: return null,
        )
        if (!isRevisionSheetValid(sheet)) null else sheet
    } catch (_: Exception) {
        null
    }
}

/** ids d'un index : `[]` si absent, `null` si ILLISIBLE (à ne pas écraser). */
private fun readIdIndex(store: RevisionKv, key: String): List<String>? {
    val raw = store.get(key) ?: return emptyList()
    return try {
        parseStringArray(raw.toString(Charsets.UTF_8))
    } catch (_: Exception) {
        null
    }
}

/**
 * Union index + journal : un index illisible ne doit JAMAIS faire disparaître
 * une fiche déjà présente dans le kv.
 */
private fun allKnownIds(store: RevisionKv): List<String> {
    val index = readIdIndex(store, INDEX_KEY) ?: emptyList()
    val journal = readIdIndex(store, INDEX_JOURNAL_KEY) ?: emptyList()
    return (index + journal).toSet().sorted()
}

/**
 * Enregistre la fiche, puis l'index et le journal qui la listent.
 *
 * [epoch] = époque de session capturée au DÉBUT de l'opération (#404) : si
 * la session a changé depuis (déconnexion), l'écriture est REFUSÉE et
 * `false` est renvoyé — rien n'est écrit, donc le répertoire purgé ne
 * ressuscite pas.
 *
 * #528 : les trois écritures forment UNE tentative. L'époque peut basculer
 * ENTRE l'écriture de la fiche et celle de l'index (la génération dure
 * plusieurs secondes) : l'index et le journal sont alors REFUSÉS, et
 * l'enregistrement ÉCHOUE — le pont ne doit JAMAIS répondre « ok » sans
 * avoir écrit (I10). Une fiche non listable n'est pas une fiche
 * enregistrée. L'état partiel ne laisse rien derrière : l'invalidation
 * d'époque et la purge sont dans la MÊME section critique (I16), donc le
 * basculement qui refuse l'index a déjà purgé la fiche écrite.
 */
fun saveRevisionSheet(store: RevisionKv, sheet: RevisionSheet, epoch: Long): Boolean {
    if (!isRevisionSheetValid(sheet)) throw IllegalArgumentException("fiche invalide (contrat)")
    if (!store.set(sheetKey(sheet.id), revisionSheetJson(sheet).toByteArray(Charsets.UTF_8), epoch)) {
        return false
    }
    val ids = allKnownIds(store).toMutableList()
    if (!ids.contains(sheet.id)) {
        ids.add(sheet.id)
        ids.sort()
        val encoded = revisionIndexJson(ids).toByteArray(Charsets.UTF_8)
        // Index REFUSÉ = l'époque a basculé : l'enregistrement échoue.
        if (!store.set(INDEX_KEY, encoded, epoch)) return false
        // Le journal est la source de vérité qui ne rétrécit jamais : même si
        // l'index est corrompu au prochain tour, l'id reste listable.
        if (!store.set(INDEX_JOURNAL_KEY, encoded, epoch)) return false
    }
    return true
}

fun loadRevisionSheet(store: RevisionKv, id: String): RevisionSheet? {
    val raw = store.get(sheetKey(id)) ?: return null
    return try {
        parseRevisionSheetJson(raw.toString(Charsets.UTF_8))
    } catch (_: Exception) {
        null
    }
}

fun listRevisionSheets(store: RevisionKv): List<RevisionSheet> {
    val out = mutableListOf<RevisionSheet>()
    for (id in allKnownIds(store)) {
        val s = loadRevisionSheet(store, id)
        if (s != null) out.add(s)
    }
    return out
}

// --- Sources de la fiche (liste canonique) ------------------------------------

/** En-tête du bloc de sources : celui du corps, celui de l'export. */
const val REVISION_SOURCES_HEADING = "Sources :"

/** Marqueur de troncature : une fiche tronquée le DIT (jamais en silence). */
const val REVISION_PDF_TRUNCATED = "(suite tronquée)"

/** Puces admises pour une entrée de source (« - x », « • x »…). */
private val REVISION_SOURCE_BULLETS = charArrayOf('-', '•', '*', '–')

/** Marqueur d'énumération d'une citation (« [1] x », « (1) x », « 1. x »). */
private val REVISION_CITATION_MARKER = Regex("^(?:\\[\\d+\\]|\\(\\d+\\)|\\d+[.)])\\s*(.+)$")

/** Décorations markdown retirées devant un en-tête (« > ## **Sources** »). */
private val REVISION_HEADING_MARK = Regex("^#{1,6}(?:\\s+|$)")
private val REVISION_QUOTE_MARK = Regex("^(?:>\\s*)+")
private val REVISION_EMPHASIS_OPEN = Regex("^(?:\\*\\*|__)\\s*")
private val REVISION_EMPHASIS_CLOSE = Regex("\\s*(?:\\*\\*|__)$")

/** « Sources », « Sources : », « Sources : A, B » (casse libre, titre exclu). */
private val REVISION_SOURCES_HEADING_RE = Regex("^sources\\s*(?::\\s*(.*))?$", RegexOption.IGNORE_CASE)

/** La ligne est-elle une entrée de source (« - x ») ? */
private fun isRevisionSourceEntry(line: String): Boolean {
    val t = line.trim()
    return t.length > 1 && REVISION_SOURCE_BULLETS.contains(t[0])
}

/**
 * Ce que l'en-tête « Sources » porte SUR SA LIGNE : `""` pour un en-tête
 * seul (« Sources », « **Sources** »), le texte restant pour une attribution
 * en ligne (« Sources : A, B »), `null` si la ligne n'est pas un en-tête.
 *
 * Le modèle écrit librement : `## Sources :`, `> **Sources**`, `sources:`,
 * `Sources`, `Sources : A, B`… On retire donc les décorations markdown
 * successives (titres, citation, gras). Un titre ordinaire qui COMMENCE par
 * le mot (« Sources historiques ») n'est pas un en-tête : il faut la fin de
 * ligne ou un deux-points après « Sources ».
 */
private fun revisionSourcesHeadingInline(line: String): String? {
    var s = line.trim()
    while (true) {
        val before = s
        s = REVISION_HEADING_MARK.replaceFirst(s, "")
        s = REVISION_QUOTE_MARK.replaceFirst(s, "")
        s = REVISION_EMPHASIS_OPEN.replaceFirst(s, "")
        s = REVISION_EMPHASIS_CLOSE.replaceFirst(s, "")
        s = s.trim()
        if (s == before) break
    }
    val m = REVISION_SOURCES_HEADING_RE.matchEntire(s) ?: return null
    return (m.groupValues.getOrNull(1) ?: "").trim()
}

/**
 * Fin (exclusive) d'un bloc de sources : la ligne d'en-tête, puis — pour un
 * en-tête seul — les lignes de citation qui le suivent.
 *
 * Une attribution en ligne (`Sources : A, B`) ne dure qu'une ligne. Une ligne
 * VIDE termine le bloc, et la PREMIÈRE ligne qui n'est pas une entrée de
 * citation (`## Analyse`, une prose) rend le corps au cours : le modèle qui
 * oublie la ligne vide n'avale pas la suite de la fiche (I15 : corps entier).
 */
private fun revisionSourcesBlockEnd(lines: List<String>, heading: Int, inline: String): Int {
    if (inline.isNotEmpty()) return heading + 1
    var i = heading + 1
    while (i < lines.size) {
        if (lines[i].trim().isEmpty()) break
        if (!isRevisionCitationLine(lines[i])) break
        i++
    }
    return i
}

/** Une ligne de citation, même dans un bloc cité (`> [1] x`). */
private fun isRevisionCitationLine(line: String): Boolean {
    val t = REVISION_QUOTE_MARK.replaceFirst(line.trim(), "").trim()
    if (t.isEmpty()) return false
    if (isRevisionSourceEntry(t)) return true
    return REVISION_CITATION_MARKER.matchEntire(t) != null
}

/** Blocs de sources écrits par le modèle : (index de l'en-tête, fin exclusive). */
private fun revisionSourcesBlocks(lines: List<String>): List<Pair<Int, Int>> {
    val out = mutableListOf<Pair<Int, Int>>()
    var i = 0
    while (i < lines.size) {
        val inline = revisionSourcesHeadingInline(lines[i])
        if (inline == null) {
            i++
        } else {
            val end = revisionSourcesBlockEnd(lines, i, inline)
            out.add(i to end)
            i = end
        }
    }
    return out
}

/** Texte d'une citation (sans puce ni marqueur d'énumération), ou null. */
private fun revisionCitationText(line: String): String? {
    val t = line.trim()
    if (t.isEmpty()) return null
    if (isRevisionSourceEntry(t)) return t.substring(1).trim().ifEmpty { null }
    return REVISION_CITATION_MARKER.matchEntire(t)?.groupValues?.get(1)?.trim()?.ifEmpty { null }
}

/**
 * Citations écrites par le modèle dans ses blocs « Sources » (liste vide s'il
 * n'en a pas écrit) : puces et entrées numérotées, sans leur marqueur.
 */
private fun revisionModelCitations(text: String): List<String> {
    val lines = text.split("\n")
    val out = mutableListOf<String>()
    for ((heading, end) in revisionSourcesBlocks(lines)) {
        val inline = revisionSourcesHeadingInline(lines[heading]).orEmpty()
        if (inline.isNotEmpty()) {
            for (part in inline.split(",", ";")) {
                val c = part.trim()
                if (c.isNotEmpty()) out.add(c)
            }
        }
        for (i in heading + 1 until end) {
            revisionCitationText(lines[i])?.let { out.add(it) }
        }
    }
    return out
}

/**
 * Texte SANS aucun bloc « Sources » écrit par le modèle : ce que l'export
 * dessine, et ce que le corps stocké garde.
 *
 * TOUT bloc de sources du modèle part, qu'il soit final ou AU MILIEU : un
 * bloc final serait recopié comme attribution, un bloc au milieu laisserait
 * une fausse source au cœur du cours. Le bloc s'arrête à la première ligne
 * vide OU à la première ligne qui n'est pas une citation, donc le contenu qui
 * suit est conservé (I15 : le corps est ENTIER et seule la liste canonique
 * fait foi).
 */
private fun revisionContent(text: String): String {
    val lines = text.split("\n")
    val drop = BooleanArray(lines.size)
    for ((start, end) in revisionSourcesBlocks(lines)) {
        for (i in start until end) drop[i] = true
    }
    return lines.indices.filterNot { drop[it] }.joinToString("\n") { lines[it] }.trim()
}

/**
 * Sources de la fiche : les citations du modèle VALIDÉES contre les sources
 * canoniques, puis les autres sources canoniques (la liste reste complète).
 *
 * Une citation du modèle qui ne figure pas dans les sources canoniques est
 * REJETÉE (pas ajoutée) — même règle que le chemin devoirs
 * (`HomeworkAi.parseHomeworkResponse`).
 */
fun revisionSheetSources(modelText: String, canonicalSources: List<String>): List<String> {
    val canonical = canonicalSources.map { it.trim() }.filter { it.isNotEmpty() }
    val allowed = canonical.toSet()
    val cited = mutableListOf<String>()
    for (c in revisionModelCitations(modelText)) {
        if (c in allowed && !cited.contains(c)) cited.add(c)
    }
    // Les sources citées par le modèle d'abord : l'élève voit ce que la
    // fiche a réellement utilisé. La liste reste COMPLÈTE (les sources non
    // citées y sont conservées) : c'est la liste canonique qui fait foi.
    return cited + canonical.filter { it !in cited }
}

/**
 * Corps de la fiche : le texte du modèle (sans son bloc « Sources : »), puis
 * le bloc des sources.
 *
 * Le bloc écrit par le modèle est REMPLACÉ par la liste canonique : une
 * attribution libre (du texte) ne peut pas remplacer la source de vérité.
 */
fun revisionSheetBody(modelText: String, canonicalSources: List<String>): String {
    val sources = revisionSheetSources(modelText, canonicalSources)
    val content = revisionContent(modelText)
    val block = (listOf(REVISION_SOURCES_HEADING) + sources.map { "- $it" }).joinToString("\n")
    return if (content.isEmpty()) block else "$content\n\n$block"
}

// --- Mise en page PDF (pure, rejouée en parité) -------------------------------

/**
 * Filet de sécurité du rendu : le PDF PAGINE (cf. `RevisionPdf`), donc la
 * fiche entière tient en plusieurs pages. Cette borne n'est plus un plafond
 * de contenu : elle n'attrape qu'une fiche colossale (magasin altéré), et la
 * troncature qu'elle provoque est SIGNALÉE (jamais silencieuse).
 */
const val REVISION_PDF_MAX_LINES = 400

/** Largeur d'une ligne de corps (colonnes). */
const val REVISION_PDF_WRAP = 90

/**
 * Ligne markdown -> ligne de texte dessinable. Le PDF n'a qu'une police de
 * corps : on retire les marqueurs (titres, gras/italique, code, liens) en
 * gardant le contenu et les puces lisibles. Les liens sont désactivés : seul
 * le libellé reste. Les `|` ne sont PAS traités ici : un tableau se reconnaît
 * à son séparateur, cf. [revisionPlainLines].
 */
private fun revisionPlainLine(line: String): String {
    var s = line.trim()
    if (s.isEmpty()) return " "
    // Bloc de code / règle horizontale : rien de lisible à dessiner.
    if (s.startsWith("```")) return " "
    if (Regex("^([-*_])(?:\\s*\\1){2,}$").matches(s)) return " "
    // Titre : « ## Titre ### » -> « Titre ».
    s = Regex("^#{1,6}\\s+").replaceFirst(s, "")
    s = Regex("\\s+#+\\s*$").replace(s, "")
    // Citation : les marqueurs > sont aplatis.
    s = Regex("^(?:>\\s*)+").replaceFirst(s, "")
    // Puce non ordonnée : « * texte » / « + texte » -> « - texte » (puce
    // texte, comme les sources). Les listes ordonnées gardent leur numéro,
    // déjà lisible en texte.
    s = Regex("^[-*+]\\s+").replaceFirst(s, "- ")
    // Lien/image : libellé seul, URL jetée (aucun schéma dangereux dessiné).
    s = Regex("!?\\[([^\\]]*)\\]\\([^)]*\\)").replace(s, "\$1")
    // Code inline : contenu seul.
    s = Regex("`([^`]*)`").replace(s, "\$1")
    // Gras puis italique.
    s = Regex("\\*\\*(.+?)\\*\\*").replace(s, "\$1")
    s = Regex("__(.+?)__").replace(s, "\$1")
    s = Regex("(?<!\\*)\\*([^*]+)\\*(?!\\*)").replace(s, "\$1")
    s = Regex("(?<![\\p{L}\\p{N}_])_([^_]+)_(?![\\p{L}\\p{N}_])").replace(s, "\$1")
    // Échappements markdown : « \* » -> « * ».
    s = Regex("\\\\([\\\\`*_{}\\[\\]()#+.!|>-])").replace(s, "\$1")
    return s.trim().ifEmpty { " " }
}

/** Cellules d'une ligne de tableau potentielle (2 au moins), ou null. */
private fun revisionTableCells(line: String): List<String>? {
    val t = line.trim()
    if (!t.contains("|")) return null
    var inner = t
    if (inner.startsWith("|")) inner = inner.substring(1)
    if (inner.endsWith("|")) inner = inner.dropLast(1)
    val cells = inner.split("|").map { it.trim() }
    return if (cells.size >= 2) cells else null
}

/** Cellule de séparation (`---`, `:---:`) d'un tableau markdown. */
private fun isRevisionTableSeparatorCell(cell: String): Boolean =
    Regex("^:?-{1,}:?$").matches(cell)

/** Une ligne n'est un tableau que si un séparateur du même nombre de cellules
 *  la suit : `|x| ≤ 1` (maths) et le code gardent leur barre. */
private fun revisionTableSeparator(line: String?, columns: Int): Boolean {
    val cells = revisionTableCells(line ?: "") ?: return false
    return cells.size == columns && cells.all { isRevisionTableSeparatorCell(it) }
}

/** Une ligne de tableau dessinable : ses cellules en texte, jointes par « — ». */
private fun revisionTablePlainLine(cells: List<String>): String =
    cells.map { revisionPlainLine(it).trim() }.joinToString(" — ").ifEmpty { " " }

/**
 * Corps -> lignes dessinables, tableaux reconnus.
 *
 * Un `|` seul n'est PAS un tableau : `|x|`, `|x| ≤ 1` et le contenu d'un bloc
 * de code restent du texte (les maths ne deviennent pas « x — ≤ 1 »). Seule
 * une suite en-tête + séparateur ouvre un tableau ; ses lignes deviennent
 * « a — b » et le séparateur disparaît.
 */
private fun revisionPlainLines(lines: List<String>): List<String> {
    val out = mutableListOf<String>()
    var inFence = false
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        // Un bloc de code n'est jamais un tableau : son contenu est brut.
        if (line.trim().startsWith("```")) {
            inFence = !inFence
            out.add(" ")
            i++
            continue
        }
        if (!inFence) {
            val header = revisionTableCells(line)
            if (header != null && revisionTableSeparator(lines.getOrNull(i + 1), header.size)) {
                out.add(revisionTablePlainLine(header))
                i += 2
                while (i < lines.size) {
                    val row = revisionTableCells(lines[i]) ?: break
                    if (row.size != header.size) break
                    if (row.all { isRevisionTableSeparatorCell(it) }) break
                    out.add(revisionTablePlainLine(row))
                    i++
                }
                continue
            }
        }
        out.add(revisionPlainLine(line))
        i++
    }
    return out
}

/**
 * Corps découpé en lignes affichables : ce que `RevisionPdf` dessine.
 *
 * Le corps est rendu ENTIER : `RevisionPdf` pagine, la fiche exportée porte
 * donc la fin du texte ET ses sources. Le bloc « Sources : » est rendu depuis
 * la liste CANONIQUE (`sheet.sources`), jamais depuis le corps : une citation
 * écrite dans du texte libre ne peut pas remplacer la source de vérité.
 */
fun revisionPdfLines(sheet: RevisionSheet): List<String> {
    if (!isRevisionSheetValid(sheet)) throw IllegalArgumentException("fiche invalide (contrat)")
    val content = revisionContent(sheet.body)
    // Une fiche qui ne porte qu'un bloc « Sources » est VIDE : jamais
    // exportée comme une simple bibliographie (I15).
    if (content.isEmpty()) throw IllegalArgumentException("fiche vide (refus)")
    // Garde I5 : le corps du modèle est borné (MAX_OUTPUT_CHARS). Un corps
    // plus long (magasin altéré) est tronqué — et SIGNALÉ, jamais en silence.
    val truncated = content.length > MAX_OUTPUT_CHARS
    val body = if (truncated) content.take(MAX_OUTPUT_CHARS) else content
    val bodyLines = revisionPlainLines(body.split("\n")).flatMap { plain ->
        if (plain.isBlank()) listOf(" ") else splitRevisionLine(plain, REVISION_PDF_WRAP)
    }
    // Filet de sécurité : le PDF pagine, mais la fiche ne doit pas déborder.
    val capped = if (bodyLines.size > REVISION_PDF_MAX_LINES) {
        bodyLines.take(REVISION_PDF_MAX_LINES - 1) + listOf(REVISION_PDF_TRUNCATED)
    } else {
        bodyLines
    }
    val raw = listOf(sheet.title, "${sheet.subject} — ${localDay(sheet.date)}", "") +
        capped +
        (if (truncated) listOf(REVISION_PDF_TRUNCATED) else emptyList()) +
        listOf("", REVISION_SOURCES_HEADING) + sheet.sources.map { "- $it" } +
        listOf("", "Gabarit ${sheet.templateVersion}")
    return raw.flatMap { l -> if (l.trim().isEmpty()) listOf(" ") else splitRevisionLine(l, REVISION_PDF_WRAP) }
}

private fun splitRevisionLine(line: String, max: Int): List<String> {
    if (line.length <= max) return listOf(line.ifEmpty { " " })
    val words = line.split(Regex("\\s+"))
    val out = mutableListOf<String>()
    var cur = ""
    for (w in words) {
        val add = (if (cur.isEmpty()) 0 else 1) + w.length
        if (cur.length + add > max && cur.isNotEmpty()) {
            out.add(cur)
            cur = w
        } else {
            cur = if (cur.isEmpty()) w else "$cur $w"
        }
    }
    if (cur.isNotEmpty()) out.add(cur)
    return out.ifEmpty { listOf(" ") }
}
