package fr.veryslopnynotes.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import fr.veryslopnynotes.ui.AppNav

// Shell phase 4 (#13) + offline #14 + appairage/SSE #15 + alertes #21.
// Navigation Material3 + routes "pairing" (QR+PIN, token chiffré) et
// "alerts" (I6 : donnée jamais interprétée). Aucun appel réseau ici
// (téléphone ne contacte que le serveur allowlist, I1) : on ne fournit que la
// GRAINE d'adresse (local.properties server.host ou env SERVER_HOST), que
// ServerStore/AppNav remplacent par le serveur choisi à l'exécution.
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // #135 : la fenêtre occupe tout l'écran.
        // Avant : la fenêtre s'arrêtait sous la barre système, donc la bande de
        // statut restait du fond de fenêtre — un bandeau gris au-dessus de la
        // barre du haut. Les INSETS restent à la charge du `Scaffold` (barre du
        // haut + barre d'onglets consomment `windowInsets`), donc aucun
        // contenu ne passe dessous. ponytail: la fonction d'activity-compose
        // déjà présente (zéro dépendance ajoutée).
        enableEdgeToEdge()
        val baseUrlSeed = fr.veryslopnynotes.core.ServerConfig.baseUrl(
            BuildConfig.SERVER_SCHEME,
            BuildConfig.SERVER_HOST,
        )
        // Toggle "fait" #75 : l'app n'envoie pas d'accountId (le serveur
        // mono-compte résout sa session appairée) ; #82 exposera /v1/me pour un
        // multi-compte. Jamais un hôte Pronote ici (I1), et l'écriture reste
        // une action utilisateur confirmée (I7).
        // #134 : plus de `MaterialTheme { }` ici. Ce thème extérieur sans
        // argument se posait AVANT celui d'AppNav, en light par défaut : il
        // écrasait le thème choisi dans les réglages et le forçait au clair.
        // Le thème est appliqué une seule fois, à la racine, par PapillonTheme.
        // #172 : plus de `loadAlerts` — l'écran Alertes lit le cache partagé
        // (`SyncedRepository`), donc ce chargement était mort depuis #144. Le
        // bearer est relu par `ApiClient` à chaque requête : il n'a rien à
        // faire ici.
        setContent { AppNav(baseUrlSeed = baseUrlSeed) }
    }
}
