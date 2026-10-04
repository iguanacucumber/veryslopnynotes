package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.data.SubjectPrefs

// RÉGLAGES #83, repris par #140 : quatre SECTIONS (Apparence / Matières /
// Sécurité / Compte), thème en segment, éditeur de matière en feuille modale
// (`SettingsSubjectEditor.kt`), clé LLM MASQUÉE. Aucun effet réseau hors serveur
// allowlist, I1 intact.
//
// #135 : ce composable était sorti d'`AppNav.kt` (989 lignes qui portaient la
// coquille ET quatre écrans). #140 corrige ce qui restait de #83 :
//   - un éditeur de matière TOUJOURS DÉPLOYÉ par matière, huit pastilles de
//     couleur chacune, dans une colonne SANS défilement : douze matières
//     composaient environ 144 pastilles et l'écran ne pouvait pas défiler. Une
//     matière = UNE LIGNE, son édition = une feuille ;
//   - la couleur et l'emoji ne changeaient RIEN de visible : depuis #137 / #138
//     / #139 ils colorent la carte de cours, la carte de devoir et la pastille
//     de note — la feuille d'édition affiche un APERÇU VIVANT de ces trois-là ;
//   - la clé du fournisseur LLM était saisie EN CLAIR (aucune transformation
//     visuelle) : elle se lisait par-dessus l'épaule et finissait dans la
//     hiérarchie de vues. Elle est désormais masquée, avec une bascule de
//     visibilité explicite ;
//   - « Ajouter la matière » était ACTIF sur un champ vide (l'appui ne faisait
//     rien) : le bouton est désactivé tant que le nom est vide, et un message
//     inline dit pourquoi quand le nom dépasse la borne du contrat ;
//   - le thème était une rangée de `FilterChip` : c'est un segment (Système /
//     Clair / Sombre), la forme d'un choix exclusif.
//
// Le retour n'est PLUS un bouton du corps : la barre du haut porte déjà la
// flèche (`TOP_BARS[ROUTE_SETTINGS]`), donc le second « Retour » était un doublon
// — même règle que #162 pour les liens de navigation.
//
// La clé n'est JAMAIS pré-remplie dans le champ : on affiche seulement si une
// clé existe (elle est chiffrée au repos dans `LlmKeyStore`), et la saisie ne
// sort jamais de l'app — pas de log, pas d'URL, pas de message d'erreur.

/** Écart entre deux sections. */
private val BLOCK_GAP = 20.dp

/** Écart entre deux lignes d'une même section. */
private val ROW_GAP = 4.dp

