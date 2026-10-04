package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.data.HomeworkRepository

// Aide devoirs (contrat 0.7.0) : le PREMIER et SEUL écran qui consomme
// /v1/homework/generate. Le serveur ne détient aucune clé LLM, donc cette clé
// est saisie par l'utilisateur dans les Réglages (LlmKeyStore) et relue à
// chaque appel — jamais-affichée ici, jamais journalisée.
//
// Sources = le devoir lui-même (consigne + extrait de cours). Zéro source = refus
// SANS appel modèle côté serveur : l'écran affiche donc les étiquettes avant de
// laisser envoyer, pour ne pas faire payer un aller-retour inutile.
//
// La réponse est de la DONNÉE : Text() uniquement, jamais WebView ni HTML, les
// étapes du modèle ne sont jamais exécutées (I6).

// #172 : `HomeworkHelpButton` (le `Button` pleine largeur d'avant #161) est
// retiré : plus rien ne l'appelle, la PUCE de `Assignments.kt` le déclenche.
// Un composant public qu'aucun écran ne compose est du code qu'on lit, compile
// et teste sans jamais le voir sur l'écran.

@Composable
fun HomeworkHelpDialog(
    assignment: Assignment,
    baseUrl: String,
    repo: HomeworkRepository,
    keyConfigured: Boolean,
    onDismiss: () -> Unit,
) {
    val sources = remember(assignment.id) { HomeworkRepository.sourcesFor(assignment) }
    var question by remember(assignment.id) { mutableStateOf(HomeworkRepository.questionFor(assignment)) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var outcome by remember { mutableStateOf<HomeworkOutcome?>(null) }

    fun generate() {
        error = null
        outcome = null
        pending = true
        repo.generate(baseUrl, question, sources) { r ->
            pending = false
            if (r.outcome != null) outcome = r.outcome else error = r.error
        }
    }

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text("Aide : ${assignment.subject}") },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // `title` est dérivé des 200 premiers caractères de la consigne
                // (cf. #161) : trois lignes suffisent à dire de quoi il s'agit, le
                // dialogue défile pour le reste.
                Text(
                    text = assignment.title,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!keyConfigured) {
                    Text("Clé LLM absente : renseigne-la dans Réglages pour activer l'assistant.")
                }
                Text(
                    text = "Sources envoyées : " + Homework.uniqueLabels(sources).joinToString(", ")
                        .ifEmpty { "aucune" },
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                if (sources.isEmpty()) Text(Homework.SOURCES_REQUIRED_MESSAGE)
                OutlinedTextField(
                    value = question,
                    onValueChange = { question = it },
                    label = { Text("Question") },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (pending) Text("Génération…")
                error?.let { Text(it) }
                val o = outcome
                if (o is HomeworkOutcome.Answer) {
                    Text(o.answer)
                    if (o.steps.isNotEmpty()) {
                        // Titre de bloc dans un dialogue : `heading()` pour que le
                        // survol parte d'ici.
                        Text(
                            text = "Étapes",
                            modifier = Modifier.semantics { heading() },
                        )
                        o.steps.forEachIndexed { i, s ->
                            Text(
                                text = "${i + 1}. $s",
                                maxLines = 4,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    Text(
                        text = "Sources : " + o.sources.joinToString(", "),
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                } else if (o is HomeworkOutcome.Refused) {
                    Text(
                        if (o.reason == Homework.REFUSAL_SOURCES_INSUFFICIENT) {
                            "Le devoir n'a pas assez de matière : le serveur refuse de répondre sans source."
                        } else {
                            "Assistant : " + o.reason
                        },
                    )
                    if (o.sources.isNotEmpty()) {
                        Text(
                            text = "Sources citées : " + o.sources.joinToString(", "),
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { generate() }, enabled = !pending) { Text("Générer") }
                TextButton(onClick = onDismiss, enabled = !pending) { Text("Fermer") }
            }
        },
    )
}