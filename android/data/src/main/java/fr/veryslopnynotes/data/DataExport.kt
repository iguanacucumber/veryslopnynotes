package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.LessonNote
import fr.veryslopnynotes.core.LessonNotes
import fr.veryslopnynotes.core.TeacherChat
import fr.veryslopnynotes.core.TeacherChatMessage
import fr.veryslopnynotes.core.TeacherChatSourceMeta
import fr.veryslopnynotes.core.TeacherThread
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json

/**
 * Export local et portable de la donnée de l'utilisateur : notes (carnet),
 * cahier de cours, fil du professeur, manuel choisi, préférences matière et
 * état de lecture.
 *
 * Ce qui n'entre JAMAIS ici : jeton de session, clé du fournisseur, adresse du
 * serveur, identifiants. Aucun champ n'est recopié d'un store chiffré ; les
 * payloads de notes passent par une liste de clés interdites avant d'être
 * publiés. Le manifeste NOMME ces exclusions pour que le format le dise.
 *
 * Fichier PUR (`pronote.Json` seul, pas d'`android.*` ni d'`org.json`) : le
 * harnais de parité l'EXÉCUTE et rejoue l'aller-retour build -> parse.
 */
object DataExport {
    const val FORMAT = "veryslopnynotes.data-export"
    const val SCHEMA_VERSION = 1
    const val MAX_BYTES = 8 * 1024 * 1024
    const val MAX_GRADE_PAYLOADS = 32
    const val MAX_GRADES = 5_000
    const val MAX_MANUAL_DOCS = 8
    const val MAX_MANUAL_SUBJECTS = 32
    const val MAX_SUBJECTS = 64
    const val MAX_READ_IDS = 500
    const val MAX_READ_ID_CHARS = 200
    const val MAX_EXCERPT_CHARS = 8_000

    /** Noms des familles retenues hors du fichier, jamais leurs valeurs. */
    val WITHHELD: List<String> = listOf(
        "sessionToken",
        "llmKey",
        "serverUrl",
        "manualSourceUrl",
        "credentials",
    )

    /**
     * Clés qu'aucune donnée recopiée (payload de notes) ne peut porter. Une
     * ligne qui en contient est écartée : le fichier exporté circule hors de
     * l'appareil, une fuite y serait définitive.
     */
    internal val FORBIDDEN_KEYS = setOf(
        "token",
        "access_token",
        "refresh_token",
        "jeton",
        "password",
        "passwd",
        "motdepasse",
        "apikey",
        "api_key",
        "authorization",
        "cookie",
        "cookies",
        "credentials",
        "serverurl",
        "server_url",
        "baseurl",
        "base_url",
        "llmkey",
        "llm_key",
    )
}

data class ExportSection(val name: String, val count: Int, val skipped: Int = 0)

data class ExportManifest(
    val schemaVersion: Int,
    val sections: List<ExportSection>,
    val withheld: List<String>,
)

data class SubjectSnapshot(
    val subject: String,
    val color: String?,
    val emoji: String?,
    val label: String?,
    val updatedAt: String,
)

data class ManualDocSnapshot(
    val title: String,
    val subject: String,
    val page: Int,
    val excerpt: String,
)

/** Données du manuel SANS l'adresse qui les a produites (voir [DataExport.WITHHELD]). */
data class ManualSnapshot(
    val classLabel: String,
    val subjects: List<String>,
    val disabledSubjects: List<String>,
    val docs: List<ManualDocSnapshot>,
)

data class ExportInput(
    val exportedAt: String,
    val grades: List<String> = emptyList(),
    val notes: List<LessonNote> = emptyList(),
    val teacherChat: TeacherThread = TeacherThread(),
    val manual: ManualSnapshot? = null,
    val subjects: List<SubjectSnapshot> = emptyList(),
    val newsReadIds: List<String> = emptyList(),
)

data class ExportDocument(
    val exportedAt: String,
    val manifest: ExportManifest,
    val grades: List<JVal.Obj>,
    val notes: List<LessonNote>,
    val teacherChat: TeacherThread,
    val manual: ManualSnapshot?,
    val subjects: List<SubjectSnapshot>,
    val newsReadIds: List<String>,
)

