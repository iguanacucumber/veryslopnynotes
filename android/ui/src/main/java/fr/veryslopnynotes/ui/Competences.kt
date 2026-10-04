package fr.veryslopnynotes.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
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
//
// #144 — les défauts de cet écran :
//   - la couleur de puce venait d'un HACHAGE du libellé (`stableColorFor`) et le
//     texte était forcé à `Color.White` : blanc sur le jaune `#E8B048` de la
//     palette mesurait 1.96:1, donc illisible. L'encre passe par [bestContentOn], qui
//     choisit entre l'encre de marque et le blanc PAR CONTRASTE MESURÉ, et la
//     `Surface` la propage au texte via `contentColor` : la paire fond/texte ne
//     peut plus diverger ;
//   - la sélection n'était signalée que par une élévation (4 dp) : invisible pour
//     un lecteur d'écran. Elle est portée par [Modifier.selectable] +
//     `stateDescription` (« Sélectionnée »), donc elle existe aussi hors du sens
//     visuel ;
//   - une compétence sélectionnée SANS évaluation retombait sur le texte
//     générique « Touchez une compétence pour son détail » : il a maintenant son
//     propre état vide, qui nomme la compétence.
//
// #145 : choisir une compétence VIBRER (le geste change un état invisible ailleurs)
// et le détail APPARAÎT — échelle 0.9 -> 1 + opacité, 300 ms mesurés — au lieu de
// remplacer le texte d'un coup. Le `key(selectedId)` est ce qui fait rejouer
// l'entrée à chaque sélection : sans lui, l'animation ne se jouerait qu'une fois,
// à l'ouverture de l'écran.

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

/** Épaisseur du filet qui porte la sélection d'une puce. */
private val SELECTED_BORDER = 2.dp

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

/**
 * FOND de puce : la couleur de la compétence, bornée en LUMINANCE.
 *
 * #144 : la puce prenait la couleur telle quelle — qu'elle vienne du serveur ou
 * d'un hachage — donc deux couleurs de luminance opposée donnaient deux écrans
 * de contraste opposés, et le texte ne pouvait pas être lisible sur les deux.
 * On applique donc le MÊME pas que Papillon pour une carte matière : [tint] à
 * 75 % vers le blanc (le pastel derrière le libellé). Le fond est alors toujours
 * clair, quelle que soit la teinte — c'est ce qui rend la paire mesurable.
 */
fun chipSurfaceColor(hex: String): Color = tint(parseChipColor(hex), .75f)

/**
 * ENCRE de puce, choisie par contraste mesuré.
 *
 * #144 : le texte était forcé à `Color.White` — blanc sur le jaune `#E8B048`
 * tombait à 1.96:1. [bestContentOn] compare l'encre de marque au blanc et garde
 * la meilleure des deux : sur un fond pastel c'est toujours l'encre, et le
 * contraste des 20 couleurs de la palette vaut 9.06:1 au pire (mesuré par le
 * miroir TS, comme celui de `subjectContent` sur `subjectSurface`).
 *
 * ponytail: deux fonctions PURES (couleur -> couleur), donc le contraste des 20
 * couleurs se teste sans téléphone.
 */
