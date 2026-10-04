package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.SseState

// Ligne d'état SSE visible (#15) : déconnecté / connexion / connecté /
// reconnexion avec délai / échec. Bouton Reconnecter / Déconnecter.
@Composable
fun SseStatusRow(
    state: SseState,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = sseLabel(state),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        when (state) {
            is SseState.Disconnected, is SseState.Failed -> {
                Button(onClick = onConnect) { Text("Reconnecter") }
            }
            is SseState.WaitingRetry -> {
                OutlinedButton(onClick = onDisconnect) { Text("Stop") }
            }
            is SseState.Connecting, is SseState.Connected -> {
                OutlinedButton(onClick = onDisconnect) { Text("Déconnecter") }
            }
        }
    }
}
