package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.SubjectPrefs

// Réglages #83 : préférences matière (couleur/emoji/libellé, offline-first via
// SubjectPrefsRepository) + thème clair/sombre persisté (Theme.kt). Aucun effet
// réseau hors serveur allowlist, I1 intact.
// @OptIn: FilterChip.material3 tant qu'il reste annoté Expérimental.
//
// #135 : ce composable SORT d'`AppNav.kt` (970 lignes qui portaient la coquille
// ET quatre écrans). Comportement inchangé, SAUF :
//   - `Text("Réglages")` retiré : la barre du haut affiche le titre de la route
//     (papillon.bzh), le nom de l'écran ne doit plus être lu deux fois ;
//   - les titres de section (« Matières », « Assistant devoirs ») passent à
//     `MaterialTheme.typography.titleMedium`, premier adopter de l'échelle
//     livrée par #134.
// REDESIGN : #140 (réglages : sections, couleur matière avec aperçu, clé LLM
// masquée).
// ponytail: pas de défilement — l'écran tient dans la fenêtre sur les captures
// de #135, mais le jour où #140 ajoute des sections il faudra `verticalScroll`
// (comme `ProfileRoute`, où « Se déconnecter » était hors d'atteinte).
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    // Signature = arguments édités, validation faite par isValid (contrat).
    onSavePrefs: (String, String?, String?, String?) -> Unit = { _, _, _, _ -> },
    onRefreshPrefs: () -> Unit = {},
    theme: AppTheme = AppTheme.SYSTEM,
    onTheme: (AppTheme) -> Unit = {},
    // 0.7.0 : clé du fournisseur LLM. Le serveur n'en détient aucune, donc
    // elle se saisit ICI, chiffrée (LlmKeyStore). Jamais pré-remplie dans le
    // champ : on affiche seulement si une clé existe, la saisie est en clair
    // dans le champ de l'app (l'utilisateur veut la relire/corriger).
    llmKeyConfigured: Boolean = false,
    onSaveLlmKey: (String) -> Unit = {},
    onForgetLlmKey: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Thème : ${themeLabel(theme)}")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (mode in AppTheme.entries) {
                FilterChip(
                    selected = theme == mode,
                    onClick = { onTheme(mode) },
                    label = { Text(themeLabel(mode)) },
                )
            }
        }
        Text("Matières", style = MaterialTheme.typography.titleMedium)
        if (subjectPrefs.isEmpty()) {
            Text("Aucune matière personnalisée. Le nom d'origine est affiché partout.")
        } else {
            for (p in subjectPrefs) {
                SubjectPrefsEditor(
                    subject = p.subject,
                    color = p.color,
                    emoji = p.emoji,
                    label = p.label,
                    onSave = onSavePrefs,
                )
            }
        }
        // Matière inconnue = nom libre (validation isValid côté repository).
        var newSubject by remember { mutableStateOf("") }
        OutlinedTextField(
            value = newSubject,
            onValueChange = { newSubject = it },
            label = { Text("Matière à personnaliser") },
            singleLine = true,
        )
        Button(onClick = { onSavePrefs(newSubject, "", "", ""); newSubject = "" }) { Text("Ajouter la matière") }
        Button(onClick = { onRefreshPrefs() }) { Text("Synchroniser les préférences") }
        // Clé LLM : credential de l'utilisateur, pas une session d'appareil.
        // "Oublier" EFFACE la valeur du store (elle n'est pas renvoyée par le
        // serveur, personne ne peut la reconstruire à sa place).
        Text("Assistant devoirs", style = MaterialTheme.typography.titleMedium)
        Text(
            if (llmKeyConfigured) {
                "Clé enregistrée (chiffrée). Elle part avec chaque demande, jamais stockée par le serveur."
            } else {
                "Aucune clé : l'assistant reste inactif tant qu'elle n'est pas saisie."
            },
        )
        var llmKey by remember { mutableStateOf("") }
        OutlinedTextField(
            value = llmKey,
            onValueChange = { llmKey = it },
            label = { Text("Clé du fournisseur LLM") },
            singleLine = true,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onSaveLlmKey(llmKey); llmKey = "" },
                enabled = llmKey.isNotBlank(),
            ) { Text("Enregistrer la clé") }
            TextButton(onClick = { onForgetLlmKey() }, enabled = llmKeyConfigured) { Text("Oublier") }
        }
        Button(onClick = onBack) { Text("Retour") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SubjectPrefsEditor(
    subject: String,
    color: String?,
    emoji: String?,
    label: String?,
    onSave: (String, String?, String?, String?) -> Unit,
) {
    var draftColor by remember(subject) { mutableStateOf(color ?: "") }
    var draftEmoji by remember(subject) { mutableStateOf(emoji ?: "") }
    var draftLabel by remember(subject) { mutableStateOf(label ?: "") }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(subject)
        OutlinedTextField(
            value = draftLabel,
            onValueChange = { draftLabel = it },
            label = { Text("Libellé") },
            singleLine = true,
        )
        OutlinedTextField(
            value = draftEmoji,
            onValueChange = { draftEmoji = it },
            label = { Text("Emoji") },
            singleLine = true,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (hex in PREFS_PALETTE) {
                FilterChip(
                    selected = draftColor.equals(hex, ignoreCase = true),
                    onClick = { draftColor = if (draftColor.equals(hex, ignoreCase = true)) "" else hex },
                    label = { Text("■", color = colorFromHex(hex) ?: MaterialTheme.colorScheme.onSurface) },
                )
            }
        }
        Button(onClick = { onSave(subject, draftColor, draftEmoji, draftLabel) }) { Text("Enregistrer $subject") }
    }
}

// ponytail: palette de 8 couleurs en dur (aucun Color Picker tant que le
// besoin n'est pas prouvé), champs texte = Material3 de base.
private val PREFS_PALETTE = listOf(
    "#E53935", "#D81B60", "#8E24AA", "#5E35B1",
    "#3949AB", "#1E88E5", "#43A047", "#FB8C00",
)