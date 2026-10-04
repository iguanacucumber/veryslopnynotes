package fr.veryslopnynotes.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.SecurityAlertsRepository
import fr.veryslopnynotes.data.SessionTokens
import fr.veryslopnynotes.ui.AppNav
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Shell phase 4 (#13) + offline #14 + appairage/SSE #15 + alertes #21.
// Navigation Material3 + routes "pairing" (QR+PIN, token chiffré) et
// "alerts" (I6 : donnée jamais interprétée). Aucun appel réseau ici
// (téléphone ne contacte que le serveur allowlist, I1) : on ne fournit que la
// GRAINE d'adresse (local.properties server.host ou env SERVER_HOST), que
// ServerStore/AppNav remplacent par le serveur choisi à l'exécution.
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val baseUrlSeed = fr.veryslopnynotes.core.ServerConfig.baseUrl(
            BuildConfig.SERVER_SCHEME,
            BuildConfig.SERVER_HOST,
        )
        // ponytail: client paresseux, IO hors UI-thread via loader suspend.
        // Contrat 0.4.0 : les routes lues exigent le bearer du device appairé,
        // relu ici à chaque requête depuis le store chiffré.
        val tokens = SessionTokens.get(this)
        // Toggle "fait" #75 : l'app n'envoie pas d'accountId (le serveur
        // mono-compte résout sa session appairée) ; #82 exposera /v1/me pour un
        // multi-compte. Jamais un hôte Pronote ici (I1), et l'écriture reste
        // une action utilisateur confirmée (I7).
        setContent {
            MaterialTheme {
                AppNav(
                    baseUrlSeed = baseUrlSeed,
                    // L'adresse arrive en paramètre : après un changement de
                    // serveur, les alertes suivent le serveur courant.
                    loadAlerts = { url ->
                        withContext(Dispatchers.IO) {
                            SecurityAlertsRepository(ApiClient(url, tokens = tokens)).fetch()
                        }
                    },
                )
            }
        }
    }
}