/** Construit le JSON stable ; les lignes hors contrat sont comptées, jamais recopiées. */
fun buildDataExport(input: ExportInput): String {
    val grades = ArrayList<JVal.Obj>()
    val seen = HashSet<String>()
    var skipped = 0
    for (payload in input.grades.take(DataExport.MAX_GRADE_PAYLOADS)) {
        val root = try {
            Json.parse(payload) as? JVal.Obj
        } catch (_: Exception) {
            null
        }
        if (root == null) {
            skipped += 1
            continue
        }
        val rows = (root.fields["grades"] as? JVal.Arr)?.items ?: emptyList()
        for (row in rows) {
            if (grades.size >= DataExport.MAX_GRADES) break
            val obj = row as? JVal.Obj
            if (obj == null || containsForbiddenKey(obj)) {
                skipped += 1
                continue
            }
            val id = obj.string("id")?.takeIf { it.isNotBlank() }
            if (id != null && !seen.add(id)) continue
            grades.add(obj)
        }
    }

    val notes = input.notes.filter { LessonNote.isValid(it) }.take(LessonNotes.MAX_NOTES)
    val chat = TeacherChat.trimThread(input.teacherChat)
    val manual = input.manual?.let { sanitizeManual(it) }
    val subjects = input.subjects
        .filter { SubjectPrefRules.invalidField(it.subject, it.color, it.emoji, it.label) == null }
        .filter { it.updatedAt.trim().isNotEmpty() && it.updatedAt.length <= 40 }
        .take(DataExport.MAX_SUBJECTS)
    val readIds = input.newsReadIds
        .map { it.trim().take(DataExport.MAX_READ_ID_CHARS) }
        .filter { it.isNotEmpty() }
        .distinct()
        .take(DataExport.MAX_READ_IDS)

    val sections = listOf(
        ExportSection("grades", grades.size, skipped),
        ExportSection("notes", notes.size),
        ExportSection("teacherChat", chat.messages.size),
        ExportSection("manual", manual?.docs?.size ?: 0),
        ExportSection("subjectPrefs", subjects.size),
        ExportSection("newsReadState", readIds.size),
    )
    val manifest = ExportManifest(DataExport.SCHEMA_VERSION, sections, DataExport.WITHHELD)

    val root = jobj(
        "format" to JVal.Str(DataExport.FORMAT),
        "schemaVersion" to jnum(DataExport.SCHEMA_VERSION),
        "exportedAt" to JVal.Str(input.exportedAt),
        "manifest" to manifestJson(manifest),
        "grades" to JVal.Arr(grades),
        "notes" to JVal.Arr(notes.map { noteJson(it) }),
        "teacherChat" to chatJson(chat),
        "manual" to (manual?.let { manualJson(it) } ?: JVal.Null),
        "subjectPrefs" to JVal.Arr(subjects.map { subjectJson(it) }),
        "readState" to jobj("news" to JVal.Arr(readIds.map { JVal.Str(it) })),
    )
    return Json.stringify(root)
}

