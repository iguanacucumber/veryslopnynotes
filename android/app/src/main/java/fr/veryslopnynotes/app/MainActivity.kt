package fr.veryslopnynotes.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import fr.veryslopnynotes.ui.AppNav

// Shell phase 4 (#13) : navigation Material3 seule. Données réelles
// branchées phases 4-5 (#14 offline, #15 pairing/SSE) ; aucun appel
// réseau ici (téléphone ne contacte que le serveur allowlist, I1).
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                AppNav()
            }
        }
    }
}