// @OptIn: `ModalBottomSheet` (feuille de la matière), `SingleChoiceSegmentedButtonRow`
// et `SegmentedButton` restent annotés Expérimental dans material3 1.2.1 (le gel
// du Compose BOM 2024.06.00).
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    // Signature = arguments édités, validation faite par isValid (contrat).
    onSavePrefs: (String, String?, String?, String?) -> Unit = { _, _, _, _ -> },
    onRefreshPrefs: () -> Unit = {},
    theme: AppTheme = AppTheme.SYSTEM,
    onTheme: (AppTheme) -> Unit = {},
    // 0.7.0 : clé du fournisseur LLM. Le serveur n'en détient aucune, donc
    // elle se saisit ICI, chiffrée (LlmKeyStore). Jamais pré-remplie dans le
    // champ : on affiche seulement si une clé existe ; la saisie est masquée,
    // avec une bascule pour la relire quand l'utilisateur le demande.
    llmKeyConfigured: Boolean = false,
    onSaveLlmKey: (String) -> Unit = {},
    onForgetLlmKey: () -> Unit = {},
    // #140 : l'état d'appairage de l'appareil — un réglage n'y écrit pas, il se
    // contente de dire ce qui est déjà fait (le profil, lui, agit).
    accountCount: Int = 1,
) {
    // Matière en cours d'édition, `null` = aucune feuille ouverte. L'écran ne
    // garde QUE le sujet : le brouillon vit dans la feuille, qui disparaît avec
    // elle (fermer sans valider = annuler, comme chez Papillon). #147 :
    // `rememberSaveable`, sinon une rotation ferme la feuille en cours.
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    val editingSubject = editing
    if (editingSubject != null) {
        SubjectEditorSheet(
            subject = editingSubject,
            prefs = subjectPrefs,
            saved = subjectPrefs.firstOrNull { it.subject.equals(editingSubject, ignoreCase = true) },
            onSave = { color, emoji, label -> onSavePrefs(editingSubject, color, emoji, label) },
            onDismiss = { editing = null },
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(BLOCK_GAP),
    ) {
        // --- Apparence : un segment, pas trois puces -----------------------
        SettingsSection("Apparence", Icons.Filled.Star) {
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                val modes = AppTheme.entries
                for (index in modes.indices) {
                    val mode = modes[index]
                    SegmentedButton(
                        selected = theme == mode,
                        onClick = { onTheme(mode) },
                        shape = SegmentedButtonDefaults.itemShape(index, modes.size),
                    ) {
                        Text(themeLabel(mode), maxLines = 1)
                    }
                }
            }
        }

        // --- Matières : une ligne par matière, la feuille fait le reste ----
        SettingsSection("Matières", Icons.AutoMirrored.Filled.List) {
            if (subjectPrefs.isEmpty()) {
                Text(
                    text = "Aucune matière personnalisée. Le nom d'origine est affiché partout, avec " +
                        "une couleur dérivée de son nom.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                for (p in subjectPrefs) {
                    val style = subjectStyle(subjectPrefs, p.subject)
                    val hex = subjectColorHex(subjectPrefs, p.subject)
                    PapListItem(
                        title = style.badge,
                        // Le libellé n'est un SOUS-TITRE que s'il diffère du nom
                        // affiché : sinon la ligne dirait « Maths / Maths ».
                        subtitle = p.label?.trim()?.takeIf { it.isNotEmpty() && it != p.subject },
                        leading = {
                            PapSubjectAvatar(
                                emoji = style.emoji ?: subjectInitial(p.subject),
                                color = colorFromHex(hex) ?: MaterialTheme.colorScheme.primary,
                            )
                        },
                        onClick = { editing = p.subject },
                    )
                }
            }
            // Matière inconnue = nom libre (validation isValid côté repository).
            // #147 : le nom tapé survit à la rotation (et le bouton « Ajouter »
            // reste activé, donc l'app ne demande pas de le ressaisir).
            var newSubject by rememberSaveable { mutableStateOf("") }
            val nameError = subjectNameError(newSubject)
            OutlinedTextField(
                value = newSubject,
                onValueChange = { newSubject = it },
                label = { Text("Matière à personnaliser") },
                singleLine = true,
                isError = nameError != null,
                supportingText = {
                    Text(nameError ?: "Le nom vient de l'établissement : vérifie son orthographe.")
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                // Champ vide ou trop long : le bouton ne s'appuie pas. AVANT il
                // était actif et l'appui n'écrivait rien (le dépôt rejette une
                // prefs sans sujet).
                onClick = {
                    val subject = newSubject.trim()
                    if (subject.isNotEmpty() && subjectNameError(subject) == null) {
                        onSavePrefs(subject, "", "", "")
                        newSubject = ""
                        // « Ajouter » ajoute : la feuille s'ouvre sur la matière
                        // créée, sinon l'app se retrouve avec une prefs vide que
                        // rien ne montre.
                        editing = subject
                    }
                },
                enabled = newSubject.isNotBlank() && nameError == null,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Ajouter la matière") }
            TextButton(onClick = { onRefreshPrefs() }, modifier = Modifier.fillMaxWidth()) {
                Text("Synchroniser les préférences")
            }
        }

        // --- Sécurité : la clé de l'assistant ------------------------------
        SettingsSection("Sécurité", Icons.Filled.Lock) {
            Text(text = "Assistant devoirs", style = MaterialTheme.typography.titleSmall)
            Text(
                text = if (llmKeyConfigured) {
                    "Clé enregistrée (chiffrée). Elle part avec chaque demande, jamais stockée par " +
                        "le serveur."
                } else {
                    "Aucune clé : l'assistant reste inactif tant qu'elle n'est pas saisie."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            // #147 : PAS de `rememberSaveable` ICI, et c'est délibéré : une clé
            // LLM est un CREDENTIAL. La sauvegarde d'état Compose peut finir
            // sur disque, dans le fichier de l'activité — on ne recopie donc pas
            // un secret dans un support que l'utilisateur ne surveille pas. Elle
            // est chiffrée dans `LlmKeyStore` (Android Keystore) ; ici elle vit
            // le temps de la saisie et disparaît avec elle.
            var llmKey by remember { mutableStateOf("") }
            // Masquée par DÉFAUT : une clé se COLLE, elle ne se tape pas. Le
            // collage reste autorisé (aucun filtre de caractères) — c'est le
            // TEXTE affiché qui est transformé, jamais la saisie.
            var keyVisible by remember { mutableStateOf(false) }
            OutlinedTextField(
                value = llmKey,
                onValueChange = { if (it.length <= Homework.MAX_API_KEY_CHARS) llmKey = it },
                label = { Text("Clé du fournisseur LLM") },
                singleLine = true,
                visualTransformation = if (keyVisible) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                trailingIcon = {
                    TextButton(onClick = { keyVisible = !keyVisible }) {
                        // Pas d'icône : `Visibility` est dans
                        // `material-icons-extended`, interdit ici. Le libellé
                        // écrit est de toute façon plus clair qu'un œil.
                        Text(if (keyVisible) "Masquer" else "Afficher")
                    }
                },
                supportingText = {
                    Text("Collée depuis le compte du fournisseur. Elle ne quitte jamais cet appareil.")
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        onSaveLlmKey(llmKey)
                        // Le champ se vide après l'écriture : la clé ne reste pas
                        // en clair dans l'arbre de vues plus longtemps qu'il le faut.
                        llmKey = ""
                        keyVisible = false
                    },
                    enabled = llmKey.isNotBlank(),
                ) { Text("Enregistrer la clé") }
                // "Oublier" EFFACE la valeur du store (elle n'est pas renvoyée
                // par le serveur, personne ne peut la reconstruire à sa place).
                TextButton(onClick = { onForgetLlmKey() }, enabled = llmKeyConfigured) { Text("Oublier") }
            }
        }

        // --- Compte : ce qui est déjà appairé sur cet appareil --------------
        SettingsSection("Compte", Icons.Filled.AccountCircle) {
            PapListItem(
                title = "Comptes appairés",
                subtitle = if (accountCount > 1) {
                    "$accountCount comptes · la session en cours garde ses accès"
                } else {
                    "1 compte · l'appairage se fait depuis le Profil"
                },
            )
            Text(
                text = "L'appairage, la déconnexion et le changement de compte sont dans l'onglet " +
                    "Profil. Les préférences de matière sont répliquées vers le serveur de " +
                    "l'établissement ; la clé de l'assistant ne sort jamais de l'appareil.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Un bloc de réglages : en-tête de section (`PapSectionHeader` = icône + titre
 * en encre secondaire) puis son contenu.
 *
 * PAS de carte autour : un réglage = une ligne ou un champ, et un aplat de carte
 * par réglage ferait un damier sur un écran de réglages.
 */
@Composable
private fun SettingsSection(
    title: String,
    icon: ImageVector,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(ROW_GAP)) {
        PapSectionHeader(icon = icon, title = title)
        Column(modifier = Modifier.fillMaxWidth(), content = content)
    }
}