/** `null` = format, version ou contenu hors contrat : un import ne devine rien. */
fun parseDataExport(raw: String): ExportDocument? = try {
    val root = Json.parse(raw) as? JVal.Obj ?: return null
    if (root.string("format") != DataExport.FORMAT) return null
    if (root.int("schemaVersion") != DataExport.SCHEMA_VERSION) return null
    val exportedAt = root.string("exportedAt")?.trim().orEmpty()
    if (exportedAt.isEmpty() || exportedAt.length > 40) return null
    val manifest = parseManifest(root.fields["manifest"] as? JVal.Obj) ?: return null

    val grades = ArrayList<JVal.Obj>()
    val rows = (root.fields["grades"] as? JVal.Arr)?.items ?: emptyList()
    if (rows.size > DataExport.MAX_GRADES) return null
    for (row in rows) {
        val obj = row as? JVal.Obj ?: return null
        if (containsForbiddenKey(obj)) return null
        grades.add(obj)
    }

    val notes = ArrayList<LessonNote>()
    for (item in (root.fields["notes"] as? JVal.Arr)?.items.orEmpty()) {
        val note = parseNote(item as? JVal.Obj ?: return null) ?: return null
        notes.add(note)
    }

    val chat = parseChat(root.fields["teacherChat"] as? JVal.Obj ?: return null) ?: return null

    val manual = when (val node = root.fields["manual"]) {
        null, JVal.Null -> null
        is JVal.Obj -> parseManual(node) ?: return null
        else -> return null
    }

    val subjects = ArrayList<SubjectSnapshot>()
    for (item in (root.fields["subjectPrefs"] as? JVal.Arr)?.items.orEmpty()) {
        subjects.add(parseSubject(item as? JVal.Obj ?: return null) ?: return null)
    }

    val readIds = ArrayList<String>()
    val readState = root.fields["readState"] as? JVal.Obj ?: return null
    for (item in (readState.fields["news"] as? JVal.Arr)?.items.orEmpty()) {
        val id = (item as? JVal.Str)?.value?.trim().orEmpty()
        if (id.isEmpty() || id.length > DataExport.MAX_READ_ID_CHARS) return null
        if (readIds.size >= DataExport.MAX_READ_IDS) return null
        readIds.add(id)
    }

    ExportDocument(exportedAt, manifest, grades, notes, chat, manual, subjects, readIds)
} catch (_: Exception) {
    null
}

private fun containsForbiddenKey(value: JVal): Boolean = when (value) {
    is JVal.Obj -> value.fields.entries.any { (key, child) ->
        key.trim().lowercase() in DataExport.FORBIDDEN_KEYS || containsForbiddenKey(child)
    }
    is JVal.Arr -> value.items.any { containsForbiddenKey(it) }
    else -> false
}

private fun sanitizeManual(manual: ManualSnapshot): ManualSnapshot {
    val docs = manual.docs.asSequence()
        .mapNotNull { doc ->
            val title = doc.title.trim().take(200)
            val subject = doc.subject.trim().take(100)
            val excerpt = doc.excerpt.trim().take(DataExport.MAX_EXCERPT_CHARS)
            if (title.isEmpty() || subject.isEmpty() || doc.page < 1 || excerpt.isEmpty()) {
                null
            } else {
                ManualDocSnapshot(title, subject, doc.page, excerpt)
            }
        }
        .take(DataExport.MAX_MANUAL_DOCS)
        .toList()
    return ManualSnapshot(
        classLabel = manual.classLabel.trim().take(64),
        subjects = manual.subjects.map { it.trim().take(100) }.filter { it.isNotEmpty() }
            .distinct().take(DataExport.MAX_MANUAL_SUBJECTS),
        disabledSubjects = manual.disabledSubjects.map { it.trim().take(100) }.filter { it.isNotEmpty() }
            .distinct().take(DataExport.MAX_MANUAL_SUBJECTS),
        docs = docs,
    )
}

private fun parseManifest(node: JVal.Obj?): ExportManifest? {
    if (node == null) return null
    if (node.int("schemaVersion") != DataExport.SCHEMA_VERSION) return null
    val sections = ArrayList<ExportSection>()
    val items = (node.fields["sections"] as? JVal.Arr)?.items ?: return null
    if (items.size > 16) return null
    for (item in items) {
        val obj = item as? JVal.Obj ?: return null
        val name = obj.string("name")?.trim().orEmpty()
        val count = obj.int("count") ?: return null
        val skipped = obj.int("skipped") ?: 0
        if (name.isEmpty() || name.length > 40 || count < 0 || skipped < 0) return null
        sections.add(ExportSection(name, count, skipped))
    }
    val withheld = ArrayList<String>()
    for (item in (node.fields["withheld"] as? JVal.Arr)?.items.orEmpty()) {
        val value = (item as? JVal.Str)?.value?.trim().orEmpty()
        if (value.isEmpty() || value.length > 40) return null
        withheld.add(value)
    }
    return ExportManifest(DataExport.SCHEMA_VERSION, sections, withheld)
}

