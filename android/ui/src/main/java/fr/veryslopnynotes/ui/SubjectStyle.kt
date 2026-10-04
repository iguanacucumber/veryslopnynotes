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
// #137 : `subjectColorHex` entre en scène — la couleur de matière ne sert plus
// seulement à une légende, elle colore la CARTE de cours de l'EDT, et une
// matière sans prefs reçoit une couleur dérivée de son nom.
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

/**
 * Somme de hachage STABLE d'un nom de matière : `fold(31)` sur les caractères,
 * et non `String.hashCode()`.
 *
 * `hashCode` est spécifié par le JDK donc stable d'une JVM à l'autre, mais le
 * miroir TS de `tests/unit/android-timetable.test.ts` doit le recalculer à la
 * main ; un `fold` de sept lignes se réécrit dans n'importe quelle langue,
 * donc les deux implémentations ne peuvent pas diverger.
 */
private fun stableHash(value: String): Long {
    var acc = 7L
    for (c in value) acc = (acc * 31L + c.code.toLong()) and 0xFFFFFFFFL
    return acc
}

/**
 * Couleur de repli d'une matière SANS préférences : une couleur de la palette
 * du thème (#134), choisie par le nom — donc STABLE d'un écran à l'autre, d'une
 * session à l'autre, et identique pour deux matières homonymes.
 *
 * AVANT #137, une matière sans prefs n'avait aucune couleur : la carte de cours
 * n'existait pas et l'EDT affichait une chaîne en encre de matière, ou le gris
 * si la matière n'avait pas de prefs du tout. Une couleur DÉRIVÉE du nom vaut
 * mieux qu'une palette tirée au sort à chaque composition : la colonne
 * vertébrale d'un cours de Maths doit être la même partout.
 *
 * La liste vient du thème, donc aucune couleur n'est inventée ici, et les
 * 20 entrées ont déjà été MESURÉES par `android-papillon-theme.test.ts`
 * (`subjectContent` y repasse 4.5:1 sur les 20).
 *
 * ponytail: hachage + modulo sur la palette existante, pas une dérive
 * HSL/HSV du nom (qui produirait des pastels non mesurés). Upgrade: une couleur
 * dérivée par matière vraiment propre — les prefs, qui existent déjà.
 */
fun derivedSubjectHex(subject: String): String {
    val name = subject.trim().lowercase()
    // `stableHash` est masqué sur 32 bits non négatifs, donc le modulo est
    // toujours dans la palette : fonction TOTALE, aucun repli à inventer.
    val index = (stableHash(name) % SubjectPalette.size).toInt()
    return SubjectPalette[index]
}

/**
 * Couleur de prefs NORMALISÉE : `" #aabbcc "` → `"#AABBCC"`, `null` si elle est
 * absente ou mal formée.
 *
 * #140 : la roue de pastilles de l'éditeur de matière doit comparer la couleur
 * choisie à une pastille sans distinguer la casse ni les espaces de saisie, et
 * une couleur douteuse ne doit jamais être rendue comme si elle était valide.
 * La RÈGLE reste celle de la résolution (`COLOR_RE`) : six chiffres hexadécimaux
 * après un `#`, rien de plus.
 *
 * ponytail: `trim` + `uppercase` + la regex existante, pas de parseur de
 * couleur, et pas de `Color` ici — cette fonction est testable sans Compose.
 */
fun normalizeColorHex(hex: String?): String? {
    val trimmed = hex?.trim().orEmpty()
    return if (COLOR_RE.matches(trimmed)) trimmed.uppercase() else null
}

/**
 * Couleur de matière affichée : les préférences d'abord, sinon une couleur
 * dérivée du nom. Une couleur de prefs INVALIDE (le contrat la borne, mais un
 * cache ancien peut contenir autre chose) est ignorée comme si elle manquait.
 */
fun subjectColorHex(prefs: List<SubjectPrefs>, subject: String): String {
    val prefHex = subjectStyle(prefs, subject).colorHex
    if (prefHex != null && COLOR_RE.matches(prefHex)) return prefHex
    return derivedSubjectHex(subject)
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
