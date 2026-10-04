package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

// Fiches révision #30 : liste + export PDF via URL serveur allowlist.
// Contenu serveur affiché comme donnée, jamais interprété.
// ponytail: état local seul (pas de ViewModel avant données #14).
data class RevisionSheetUi(
    val id: String,
    val title: String,
    val subject: String,
    val date: String,
    val sources: List<String>,
)

@Composable
fun RevisionSheetsScreen(
    sheets: List<RevisionSheetUi> = emptyList(),
    onExportPdf: (String) -> Unit = {},
    onOpen: (String) -> Unit = {},
) {
    var state by remember { mutableStateOf("idle") }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (state) {
            "idle" -> Text(if (sheets.isEmpty()) "Aucune fiche. Générée auto à l'annonce d'un DS." else "${sheets.size} fiche(s) prête(s).")
            "loading" -> Text("Chargement…")
            "error" -> Text("Erreur réseau. Réessayer.")
        }
        for (s in sheets) {
            Text("${s.title} — ${s.subject} ${s.date.take(10)}")
            Text("Sources : ${s.sources.joinToString(", ")}")
            Button(onClick = { onExportPdf(s.id) }) { Text("Exporter PDF ${s.id}") }
            Button(onClick = { onOpen(s.id) }) { Text("Ouvrir ${s.id}") }
        }
        Button(onClick = { state = "loading" }) { Text("Charger") }
        Button(onClick = { state = "error" }) { Text("Simuler erreur") }
    }
}
