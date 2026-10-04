package fr.veryslopnynotes.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.core.profileInitials
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.MeResult
import fr.veryslopnynotes.data.PhotoState
import fr.veryslopnynotes.data.ProfileRepository

// Profil #82 (parité Papillon) : écran alimenté par /v1/me. Nom, classe,
// période courante, photo via le PROXY serveur (réF opaque, jamais une adresse
// Pronote — I1), enfants d'un compte parent, déconnexion (session invalidée
// + cache purgé). Aucune donnée personnelle persistée : hors-ligne = mode
// anonyme, état vide propre. Zéro faux user, zéro asset copié.
// ponytail: état local (comme les autres onglets), pas de ViewModel. Upgrade:
//   sélecteur de compte quand plusieurs enfants sont appairés.
//
// #135 : ce fichier (les deux composables) SORT d'`AppNav.kt` (989 lignes qui
// portaient la coquille ET quatre écrans). Comportement inchangé, SAUF :
//   - les 9 BOUTONS DUPLIQUÉS retirés (« Actualités », « Cantine semaine »,
//     « Vie scolaire » apparaissaient chacun TROIS fois : trois recopies du
//     même bloc, #87 avait ajouté les entrées conditionnelles par-dessus les
//     trois lignes d'origine qui sont restées) ;
//   - `Text("Profil")` retiré (la barre du haut porte le titre de la route) ;
//   - `ProfileRoute` n'émet plus DEUX racines dans un seul slot du NavHost.
// REDESIGN : #140 (profil et réglages : sections, sélecteur de compte…).

@Composable
fun ProfileScreen(
    baseUrl: String,
    profile: UserProfile?,
    photo: PhotoState,
    accountCount: Int,
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
    onLogout: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (baseUrl.isBlank()) {
            Text("Serveur non configuré.")
        } else if (profile == null) {
            // Compte appairé sans infos publiées : état vide, pas de nom d'exemple.
            Text("Aucune information publiée pour ce compte.")
        } else {
            when (photo) {
                is PhotoState.Loaded ->
                    Image(
                        bitmap = photo.bitmap.asImageBitmap(),
                        contentDescription = "Photo du profil",
                        modifier = Modifier.padding(4.dp),
                    )
                // Réf absente, média KO ou non configuré = initiales de repli.
                else -> Text(profileInitials(profile))
            }
            Text(profile.displayName)
            if (profile.classLabel.isNotEmpty()) Text("Classe : ${profile.classLabel}")
            // Période courante publiée par /v1/me ; la liste des périodes de l'année
            // reste sur /v1/periods (contrat #74).
            if (profile.periodName.isNotEmpty()) Text("Période : ${profile.periodName}")
            if (profile.hasKids) {
                Text("Comptes enfants", style = MaterialTheme.typography.titleMedium)
                for (k in profile.kids) {
                    val klass = if (k.classLabel.isEmpty()) "" else " (${k.classLabel})"
                    Text("${k.displayName}$klass")
                }
            }
        }
        Text(if (accountCount > 1) "Comptes appairés : $accountCount" else "1 compte appairé")
        Button(onClick = goPairing) { Text("Appairage QR+PIN") }
        Button(onClick = { goFiches() }) { Text("Fiches révision") }
        // #87 : une entree dont l'onglet n'est pas actif chez l'etablissement
        // n'est pas proposee ; son ecran reste atteignable en cas de besoin et
        // affiche son etat vide propre.
        if (Capabilities.visible(capabilities, Capabilities.NEWS)) {
            Button(onClick = { goNews() }) { Text("Actualités") }
        }
        if (Capabilities.visible(capabilities, Capabilities.MENUS)) {
            Button(onClick = { goCanteen() }) { Text("Cantine semaine") }
        }
        if (Capabilities.visible(capabilities, Capabilities.ATTENDANCE)) {
            Button(onClick = { goAttendance() }) { Text("Vie scolaire") }
        }
        Button(onClick = { onRefreshCapabilities() }) { Text("Détecter les onglets") }
        Button(onClick = { goMessages() }) { Text("Messages") }
        Button(onClick = goAlerts) { Text("Alertes sécurité") }
        Button(onClick = goSettings) { Text("Réglages") }
        Button(onClick = onLogout) { Text("Se déconnecter") }
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
) {
    var profile by remember(baseUrl) { mutableStateOf<UserProfile?>(null) }
    var loaded by remember(baseUrl) { mutableStateOf(false) }
    var error by remember(baseUrl) { mutableStateOf("") }
    var photo by remember(baseUrl) { mutableStateOf<PhotoState>(PhotoState.Absent) }
    var accountCount by remember(baseUrl) { mutableStateOf(accounts.count()) }
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
    // #135 : UNE racine, et DÉFILABLE. Avant, ce composable émettait un `Button`
    // puis `ProfileScreen` (dont la racine est un `Column` en `fillMaxSize`)
    // : deux racines dans UN seul slot du NavHost, donc la seconde débordait
    // d'environ 48 dp et « Se déconnecter » — l'action la plus
    // consequential de l'écran — sortait de l'écran, sans aucun défilement
    // pour y revenir. Le défilement est ici, au plus haut : c'est lui qui rend
    // « Se déconnecter » atteignable. Le `fillMaxSize` du `Column` interne
    // devient sans effet (une hauteur infinie ne se remplit pas), donc il se
    // contente d'envelopper son contenu. 
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Button(onClick = { refresh() }) { Text(if (loaded) "Actualiser le profil" else "Charger le profil") }
        if (error.isNotEmpty()) Text(error)
        ProfileScreen(
            baseUrl = baseUrl,
            profile = profile,
            photo = photo,
            accountCount = accountCount,
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
            onLogout = {
                onLogout()
                profile = null
                photo = PhotoState.Absent
                loaded = false
                error = ""
                accountCount = accounts.count()
            },
        )
    }
}