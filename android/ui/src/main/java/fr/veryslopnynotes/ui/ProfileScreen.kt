package fr.veryslopnynotes.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.core.profileInitials
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.MeResult
import fr.veryslopnynotes.data.PhotoState
import fr.veryslopnynotes.data.ProfileRepository

// PROFIL #82 (parité Papillon), repris par #140 : en-tête, sections, sélecteur
// de compte. Nom, classe, période courante, photo via le PROXY serveur (réF
// opaque, jamais une adresse Pronote — I1), enfants d'un compte parent,
// déconnexion (session invalidée + cache purgé). Aucune donnée personnelle
// persistée : hors-ligne = mode anonyme, état vide propre.
//
// #135 : ce fichier (les deux composables) SORT d'`AppNav.kt` (989 lignes qui
// portaient la coquille ET quatre écrans). #140 reprend ce qu'il avait laissé :
//   - la photo était rendue à sa TAILLE INTRINSÈQUE (`Image(bitmap = …,
//     padding(4.dp))`) : une photo 1024 × 1024 mangeait l'écran et n'était
//     jamais rognée en cercle. Elle est bornée à [PROFILE_AVATAR] dp, en cercle,
//     en `ContentScale.Crop` — donc la même image à toute résolution ;
//   - quatorze boutons pleine largeur empilés, sans hiérarchie : ils sont
//     devenus des SECTIONS ([ProfileSection]) et des LIGNES (`PapListItem`), ce
//     qui rend « Se déconnecter » visible sans défiler ;
//   - « Se déconnecter » détruit la session : il passe par [ConfirmDialog]
//     (`PapComponents`), comme la suppression d'une discussion ;
//   - les enfants d'un compte parent (`hasKids`/`kids`, déjà analysés) ne
//     s'affichaient qu'en texte : ils passent par le sélecteur de compte
//     (`ProfileAccountSwitcher.kt`).
// #140 : la lecture part à l'arrivée sur l'écran et se relance depuis la barre
// du haut (compteur `refreshTick`), donc le corps n'affiche plus un bouton
// « Charger le profil ».
//
// ponytail: état local (comme les autres onglets), pas de ViewModel.

/** Côte de l'avatar de l'en-tête. FIXE : la photo est bornée, quoi qu'elle
 *  pèse comme bitmap (défaut #140). 72 dp = un en-tête de profil, pas une
 *  pastille de liste (44 dp, cf. `PapSubjectAvatar`). */
private val PROFILE_AVATAR: Dp = 72.dp

/** Écart entre deux blocs de l'écran. */
private val BLOCK_GAP = 16.dp

/** Écart entre l'en-tête d'une section et sa première ligne. */
private val ROW_GAP = 2.dp