private fun parseNote(node: JVal.Obj): LessonNote? {
    val note = LessonNote(
        id = node.string("id")?.trim().orEmpty(),
        subject = node.string("subject")?.trim().orEmpty(),
        title = node.string("title")?.trim().orEmpty(),
        text = node.string("text")?.trim().orEmpty(),
        createdAt = node.string("createdAt")?.trim().orEmpty(),
    )
    return note.takeIf { LessonNote.isValid(it) }
}

private fun parseChat(node: JVal.Obj): TeacherThread? {
    val subject = node.string("subject")?.trim().orEmpty()
    val messages = ArrayList<TeacherChatMessage>()
    for (item in (node.fields["messages"] as? JVal.Arr)?.items.orEmpty()) {
        if (messages.size >= TeacherChat.MAX_STORED_MESSAGES) return null
        val message = parseMessage(item as? JVal.Obj ?: return null) ?: return null
        messages.add(message)
    }
    return TeacherThread(subject, messages).takeIf { it.isValid() }
}

private fun parseMessage(node: JVal.Obj): TeacherChatMessage? {
    val sources = ArrayList<String>()
    for (item in (node.fields["sources"] as? JVal.Arr)?.items.orEmpty()) {
        val value = (item as? JVal.Str)?.value?.trim().orEmpty()
        if (value.isEmpty()) return null
        sources.add(value)
    }
    val context = ArrayList<TeacherChatSourceMeta>()
    for (item in (node.fields["context"] as? JVal.Arr)?.items.orEmpty()) {
        val obj = item as? JVal.Obj ?: return null
        val meta = TeacherChatSourceMeta(
            type = obj.string("type")?.trim().orEmpty(),
            label = obj.string("label")?.trim().orEmpty(),
            chars = obj.int("chars") ?: return null,
            truncated = obj.bool("truncated") ?: false,
        )
        if (!meta.isValid()) return null
        context.add(meta)
    }
    val message = TeacherChatMessage(
        role = node.string("role")?.trim().orEmpty(),
        text = node.string("text")?.trim().orEmpty(),
        sources = sources,
        unsourced = node.bool("unsourced") ?: false,
        context = context,
        summaryChars = node.int("summaryChars") ?: 0,
    )
    return message.takeIf { it.isValid() }
}

private fun parseManual(node: JVal.Obj): ManualSnapshot? {
    val docs = ArrayList<ManualDocSnapshot>()
    for (item in (node.fields["docs"] as? JVal.Arr)?.items.orEmpty()) {
        if (docs.size >= DataExport.MAX_MANUAL_DOCS) return null
        val obj = item as? JVal.Obj ?: return null
        val doc = ManualDocSnapshot(
            title = obj.string("title")?.trim().orEmpty(),
            subject = obj.string("subject")?.trim().orEmpty(),
            page = obj.int("page") ?: return null,
            excerpt = obj.string("excerpt")?.trim().orEmpty(),
        )
        if (doc.title.isEmpty() || doc.title.length > 200) return null
        if (doc.subject.isEmpty() || doc.subject.length > 100) return null
        if (doc.page < 1 || doc.excerpt.isEmpty() || doc.excerpt.length > DataExport.MAX_EXCERPT_CHARS) return null
        docs.add(doc)
    }
    val classLabel = node.string("classLabel")?.trim().orEmpty()
    val subjects = parseStringList(node.fields["subjects"], DataExport.MAX_MANUAL_SUBJECTS) ?: return null
    val disabled = parseStringList(node.fields["disabledSubjects"], DataExport.MAX_MANUAL_SUBJECTS) ?: return null
    if (classLabel.length > 64) return null
    return ManualSnapshot(classLabel, subjects, disabled, docs)
}

private fun parseStringList(node: JVal?, max: Int): List<String>? {
    if (node !is JVal.Arr) return null
    if (node.items.size > max) return null
    val out = ArrayList<String>()
    for (item in node.items) {
        val value = (item as? JVal.Str)?.value?.trim().orEmpty()
        if (value.isEmpty() || value.length > 100) return null
        out.add(value)
    }
    return out
}

