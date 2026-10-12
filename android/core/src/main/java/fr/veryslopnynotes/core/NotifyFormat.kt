package fr.veryslopnynotes.core

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Formatage des notifications sur données structurées (port Kotlin #207).
//
// Porté de `server/jobs/notify.ts` (supprimé en #210 : ce port est la source
// de vérité). Push sur delta uniquement, premier
// passage silencieux, fan-out un envoi par appareil, échec local par appareil
// (fail-soft). Aucun appel LLM, aucune sortie libre ne déclenche d'envoi (I7).
// Logs = compteurs seuls, jamais de token en clair.
//
// Differences assumées (même comportement observable) :
// - `GradePushSender.send` est bloquant : `core` n'a pas de coroutines (zéro
//   dépendance), l'appelant expose le thread ;
// - `notifySyncResult` prend `firstRun` + événements au lieu du `SyncResult`
//   du moteur (sync = #208, hors périmètre) : `firstRun = true` reste silencieux.
// - `GradeEvent` est la vue minimale de l'enveloppe `ContractEvent` : seul
//   `GradeCreated` portant une note valide déclenche.
//
// Pur : aucun réseau, aucun SQLite, aucun Android (I3).
//
// ponytail: un seul fuseau d'affichage (élève France). Upgrade: fuseau par
// établissement quand multi-écoles.

private val PARIS_ZONE: ZoneId = ZoneId.of("Europe/Paris")
private val ISO_DAY_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

/** Largeur d'un jour civil « AAAA-MM-JJ » (repli contrat, jamais une date affichée). */
private const val ISO_DAY_CHARS = 10

/**
 * Jour civil d'un instant ISO, « AAAA-MM-JJ », vu par l'élève (fuseau
 * Europe/Paris ; ex-miroir du helper contrat TS, supprimé en #210) : instant
 * illisible = dix premiers caractères, jamais d'exception.
 */
fun localDay(iso: String): String {
    val instant = try {
        OffsetDateTime.parse(iso).toInstant()
    } catch (_: Exception) {
        try {
            LocalDateTime.parse(iso).atZone(ZoneId.systemDefault()).toInstant()
        } catch (_: Exception) {
            // Instant illisible : la référence renvoie la tranche (`iso.slice`)
            // — repli contrat rejoué en parité, jamais une date affichée.
            return iso.take(ISO_DAY_CHARS)
        }
    }
    return instant.atZone(PARIS_ZONE).format(ISO_DAY_FORMAT)
}

/** ISO lisible (horodaté, mural ou date seule) : ce que `Date.parse` TS accepte. */
internal fun isIsoDateLike(value: String): Boolean {
    return try {
        OffsetDateTime.parse(value)
        true
    } catch (_: Exception) {
        try {
            LocalDateTime.parse(value)
            true
        } catch (_: Exception) {
            try {
                LocalDate.parse(value)
                true
            } catch (_: Exception) {
                false
            }
        }
    }
}

private const val ELLIPSIS = "…"

private fun cleanPush(s: String, max: Int): String {
    val t = s.trim().replace(Regex("\\s+"), " ")
    if (t.length <= max) return t
    // Troncature JAMAIS au milieu d'une paire de substitution : un demi-substitut
    // est du UTF-16 invalide côté appareil. On retire le substitut haut isolé.
    var cut = t.substring(0, maxOf(0, max - ELLIPSIS.length))
    val last = cut.lastOrNull()
    if (last != null && last in '\uD800'..'\uDBFF') cut = cut.dropLast(1)
    return cut + ELLIPSIS
}

private val TOKEN_HASH_RE = Regex("^[0-9a-f]{64}$", RegexOption.IGNORE_CASE)

/** Empreinte token push = hex sha256 (64 chars). Partagé jobs/infra. */
fun isTokenHash(value: String?): Boolean = value != null && TOKEN_HASH_RE.matches(value)

/** Appareil destinataire : id + empreinte (jamais le token brut). */
data class PushDevice(
    val id: String,
    val tokenHash: String,
)

/** Envoi structurel (compatible provider push sans import de lane). */
interface GradePushSender {
    fun send(deviceTokenHash: String, title: String, body: String)

    /**
     * `false` = ce sender ne transmet rien (provider noop) : le job ne compte
     * alors AUCUNE livraison. Un « succès » qui n'a rien envoyé est une
     * notification perdue qui se croit notifiée.
     */
    val delivers: Boolean
        get() = true
}

/** Titre + corps bornés d'un push. */
data class GradePush(
    val title: String,
    val body: String,
)

/** Vue minimale d'un événement : seul `GradeCreated` valide déclenche. */
data class GradeEvent(
    val type: String,
    val data: Grade?,
)

data class NotifyResult(
    val sent: Int,
    val failed: Int,
    /** Causes d'échec, une par envoi non livré (rejeu/exploitation). */
    val errors: List<String>,
    val events: Int,
    val devices: Int,
)

/** Miroir de `isGrade` : c'est lui qui décide si un événement compte. */
fun isGradeValid(g: Grade): Boolean {
    if (g.id.isBlank() || g.accountId.isBlank() || g.subject.isBlank()) return false
    if (!g.value.isFinite() || g.value < 0) return false
    if (!g.scale.isFinite() || g.scale <= 0) return false
    val c = g.coefficient
    if (c != null && (!c.isFinite() || c <= 0)) return false
    if (!isIsoDateLike(g.date)) return false
    for (n in listOf(g.classAverage, g.classMin, g.classMax)) {
        if (n != null && !n.isFinite()) return false
    }
    if (g.periodId != null && g.periodId.isBlank()) return false
    return true
}

/** Cause d'échec journalisable : nom + message, jamais l'empreinte complète. */
fun errorCause(name: String?, message: String): String {
    val n = name ?: "Error"
    val redacted = Regex("[0-9a-f]{64}", RegexOption.IGNORE_CASE)
        .replace(message) { "${it.value.substring(0, 8)}…" }
    return "$n: $redacted".take(200)
}

fun formatGradePush(grade: Grade): GradePush {
    val subject = grade.subject.trim().ifEmpty { "note" }
    val title = cleanPush("Nouvelle note en $subject", 120)
    val c = grade.coefficient
    val coeff = if (c != null && c != 0.0 && !c.isNaN()) " (coeff ${jsNum(c)})" else ""
    val body = cleanPush("${jsNum(grade.value)}/${jsNum(grade.scale)} en $subject$coeff", 1000)
    return GradePush(title = title, body = body)
}

fun notifyGradeEvents(
    events: List<GradeEvent>,
    devices: List<PushDevice>,
    sender: GradePushSender,
    logger: (String) -> Unit = {},
): NotifyResult {
    val grades = mutableListOf<Grade>()
    val seen = mutableSetOf<String>()
    for (e in events) {
        if (e.type != "GradeCreated") continue
        val g = e.data ?: continue
        if (!isGradeValid(g)) continue
        // Dedup par identité stable (id de note) : le rejeu d'un même lot ne
        // notifie pas deux fois la même note.
        if (!seen.add(g.id)) continue
        grades.add(g)
    }
    val targets = devices.filter { isTokenHash(it.tokenHash) }
    if (!sender.delivers) {
        logger("notify grades skipped push=indisponible events=${grades.size} devices=${targets.size}")
        return NotifyResult(sent = 0, failed = 0, errors = emptyList(), events = grades.size, devices = targets.size)
    }
    var sent = 0
    var failed = 0
    val errors = mutableListOf<String>()
    for (g in grades) {
        val payload = formatGradePush(g)
        for (d in targets) {
            try {
                sender.send(d.tokenHash, payload.title, payload.body)
                sent += 1
            } catch (err: Exception) {
                failed += 1
                // La cause reste visible (log ET résultat du job), jamais avalée.
                val cause = errorCause(err.javaClass.simpleName, err.message ?: "")
                errors.add(cause)
                logger("notify push error $cause")
            }
        }
    }
    logger("notify grades events=${grades.size} devices=${targets.size} sent=$sent failed=$failed")
    return NotifyResult(sent = sent, failed = failed, errors = errors, events = grades.size, devices = targets.size)
}

/** Premier passage silencieux : aucun envoi même avec des événements. */
fun notifySyncResult(
    firstRun: Boolean,
    events: List<GradeEvent>,
    devices: List<PushDevice>,
    sender: GradePushSender,
    logger: (String) -> Unit = {},
): NotifyResult {
    if (firstRun) {
        logger("notify grades skipped firstRun devices=${devices.size}")
        return NotifyResult(sent = 0, failed = 0, errors = emptyList(), events = 0, devices = devices.size)
    }
    return notifyGradeEvents(events, devices, sender, logger)
}

// --- Vie scolaire : nouvelle absence sur DONNÉES STRUCTURÉES ---
// Comparaison d'EMPREINTES d'enregistrements (comme diffAgainstPrints pour les
// notes) : aucun LLM, aucune sortie libre sur le chemin d'un effet métier (I7).

/**
 * Empreinte stable d'une absence : TOUT son contenu publié + son id. Une
 * absence corrigée a donc une empreinte différente = nouvelle notification,
 * alors qu'un rejeu du même lot ne notifie rien.
 */
fun absenceFingerprint(r: AbsenceRecord): String {
    val parts = listOf(
        jsonStr(r.id),
        jsonStr(r.kind),
        jsonStr(r.date),
        r.dateEnd?.let { jsonStr(it) } ?: "null",
        r.subject?.let { jsonStr(it) } ?: "null",
        r.motif?.let { jsonStr(it) } ?: "null",
        r.periodId?.let { jsonStr(it) } ?: "null",
        r.durationMinutes?.let { jsNum(it) } ?: "null",
        r.justified?.toString() ?: "null",
    )
    return "[${parts.joinToString(",")}]"
}

/** Absences dont l'empreinte n'est pas dans le lot déjà notifié. */
fun newAbsences(previousFingerprints: List<String>, records: List<AbsenceRecord>): List<AbsenceRecord> {
    val seen = previousFingerprints.toSet()
    return records.filter { isAbsenceRecord(it) && !seen.contains(absenceFingerprint(it)) }
}

fun formatAbsencePush(record: AbsenceRecord): GradePush {
    val title = cleanPush(if (record.kind == "late") "Nouveau retard" else "Nouvelle absence", 120)
    val where = if (!record.subject.isNullOrEmpty()) " en ${record.subject}" else ""
    val motif = if (!record.motif.isNullOrEmpty()) " — ${record.motif}" else ""
    return GradePush(title = title, body = cleanPush("${localDay(record.date)}$where$motif", 1000))
}
