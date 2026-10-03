package fr.veryslopnynotes.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.util.Locale

// #78 évaluations par compétences : chips de compétences + détail note/matière.
// org.json = SDK Android, android.graphics.Color = plateforme : aucune
// dépendance ajoutée. Le payload est une donnée structurée du contrat : on lit
// des champs, jamais de texte libre interprété (I6).
//
// Règles d'affichage :
//  - une compétence sans note (note null côté serveur) s'affiche "non noté" :
//    elle n'entre dans aucun calcul, le serveur renvoie value = null ;
//  - état stable : la sélection est un skillId (clé stable, jamais une
//    position), `key(skillId)` fige l'identité des chips et le détail est
//    dérivé d'une map immuable -> pas de disparition/rebond au refresh ;
//  - établissement sans compétences = une seule ligne d'état vide, pas d'écran
//    cassé ni de spinner.

data class SkillChipUi(
    val id: String,
    val label: String,
    /** #RRGGBB : couleur publiée, sinon dérivée de l'id (stable par compétence). */
    val color: String,
    /** Moyenne sur /20 des notes définies, null si la compétence n'en a aucune. */
    val value: Double?,
    val evaluationCount: Int,
)

data class EvaluationDetailUi(
    val id: String,
    val subject: String,
    val label: String,
    val note: Double?,
    val scale: Double,
    val date: String,
)

data class CompetenciesUi(
    val skills: List<SkillChipUi>,
    /** Détails par skillId (ordre du payload = ordre d'affichage stable). */
    val details: Map<String, List<EvaluationDetailUi>>,
)

private val HEX_COLOR = Regex("^#[0-9a-fA-F]{6}$")
private const val SKILL_LABEL_MAX = 100

/** Note affichée : "non noté" si absente, sinon "12,50/20" (français, /20). */
fun noteLabel(note: Double?, scale: Double = 20.0): String {
    if (note == null) return "non noté"
    val barème = if (scale % 1.0 == 0.0) scale.toInt().toString() else scale.toString()
    return String.format(Locale.FRANCE, "%.2f/%s", note, barème)
}

// ponytail: hash 31 sur l'id = couleur déterministe, pas de palette externe.
// Upgrade: palette de l'établissement (#82) quand le serveur publie la sienne.
private fun stableColorFor(id: String): String {
    var h = 7L
    for (c in id) h = (h * 31L + c.code.toLong()) and 0xFFFFFFL
    return String.format("#%06x", h)
}

/** Couleur de chip : #RRGGBB publié par le serveur, sinon dérivée de l'id. */
fun chipColor(skillId: String, published: String): String =
    if (HEX_COLOR.matches(published)) published else stableColorFor(skillId)

private fun parseChipColor(hex: String): Color = try {
    Color(android.graphics.Color.parseColor(hex))
} catch (_: Exception) {
    Color(0xFF37474F)
}

private fun JSONObject.nullableDouble(key: String): Double? {
    if (isNull(key)) return null
    val v = optDouble(key, Double.NaN)
    return if (v.isNaN()) null else v
}

private fun JSONObject.boundedText(key: String, max: Int): String = optString(key, "").trim().take(max)

/** Payload /v1/evaluations -> chips + détails. Payload vide/illisible = état vide. */
fun competenciesFrom(payload: String): CompetenciesUi = try {
    val root = JSONObject(payload)
    val colors = HashMap<String, String>()
    val skillsArray = root.optJSONArray("skills")
    for (i in 0 until (skillsArray?.length() ?: 0)) {
        val s = skillsArray?.optJSONObject(i) ?: continue
        val id = s.boundedText("id", 64)
        if (id.isEmpty()) continue
        colors[id] = s.optString("color", "")
    }
    val chips = ArrayList<SkillChipUi>()
    val summary = root.optJSONArray("summary")
    for (i in 0 until (summary?.length() ?: 0)) {
        val s = summary?.optJSONObject(i) ?: continue
        val id = s.boundedText("skillId", 64)
        val label = s.boundedText("label", SKILL_LABEL_MAX)
        if (id.isEmpty() || label.isEmpty()) continue
        chips.add(
            SkillChipUi(
                id = id,
                label = label,
                color = chipColor(id, colors[id] ?: ""),
                value = s.nullableDouble("value"),
                evaluationCount = optIntCount(s, "evaluationCount"),
            ),
        )
    }
    val details = LinkedHashMap<String, MutableList<EvaluationDetailUi>>()
    val evaluations = root.optJSONArray("evaluations")
    for (i in 0 until (evaluations?.length() ?: 0)) {
        val e = evaluations?.optJSONObject(i) ?: continue
        val id = e.boundedText("skillId", 64)
        if (id.isEmpty()) continue
        val subject = e.boundedText("subject", 100)
        val label = e.boundedText("label", 200)
        if (subject.isEmpty() || label.isEmpty()) continue
        val entry = EvaluationDetailUi(
            id = e.boundedText("id", 64),
            subject = subject,
            label = label,
            note = e.nullableDouble("note"),
            scale = e.nullableDouble("scale") ?: 20.0,
            date = e.boundedText("date", 40),
        )
        details.getOrPut(id) { ArrayList() }.add(entry)
    }
    CompetenciesUi(chips, details)
} catch (_: Exception) {
    // Cache ancien, réponse tronquée, texte libre : état vide propre, pas de crash.
    CompetenciesUi(emptyList(), emptyMap())
}

private fun optIntCount(o: JSONObject, key: String): Int {
    val v = o.optInt(key, 0)
    return if (v < 0) 0 else v
}

/** Chips de compétences + détail stable. `payload` = cache serveur ou null. */
@Composable
fun CompetencesSection(payload: String?) {
    val ui = remember(payload) { if (payload == null) CompetenciesUi(emptyList(), emptyMap()) else competenciesFrom(payload) }
    // Clé = skills (liste immuable) : la sélection repart à vide quand le
    // payload change, jamais de chip sélectionnée fantôme.
    var selectedId by remember(ui.skills) { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (ui.skills.isEmpty()) {
            Text("Aucune compétence publiée par l'établissement.")
            return@Column
        }
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (skill in ui.skills) {
                // Clé stable = skillId : l'identité de la chip ne bouge pas au recomposition.
                key(skill.id) {
                    SkillChip(
                        label = skill.label,
                        value = skill.value,
                        count = skill.evaluationCount,
                        color = skill.color,
                        selected = skill.id == selectedId,
                        onClick = { selectedId = if (selectedId == skill.id) null else skill.id },
                    )
                }
            }
        }
        val detail = selectedId?.let { id -> ui.details[id] }
        if (detail == null) {
            Text("Touchez une compétence pour son détail.")
        } else {
            Text("Détail compétence")
            for (e in detail) {
                Text("${e.subject} — ${e.label} : ${noteLabel(e.note, e.scale)} (${e.date.take(10)})")
            }
        }
    }
}

@Composable
private fun SkillChip(
    label: String,
    value: Double?,
    count: Int,
    color: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        color = parseChipColor(color),
        shape = MaterialTheme.shapes.small,
        tonalElevation = if (selected) 4.dp else 0.dp,
        onClick = onClick,
    ) {
        Text(
            text = "$label ${noteLabel(value)} ($count)",
            color = Color.White,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}
