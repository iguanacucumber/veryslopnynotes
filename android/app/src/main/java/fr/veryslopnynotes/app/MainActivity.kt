package fr.veryslopnynotes.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import fr.veryslopnynotes.ui.AppNav

// Shell phase 4 (#13) + appairage/SSE #15 : navigation Material3 + route
// "pairing" (QR+PIN, token chiffré, SSE reconnect). Aucun appel réseau ici
// (téléphone ne contacte que le serveur allowlist, I1) : baseUrl injectée
// depuis BuildConfig (local.properties server.host ou env SERVER_HOST).
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val baseUrl = fr.veryslopnynotes.core.ServerConfig.baseUrl(
            BuildConfig.SERVER_SCHEME,
            BuildConfig.SERVER_HOST,
        )
        setContent {
            MaterialTheme {
                AppNav(baseUrl = baseUrl)
            }
        }
    }
}