private fun parseSubject(node: JVal.Obj): SubjectSnapshot? {
    val subject = SubjectSnapshot(
        subject = node.string("subject")?.trim().orEmpty(),
        color = node.string("color")?.trim()?.takeIf { it.isNotEmpty() },
        emoji = node.string("emoji")?.trim()?.takeIf { it.isNotEmpty() },
        label = node.string("label")?.trim()?.takeIf { it.isNotEmpty() },
        updatedAt = node.string("updatedAt")?.trim().orEmpty(),
    )
    if (SubjectPrefRules.invalidField(subject.subject, subject.color, subject.emoji, subject.label) != null) {
        return null
    }
    if (subject.updatedAt.isEmpty() || subject.updatedAt.length > 40) return null
    return subject
}

private fun manifestJson(manifest: ExportManifest): JVal.Obj = jobj(
    "schemaVersion" to jnum(manifest.schemaVersion),
    "sections" to JVal.Arr(
        manifest.sections.map {
            jobj(
                "name" to JVal.Str(it.name),
                "count" to jnum(it.count),
                "skipped" to jnum(it.skipped),
            )
        },
    ),
    "withheld" to JVal.Arr(manifest.withheld.map { JVal.Str(it) }),
)

private fun noteJson(note: LessonNote): JVal.Obj = jobj(
    "id" to JVal.Str(note.id),
    "subject" to JVal.Str(note.subject),
    "title" to JVal.Str(note.title),
    "text" to JVal.Str(note.text),
    "createdAt" to JVal.Str(note.createdAt),
)

private fun chatJson(thread: TeacherThread): JVal.Obj = jobj(
    "subject" to JVal.Str(thread.subject),
    "messages" to JVal.Arr(thread.messages.map { messageJson(it) }),
)

private fun messageJson(message: TeacherChatMessage): JVal.Obj = jobj(
    "role" to JVal.Str(message.role),
    "text" to JVal.Str(message.text),
    "sources" to JVal.Arr(message.sources.map { JVal.Str(it) }),
    "unsourced" to JVal.Bool(message.unsourced),
    "context" to JVal.Arr(
        message.context.map {
            jobj(
                "type" to JVal.Str(it.type),
                "label" to JVal.Str(it.label),
                "chars" to jnum(it.chars),
                "truncated" to JVal.Bool(it.truncated),
            )
        },
    ),
    "summaryChars" to jnum(message.summaryChars),
)

private fun manualJson(manual: ManualSnapshot): JVal.Obj = jobj(
    "classLabel" to JVal.Str(manual.classLabel),
    "subjects" to JVal.Arr(manual.subjects.map { JVal.Str(it) }),
    "disabledSubjects" to JVal.Arr(manual.disabledSubjects.map { JVal.Str(it) }),
    "docs" to JVal.Arr(
        manual.docs.map {
            jobj(
                "title" to JVal.Str(it.title),
                "subject" to JVal.Str(it.subject),
                "page" to jnum(it.page),
                "excerpt" to JVal.Str(it.excerpt),
            )
        },
    ),
)

private fun subjectJson(subject: SubjectSnapshot): JVal.Obj = jobj(
    "subject" to JVal.Str(subject.subject),
    "color" to (subject.color?.let { JVal.Str(it) } ?: JVal.Null),
    "emoji" to (subject.emoji?.let { JVal.Str(it) } ?: JVal.Null),
    "label" to (subject.label?.let { JVal.Str(it) } ?: JVal.Null),
    "updatedAt" to JVal.Str(subject.updatedAt),
)

private fun jobj(vararg pairs: Pair<String, JVal>): JVal.Obj {
    val fields = LinkedHashMap<String, JVal>()
    for ((key, value) in pairs) fields[key] = value
    return JVal.Obj(fields)
}

private fun jnum(value: Int): JVal.Num = JVal.Num(value.toDouble())

private fun JVal.Obj.string(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.int(key: String): Int? {
    val number = (fields[key] as? JVal.Num)?.value ?: return null
    if (!number.isFinite() || number != number.toLong().toDouble()) return null
    if (number < Int.MIN_VALUE || number > Int.MAX_VALUE) return null
    return number.toInt()
}

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value
