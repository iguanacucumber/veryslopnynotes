package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
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

// Formulaire pur (sans dépendance réseau) : testable en preview.
// Le câblage réseau vit dans PairingRoute (même module, bas du fichier).
@Composable
fun PairingFormContent(
    form: PairingForm,
    onQrChange: (String) -> Unit,
    onPinChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onSseConnect: () -> Unit,
    onSseDisconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Appairage QR + PIN")
        Text(pairingStateLabel(form.state))
        TextField(
            value = form.qrRaw,
            onValueChange = onQrChange,
            label = { Text("Résultat scan QR (JSON sessionId+code)") },
            placeholder = { Text("{\"sessionId\":\"…\",\"code\":\"123456\"}") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = false,
            maxLines = 4,
        )
        TextField(
            value = form.pin,
            onValueChange = { v -> if (v.length <= 6 && v.all { it.isDigit() }) onPinChange(v) },
            label = { Text("PIN à 6 chiffres") },
            placeholder = { Text("123456") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        )
        Button(
            onClick = onConfirm,
            enabled = form.state != PairingState.Confirming,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (form.state == PairingState.Confirming) "Vérification…" else "Confirmer l'appairage")
        }
        if (form.state is PairingState.Error) {
            Text("Réessayez : rescanez le QR puis retapez le PIN.")
        }
        SseStatusRow(
            state = form.sse,
            onConnect = onSseConnect,
            onDisconnect = onSseDisconnect,
        )
        form.lastEventPreview?.let { preview ->
            Text("Dernier événement : $preview")
        }
    }
}