@Composable
fun ProfileScreen(
    baseUrl: String,
    profile: UserProfile?,
    photo: PhotoState,
    accountCount: Int,
    currentAccountId: String?,
    goSettings: () -> Unit,
    goPairing: () -> Unit,
    goAlerts: () -> Unit,
    goFiches: () -> Unit,
    goNews: () -> Unit = {},
    goCanteen: () -> Unit = {},
    // #77 : vie scolaire (absences/retards + sanctions).
    goAttendance: () -> Unit = {},
    // #87 : capacites connues (null = rien n'est masque) + lecture des onglets.
    capabilities: Capabilities? = null,
    onRefreshCapabilities: () -> Unit = {},

    // #80 : messagerie (discussions).
    goMessages: () -> Unit = {},
    onSwitchAccount: (String) -> Unit = {},
    onLogout: () -> Unit = {},
) {
    val accounts = remember(profile) { switchableAccounts(profile) }
    val active = remember(accounts, currentAccountId) { activeAccount(accounts, currentAccountId) }
    // #147 : le sélecteur de compte et sa confirmation sont de l'état d'écran.
    // `logoutAsk` surtout : c'est le dialogue qui protège la session de l'appairé
    // — le perdre en cours de route laissait croire que la déconnexion était
    // acquise.
    var sheetOpen by rememberSaveable { mutableStateOf(false) }
    var logoutAsk by rememberSaveable { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(BLOCK_GAP),
    ) {
        if (baseUrl.isBlank()) {
            PapEmptyState(
                icon = Icons.Filled.Info,
                title = "Serveur non configuré",
                description = "Appaire l'appareil pour afficher ton profil.",
            )
        } else if (profile == null) {
            // Compte appairé sans infos publiées : état vide, pas de nom d'exemple.
            PapEmptyState(
                icon = Icons.Filled.Info,
                title = "Aucune information",
                description = "Aucune information publiée pour ce compte.",
            )
        } else {
            ProfileHeader(
                name = profile.displayName,
                // Période courante publiée par /v1/me ; la liste des périodes de
                // l'année reste sur /v1/periods (contrat #74).
                details = listOf(profile.classLabel, profile.periodName)
                    .filter { it.isNotEmpty() }
                    .joinToString(" · "),
                photo = photo,
                initials = profileInitials(profile),
                // Le chevron n'apparaît que s'il peut BASCULER : un chevron
                // décoratif sur un compte unique serait un mensonge d'interface.
                switchable = accounts.size > 1,
                activeLabel = active?.displayName.orEmpty(),
                onSwitch = { sheetOpen = true },
            )
        }

        // --- Compte : appairage + bascule entre comptes appairés -------------
        ProfileSection("Compte", Icons.Filled.AccountCircle) {
            PapListItem(
                title = "Appairage QR+PIN",
                subtitle = "Connecte ou reconnecte l'appareil à l'établissement",
                onClick = goPairing,
            )
            // Un seul compte = rien à choisir, donc pas de ligne « changer ».
            if (accounts.size > 1) {
                PapListItem(
                    title = "Compte actif",
                    subtitle = active?.displayName.orEmpty(),
                    trailing = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null) },
                    onClick = { sheetOpen = true },
                )
            }
            Text(
                text = if (accountCount > 1) "$accountCount comptes appairés" else "$accountCount compte appairé",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 2.dp),
            )
        }

        // --- Ressources de l'établissement (capacités #87) ------------------
        ProfileSection("Ressources", Icons.AutoMirrored.Filled.List) {
            PapListItem(title = "Fiches révision", onClick = { goFiches() })
            PapListItem(title = "Messages", onClick = { goMessages() })
            // #87 : une entrée dont l'onglet n'est pas actif chez l'etablissement
            // n'est pas proposee ; son ecran reste atteignable en cas de besoin et
            // affiche son etat vide propre.
            if (Capabilities.visible(capabilities, Capabilities.NEWS)) {
                PapListItem(title = "Actualités", onClick = { goNews() })
            }
            if (Capabilities.visible(capabilities, Capabilities.MENUS)) {
                PapListItem(title = "Cantine semaine", onClick = { goCanteen() })
            }
            if (Capabilities.visible(capabilities, Capabilities.ATTENDANCE)) {
                PapListItem(title = "Vie scolaire", onClick = { goAttendance() })
            }
            PapListItem(
                title = "Alertes sécurité",
                subtitle = "Ce que l'app neutralise sur les pièces jointes",
                onClick = goAlerts,
            )
            PapListItem(
                title = "Détecter les onglets",
                subtitle = "Relit ce que l'établissement publie",
                onClick = { onRefreshCapabilities() },
            )
        }

        ProfileSection("Réglages", Icons.Filled.Settings) {
            PapListItem(
                title = "Réglages",
                subtitle = "Thème, matières, clé de l'assistant",
                onClick = goSettings,
            )
        }

        // --- Session : la seule action DESTRUCTRICE de l'écran --------------
        ProfileSection("Session", Icons.AutoMirrored.Filled.ExitToApp) {
            PapListItem(
                title = "Se déconnecter",
                subtitle = "Session invalidée, caches purgés",
                onClick = { logoutAsk = true },
            )
        }
    }

    if (sheetOpen && accounts.size > 1) {
        ProfileAccountSheet(
            accounts = accounts,
            currentId = currentAccountId,
            onSelect = { id ->
                sheetOpen = false
                onSwitchAccount(id)
            },
            onDismiss = { sheetOpen = false },
        )
    }
    if (logoutAsk) {
        ConfirmDialog(
            title = "Se déconnecter",
            text = "La session appairée est invalidée et les données en cache de cet appareil sont " +
                "purgées. Il faudra appairer à nouveau pour revenir.",
            confirmLabel = "Se déconnecter",
            destructive = true,
            onConfirm = {
                logoutAsk = false
                onLogout()
            },
            onDismiss = { logoutAsk = false },
        )
    }
}

