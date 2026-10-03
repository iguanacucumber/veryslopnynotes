package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.SubjectPrefs
import org.json.JSONObject

// Préférences matière #83 : UN résolveur, utilisé par notes, devoirs et EDT.
// org.json = SDK Android (aucune dépendance ajoutée). Le payload reste une
// donnée structurée du contrat : on lit le champ `subject`, jamais de texte
// libre (I6). Aucune prefs = nom de matière seul, l'affichage existant ne
// change pas.
private const val SUBJECT_MAX_CHARS = 64

private val COLOR_RE = Regex("^#[0-9a-fA-F]{6}$")

/** Style résolu d'une matière : libellé (perso ou nom), couleur, emoji. */
data class SubjectStyle(val label: String, val colorHex: String?, val emoji: String?) {
    val badge: String get() = if (emoji.isNullOrEmpty()) label else "$emoji $label"
}

// Résolution : correspondance exacte, puis repli insensible à la casse (le
// nom vient de Pronote, la prefs saisie à la main). Jamais de matière inventée.
fun subjectStyle(prefs: List<SubjectPrefs>, subject: String): SubjectStyle {
    val name = subject.trim()
    val match = prefs.firstOrNull { it.subject == name }
        ?: prefs.firstOrNull { it.subject.equals(name, ignoreCase = true) }
    // ponytail: pas de prefs = nom seul (fallback propre, pas de couleur nulle).
    if (match == null) return SubjectStyle(name, null, null)
    val label = match.label?.trim()?.takeIf { it.isNotEmpty() } ?: name
    return SubjectStyle(label, match.color, match.emoji?.takeIf { it.isNotEmpty() })
}

// Matières d'un payload de ressource, dans l'ordre d'apparition et sans doublon
// (notes = grades, devoirs = assignments, EDT = entries).
fun subjectsFromPayload(payload: String): List<String> = try {
    val root = JSONObject(payload)
    val out = LinkedHashSet<String>()
    for (key in listOf("grades", "assignments", "entries")) {
        val arr = root.optJSONArray(key) ?: continue
        for (i in 0 until arr.length()) {
            val s = arr.optJSONObject(i)?.optString("subject")?.trim().orEmpty()
            if (s.isNotEmpty() && s.length <= SUBJECT_MAX_CHARS) out.add(s)
        }
    }
    out.toList()
} catch (_: Exception) {
    // Payload ancien/malformé = aucune matière, aucun crash.
    emptyList()
}

// #RRGGBB -> Color opaque, ou null si la couleur est absente/invalide.
// ponytail: parse hex maison, pas de ColorParser ni de palette Material.
fun colorFromHex(hex: String?): Color? {
    if (hex == null || !COLOR_RE.matches(hex)) return null
    val v = hex.substring(1).toLong(16)
    return Color(0xFF000000L or v)
}

// Légende matières : couleur + emoji + libellé perso, repli nom seul.
@Composable
fun SubjectLegend(subjects: List<String>, prefs: List<SubjectPrefs>) {
    if (subjects.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        for (subject in subjects) {
            val style = subjectStyle(prefs, subject)
            val color = colorFromHex(style.colorHex)
            Row(
                modifier = Modifier,
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (color != null) {
                    Text("■", color = color)
                }
                Text(style.badge)
            }
        }
    }
}