fun chipContentColor(background: Color): Color = bestContentOn(background)

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
    val haptics = rememberPapHaptics()
    // #144 : la section est DÉFILABLE — le détail d'une compétence peut compter
    // plusieurs évaluations, et la coquille qui l'héberge ne défile pas.
    Column(
        modifier = Modifier.verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (ui.skills.isEmpty()) {
            PapEmptyState(
                icon = Icons.Filled.Star,
                title = "Aucune compétence publiée par l'établissement.",
                description = "",
            )
            return@Column
        }
        SkillChipRow(ui.skills, selectedId) { id ->
            // #145 : le retour physique d'une sélection. « select » et non
            // « confirm » : rien n'est écrit, on change d'état à l'écran.
            haptics.select()
            selectedId = if (selectedId == id) null else id
        }
        val selected = ui.skills.firstOrNull { it.id == selectedId }
        val detail = selectedId?.let { id -> ui.details[id] }
        if (selected == null) {
            Text("Touchez une compétence pour son détail.")
        } else {
            key(selectedId) {
                PapEnter {
                    when {
                        // #144 : état VIDE DÉDIÉ. Avant, une compétence sans aucune
                        // évaluation retombait sur le texte ci-dessus — donc
                        // l'utilisateur ne pouvait pas savoir si son geste avait
                        // échoué ou si la matière était vide.
                        detail.isNullOrEmpty() -> PapEmptyState(
                            icon = Icons.Filled.Star,
                            title = "Aucune évaluation",
                            description = "L'établissement n'a publié aucune évaluation pour « ${selected.label} ».",
                        )
                        else -> {
                            // `heading()` : c'est le seul titre de la section de
                            // détail, donc le point d'entrée du survol.
                            Text(
                                text = "Détail compétence",
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.semantics { heading() },
                            )
                            for (e in detail) {
                                EvaluationRow(e)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Ligne de détail : matière, intitulé, note et date.
 *
 * Séparée de la boucle pour que l'écran ne fasse qu'une chose par ligne ; le
 * libellé est borné par le contrat (200 caractères) et affiché tel quel — c'est
 * une donnée de l'établissement, jamais une instruction (I6).
 */
@Composable
private fun EvaluationRow(entry: EvaluationDetailUi) {
    PapCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = entry.subject,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
            // `entry.label` est le libellé libre de l'établissement (200
            // caractères au contrat) : trois lignes, pas plus — au-delà, la carte
            // pousse la note hors de l'écran.
            Text(
                text = entry.label,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "${noteLabel(entry.note, entry.scale)} · ${entry.date.take(10)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * Rangée de puces DÉFILABLE.
 *
 * #144 : la rangée était une `Row` SANS défilement — donc toute puce au-delà de
 * la largeur de l'écran était INVISIBLE, sans file horizontale ni indication.
 * Le défilement est donc explicite, et la rangée occupe toute la largeur pour
 * que le geste s'y trouve.
 */
@Composable
private fun SkillChipRow(
    skills: List<SkillChipUi>,
    selectedId: String?,
    onSelect: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (skill in skills) {
            // Clé stable = skillId : l'identité de la puce ne bouge pas au
            // recomposition (le défilement horizontal la ferait sinon disparaître).
            key(skill.id) {
                SkillChip(
                    label = skill.label,
                    value = skill.value,
                    count = skill.evaluationCount,
                    color = skill.color,
                    selected = skill.id == selectedId,
                    onClick = { onSelect(skill.id) },
                )
            }
        }
    }
}

/**
 * Puce de compétence.
 *
 * Trois corrections #144 :
 *   - le fond vient de [chipSurfaceColor] (borné en luminance) et l'encre de
 *     [chipContentColor], propagée par la `Surface` : plus de blanc en dur sur
 *     un fond clair (1.96:1 avant, blanc sur le jaune de la palette) ;
 *   - la sélection est un [Modifier.selectable] : Compose pose `Role.Tab` /
 *     `selected` dans l'arbre de sémantique, donc un lecteur d'écran annonce
 *     « sélectionné ». Visuellement, elle est portée par un FILET de 2 dp (et
 *     plus par la seule élévation, invisible au lecteur d'écran) ;
 *   - `stateDescription` nomme l'état en français (« Sélectionnée »).
 */
@Composable
private fun SkillChip(
    label: String,
    value: Double?,
    count: Int,
    color: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val background = chipSurfaceColor(color)
    // L'encre n'est PAS `contentColorFor(fond)` : en material3 1.2.1 cette
    // fonction renvoie `LocalContentColor` pour toute couleur qui n'est pas un
    // rôle du scheme — donc l'encre du conteneur, mesurée nulle part. Elle vient
    // de [chipContentColor] (le `bestContentOn` du thème) et c'est `Surface` qui
    // la propage au texte via `contentColor`, donc le texte ne peut plus être
    // forcé à `Color.White`.
    val ink = chipContentColor(background)
    Surface(
        color = background,
        contentColor = ink,
        shape = MaterialTheme.shapes.small,
        // Filet de sélection : 2 dp, donc l'état se voit même sans couleur (le
        // lecteur d'écran, lui, l'a par `selectable` + `stateDescription`).
        border = if (selected) BorderStroke(SELECTED_BORDER, ink) else null,
        modifier = Modifier.selectable(
            selected = selected,
            onClick = onClick,
            role = Role.Tab,
        ),
    ) {
        Text(
            text = "$label ${noteLabel(value)} ($count)",
            // L'encre vient de la Surface (`LocalContentColor`), pas d'un
            // `Color.White` codé en dur : c'est le Theme qui décide.
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .semantics {
                    stateDescription = if (selected) "Sélectionnée" else "Non sélectionnée"
                },
        )
    }
}