/** En-tête du profil : avatar circulaire borné, nom, classe + période. */
@Composable
private fun ProfileHeader(
    name: String,
    details: String,
    photo: PhotoState,
    initials: String,
    switchable: Boolean,
    activeLabel: String,
    onSwitch: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        ProfileAvatar(photo = photo, initials = initials)
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = name,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (details.isNotEmpty()) {
                Text(
                    text = details,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (switchable && activeLabel.isNotEmpty()) {
            // Le chevron AFFIRME « cet en-tête est un sélecteur » : sans lui,
            // l'en-tête n'aurait aucune raison d'être cliquable.
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = "Changer de compte",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clickable(onClick = onSwitch),
            )
        }
    }
}

/**
 * Avatar : la photo en CERCLE borné, sinon les initiales sur le conteneur vert.
 *
 * Le `Image` est borné par [PROFILE_AVATAR] et `clip(CircleShape)` : le bitmap
 * garde sa résolution (c'est le BONUS) mais plus aucune de ses dimensions ne
 * touche la mise en page. RéF absente, média KO ou serveur non configuré =
 * initiales, jamais une image cassée.
 */
@Composable
private fun ProfileAvatar(photo: PhotoState, initials: String) {
    when (photo) {
        is PhotoState.Loaded -> Image(
            bitmap = photo.bitmap.asImageBitmap(),
            contentDescription = "Photo du profil",
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(PROFILE_AVATAR).clip(CircleShape),
        )
        else -> Box(
            modifier = Modifier
                .size(PROFILE_AVATAR)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = initials,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

/**
 * Un bloc titré : en-tête de section (`PapSectionHeader` = icône + titre en encre
 * secondaire) puis ses lignes.
 *
 * PAS de carte autour : une action = une ligne, donc un aplat de carte par
 * action ferait dix rectangles sur un écran de dix actions. Le rayon du thème
 * (`shapes.large`) suffit à regrouper les lignes d'un même bloc.
 */
@Composable
private fun ProfileSection(
    title: String,
    icon: ImageVector,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(ROW_GAP)) {
        PapSectionHeader(icon = icon, title = title)
        Column(modifier = Modifier.fillMaxWidth(), content = content)
    }
}

// Écran Profil câblé : lecture /v1/me (mémoire seule) + photo via proxy.
// Déconnexion = session appairée invalidée, caches purgés, profil abandonné.
@Composable
fun ProfileRoute(
    baseUrl: String,
    repo: ProfileRepository,
    accounts: AccountStore,
    onLogout: () -> Unit,
    goSettings: () -> Unit,
    goPairing: () -> Unit,
    goAlerts: () -> Unit,
    goFiches: () -> Unit,
    goNews: () -> Unit = {},
    goCanteen: () -> Unit = {},
    // #77 : vie scolaire (absences/retards + sanctions).
    goAttendance: () -> Unit = {},
    // #87 : capacites dynamiques + lecture des onglets actifs.
    capabilities: Capabilities? = null,
    onRefreshCapabilities: () -> Unit = {},

    // #80 : messagerie (discussions).
    goMessages: () -> Unit = {},
    // #140 : relecture depuis la barre du haut (compteur partagé avec l'onglet
    // Notes). À 0 = premier affichage, donc la lecture part aussi à l'arrivée.
    refreshTick: Int = 0,
) {
    var profile by remember(baseUrl) { mutableStateOf<UserProfile?>(null) }
    var loaded by remember(baseUrl) { mutableStateOf(false) }
    // #147 : le message du serveur reste affiché jusqu'à la réponse de la
    // relecture — sinon la rotation effaçait la seule trace de l'échec.
    var error by rememberSaveable(baseUrl) { mutableStateOf("") }
    var photo by remember(baseUrl) { mutableStateOf<PhotoState>(PhotoState.Absent) }
    var accountCount by remember(baseUrl) { mutableStateOf(accounts.count()) }
    // #140 : le compte ACTIF que l'app mémorise — `AccountStore` en est la
    // source, donc l'écran n'en garde qu'une copie d'affichage.
    var currentAccountId by rememberSaveable(baseUrl) { mutableStateOf(accounts.current()) }
    fun refresh() {
        // Serveur non configuré : aucun appel (I1).
        if (baseUrl.isBlank()) {
            loaded = true
            return
        }
        try {
            repo.fetchMe { r ->
                loaded = true
                error = ""
                accountCount = accounts.count()
                currentAccountId = accounts.current()
                when (r) {
                    is MeResult.Err -> error = r.message
                    is MeResult.Ok -> {
                        profile = r.profile
                        val p = r.profile
                        if (p == null) {
                            photo = PhotoState.Absent
                        } else {
                            repo.fetchPhoto(p) { bitmap ->
                                photo = if (bitmap == null) PhotoState.Absent else PhotoState.Loaded(bitmap)
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {
            loaded = true
            error = "Profil indisponible."
        }
    }
    // #140 : la lecture part à l'arrivée puis à chaque relecture de la barre —
    // plus de bouton « Charger le profil » dans le corps, qui était le seul
    // moyen d'obtenir la seule donnée de cet écran.
    LaunchedEffect(baseUrl, refreshTick) {
        if (baseUrl.isNotBlank()) refresh()
    }
    // #135 : UNE racine, et DÉFILABLE. Avant, ce composable émettait un `Button`
    // puis `ProfileScreen` (dont la racine est un `Column` en `fillMaxSize`)
    // : deux racines dans UN seul slot du NavHost, donc la seconde débordait
    // d'environ 48 dp et « Se déconnecter » — l'action la plus grave de
    // l'écran — sortait de l'écran, sans aucun défilement pour y revenir. Le
    // défilement est ici, au plus haut : c'est lui qui rend « Se déconnecter »
    // atteignable.
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        // L'état de la lecture se pose AU-DESSUS du corps, jamais À SA PLACE :
        // les sections (appairage, ressources, déconnexion) ne dépendent pas du
        // profil, donc un /v1/me raté ne doit pas laisser « Se déconnecter »
        // hors d'atteinte — c'est la règle hors-ligne #14 appliquée à un écran
        // sans cache.
        if (!loaded && baseUrl.isNotBlank()) {
            // Première lecture : un indicateur, pas un écran vide qui laisserait
            // croire à un compte sans profil.
            PapLoadingBlock()
        } else if (error.isNotEmpty() && profile == null) {
            // Échec de la lecture ET rien d'affiché : le VRAI message du
            // serveur, plus « Réessayer » (`PapErrorState`).
            PapErrorState(message = error, onRetry = { refresh() })
        } else if (error.isNotEmpty()) {
            // Relecture ratée alors qu'un profil est DÉJÀ affiché : rien n'est
            // remplacé (le profil vit en mémoire, mode anonyme), le message le
            // dit.
            Text(
                text = error,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
            )
        }
        ProfileScreen(
            baseUrl = baseUrl,
            profile = profile,
            photo = photo,
            accountCount = accountCount,
            currentAccountId = currentAccountId,
            goSettings = goSettings,
            goPairing = goPairing,
            goAlerts = goAlerts,
            goFiches = goFiches,
            goNews = goNews,
            goCanteen = goCanteen,
            goAttendance = goAttendance,
            capabilities = capabilities,
            onRefreshCapabilities = onRefreshCapabilities,

            goMessages = goMessages,
            onSwitchAccount = { id ->
                accounts.select(id)
                currentAccountId = accounts.current()
            },
            onLogout = {
                onLogout()
                profile = null
                photo = PhotoState.Absent
                // `loaded = true` : le profil revient à son état vide PROPRE
                // (comme au premier lancement), pas à un indicateur qui ne
                // finirait jamais — aucune lecture ne part tant que
                // l'appareil n'est pas appairé à nouveau.
                loaded = true
                error = ""
                accountCount = accounts.count()
                currentAccountId = accounts.current()
            },
        )
    }
}
