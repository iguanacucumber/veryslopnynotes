package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

// Shell #13 : 3 destinations placeholder (Notes/Devoirs/EDT).
// États chargement/erreur propres ; données réelles #14 (offline).
// Contenu serveur affiché comme donnée, jamais interprété.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppNav() {
    val nav = rememberNavController()
    Scaffold(
        topBar = { TopAppBar(title = { Text("VerySlopyNyNotes") }) },
    ) { pad ->
        NavHost(
            navController = nav,
            startDestination = "grades",
            modifier = Modifier.padding(pad),
        ) {
            composable("grades") { PlaceholderScreen("Notes", "assignments", { nav.navigate(it) }) }
            composable("assignments") { PlaceholderScreen("Devoirs", "timetable", { nav.navigate(it) }) }
            composable("timetable") { PlaceholderScreen("EDT", "grades", { nav.navigate(it) }) }
        }
    }
}

@Composable
fun PlaceholderScreen(title: String, next: String, go: (String) -> Unit) {
    // ponytail: état local seul (pas de ViewModel avant données #14).
    var state by remember { mutableStateOf("idle") }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title)
        when (state) {
            "idle" -> Text("En attente de synchronisation (phase 5).")
            "loading" -> Text("Chargement…")
            "error" -> Text("Erreur réseau. Réessayer.")
        }
        Button(onClick = { state = "loading" }) { Text("Charger") }
        Button(onClick = { state = "error" }) { Text("Simuler erreur") }
        Button(onClick = { go(next) }) { Text("Aller à $next") }
    }
}
