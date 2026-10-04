package fr.veryslopnynotes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.core.UserProfileRules

// SÉLECTEUR DE COMPTE #140 (parité Papillon : en-tête avatar + nom + chevron,
// puis la liste des comptes appairés).
//
// AVANT, l'app gérait N comptes (`AccountStore.count()`) et N enfants
// (`UserProfile.kids`) sans jamais les AFFICHER au-delà d'un compteur : il
// n'existait aucun moyen de changer de compte. Les enfants étaient déjà
// analysés (`ProfileRepository.parse`), donc la donnée existait.
//
// La session appairée reste MONO-COMPTE côté serveur (bearer d'appareil,
// contrat 0.4.0) : basculer change le compte ACTIF de l'app, celui qu'elle
// mémorise (`AccountStore.select`) et qu'elle propose au proxy média. L'écran ne
// prétend donc pas recharger les notes d'un autre enfant : il affiche le compte
// actif, et c'est tout — le `ponytail:` est écrit là, dans le `why`, pas
// enfoui dans le composant. Upgrade: quand le serveur publiera des données par
// compte, c'est le `refresh()` du routeur qu'il faudra armer d'ici.
//
// La liste et le compte courant sont des fonctions PURES (`switchableAccounts`,
// `activeAccount`) : leur miroir est `tests/unit/android-profile.test.ts`.

/** Côte de la pastille d'un compte dans la feuille de sélection. */
private val ACCOUNT_BADGE = 40.dp

/** Un compte que l'app peut activer : le compte de session, puis ses enfants. */
data class SwitchableAccount(
    val accountId: String,
    val displayName: String,
    val classLabel: String = "",
)

/**
 * Comptes activables : le compte de session d'abord (c'est lui que l'en-tête
 * affiche), puis les enfants, sans doublon d'`accountId` et sans entrée sans
 * nom — un compte qu'on ne peut pas nommer ne se choisit pas à l'écran.
 *
 * `profile == null` (aucune information publiée) = liste vide : pas de compte
 * inventé pour que le sélecteur ait quelque chose à montrer.
 *
 * Plafond `MAX_KIDS + 1` : la liste vient du contrat, donc elle est déjà
 * bornée ; le plafond redit la borne ici plutôt que de faire confiance à
 * l'appelant.
 */
fun switchableAccounts(profile: UserProfile?): List<SwitchableAccount> {
    if (profile == null) return emptyList()
    val out = LinkedHashMap<String, SwitchableAccount>()
    if (UserProfileRules.isValidAccountId(profile.accountId) && profile.displayName.trim().isNotEmpty()) {
        out[profile.accountId] = SwitchableAccount(
            accountId = profile.accountId,
            displayName = profile.displayName.trim(),
            classLabel = profile.classLabel.trim(),
        )
    }
    for (kid in profile.kids) {
        if (out.size > UserProfileRules.MAX_KIDS) break
        val id = kid.accountId.trim()
        val name = kid.displayName.trim()
        if (!UserProfileRules.isValidAccountId(id) || name.isEmpty() || out.containsKey(id)) continue
        out[id] = SwitchableAccount(id, name, kid.classLabel.trim())
    }
    return out.values.toList()
}

/**
 * Compte actif : celui que l'app mémorise (`AccountStore.current()`), sinon le
 * premier de la liste — le compte de session.
 *
 * TOTAL : une liste vide n'a pas de compte actif, et un `currentId` inconnu ou
 * vide retombe sur la session plutôt que de laisser l'écran sans compte affiché
 * (le sélecteur est alors coché sur une ligne existante, jamais rien).
 */
fun activeAccount(accounts: List<SwitchableAccount>, currentId: String?): SwitchableAccount? {
    if (accounts.isEmpty()) return null
    val id = currentId?.trim().orEmpty()
    return accounts.firstOrNull { it.accountId == id } ?: accounts.first()
}

/**
 * Feuille des comptes appairés : une ligne par compte, la coche sur l'actif.
 *
 * Pas d'écran « gestion des comptes » : c'est une liste de CHOIX, donc une
 * feuille — et elle se ferme sur la coche (comme chez Papillon) sans
 * confirmation : changer de compte n'efface rien.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileAccountSheet(
    accounts: List<SwitchableAccount>,
    currentId: String?,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "Changer de compte",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(vertical = 8.dp),
            )
            val activeId = activeAccount(accounts, currentId)?.accountId
            for (account in accounts) {
                ProfileAccountRow(
                    account = account,
                    selected = account.accountId == activeId,
                    onClick = { onSelect(account.accountId) },
                )
            }
            Text(
                text = "Changer de compte ne déconnecte pas la session appairée : elle conserve ses " +
                    "accès sur le serveur de l'établissement.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

/** Une ligne du sélecteur : pastille d'initiales, nom, classe, coche si actif. */
@Composable
private fun ProfileAccountRow(
    account: SwitchableAccount,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(ACCOUNT_BADGE)
                .clip(MaterialTheme.shapes.large)
                .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            // Initiales du COMPTE affiché, pas celles du compte de session : la
            // liste contient des enfants, dont l'app n'a pas la photo.
            Text(
                text = accountInitials(account.displayName),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = account.displayName,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (account.classLabel.isNotEmpty()) {
                Text(
                    text = account.classLabel,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = "Compte actif",
                tint = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

/**
 * Initiales d'un NOM : même règle que `profileInitials` (core), mais sur la
 * chaîne — on ne construit pas de `UserProfile` factice pour une ligne de
 * liste, et `UserProfile` exige un `accountId` valide que l'écran n'a pas ici.
 */
private fun accountInitials(displayName: String): String {
    val words = displayName.trim().split(" ", "-", "_").filter { it.isNotEmpty() }
    val letters = words.take(2).map { it.first().uppercaseChar() }
    return if (letters.isEmpty()) "?" else letters.joinToString("")
}