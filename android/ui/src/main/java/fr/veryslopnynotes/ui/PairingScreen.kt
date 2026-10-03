package fr.veryslopnynotes.ui

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.PairingRepository
import fr.veryslopnynotes.data.PairingResult
import fr.veryslopnynotes.data.SseClient
import fr.veryslopnynotes.data.SseListener
import fr.veryslopnynotes.data.SseState
import fr.veryslopnynotes.data.SessionTokens
import fr.veryslopnynotes.data.isValidPin
import fr.veryslopnynotes.data.parseQrPayload

// Route appairage (#15) : scan QR (JSON sessionId+code) + saisie PIN manuelle,
// confirm vers serveur allowlist seul, secret du device stocké chiffré
// (contrat 0.4.0), SSE reconnect avec états visibles. Aucun hôte tiers ici
// (ApiClient allowlist, I1).
// Le serveur se choisit ICI, avant l'appairage : sans son adresse, impossible
// d'appairer (le champ est donc dans le même écran que le QR + PIN).
@Composable
fun PairingRoute(
    baseUrl: String,
    onBack: () -> Unit,
    // #113 : arrivée sur écran d'appairage après un 401. Phrase factuelle
    // (« credential refusée »), jamais une cause devinée ni un chrono.
    notice: String? = null,
    // Adresse du serveur : validation + persistance en aval. Renvoie null si
    // elle est enregistrée (la session a alors été purgée), sinon le message
    // de refus à afficher tel quel.
    onServerChange: (String) -> String? = { null },
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val main = remember { Handler(Looper.getMainLooper()) }
    // UN store pour l'écran : il alimente ApiClient (bearer) ET reçoit le
    // secret de la réponse d'appairage. Le client le relit à chaque requête,
    // donc le token s'utilise tout de suite après le pairing.
    val tokens = remember(context) { SessionTokens.get(context) }
    val api = remember(baseUrl, tokens) { ApiClient(baseUrl, tokens = tokens) }
    val repo = remember(api) { PairingRepository(api) }
    val sse = remember(api) { SseClient(api) }
    // Saisie du serveur, pré-remplie avec l'adresse courante. Volontairement
    // NON liée à `baseUrl` pour le texte : un changement de serveur ne doit pas
    // effacer ce que l'utilisateur est en train de taper.
    var serverDraft by remember { mutableStateOf(baseUrl) }
    var serverError by remember { mutableStateOf<String?>(null) }
    // Confirmation du changement (la session a été purgée) : hors `baseUrl`
    // sinon elle serait effacée par le changement qu'elle annonce.
    var serverSaved by remember { mutableStateOf(false) }

    var form by remember { mutableStateOf(PairingForm()) }
    // ponytail: callbacks OkHttp hors main → post main. Upgrade: Flow/ViewModel.
    val listener = remember {
        object : SseListener {
            override fun onState(s: SseState) {
                main.post { form = form.copy(sse = s) }
            }

            override fun onEvent(json: String) {
                main.post { form = form.copy(sse = form.sse, lastEventPreview = json.take(120)) }
            }
        }
    }

    DisposableEffect(sse) {
        onDispose { sse.disconnect() }
    }

    Column(
        modifier = modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        Button(onClick = onBack, modifier = Modifier.padding(16.dp)) { Text("Retour") }
        if (!notice.isNullOrEmpty()) Text(notice)
        ServerField(
            value = serverDraft,
            onChange = { serverDraft = it; serverError = null; serverSaved = false },
            error = serverError,
            saved = serverSaved,
            onSubmit = {
                val refusal = onServerChange(serverDraft)
                serverError = refusal
                serverSaved = refusal == null
                if (refusal == null) {
                    // Le QR et le PIN concernent l'ancien serveur : les effacer
                    // évite un appairage impossible à comprendre.
                    form = form.copy(qrRaw = "", pin = "", state = PairingState.Idle)
                }
            },
        )
        PairingFormContent(
            form = form,
            onQrChange = { form = form.copy(qrRaw = it, state = PairingState.Idle) },
            onPinChange = { form = form.copy(pin = it, state = PairingState.Idle) },
            onConfirm = {
                val qr = parseQrPayload(form.qrRaw)
                val pin = form.pin.trim()
                if (qr == null) {
                    form = form.copy(state = PairingState.Error("QR invalide : rescanez le code affiché par le serveur"))
                    return@PairingFormContent
                }
                if (!isValidPin(pin)) {
                    form = form.copy(state = PairingState.Error("PIN invalide : 6 chiffres requis"))
                    return@PairingFormContent
                }
                form = form.copy(state = PairingState.Confirming)
                val sessionId = qr.sessionId
                Thread {
                    val res = repo.confirmBlocking(sessionId, pin)
                    main.post {
                        when (res) {
                            is PairingResult.Ok -> {
                                try {
                                    // Le secret est montré UNE fois : s'il est absent ou
                                    // invalide, `save` échoue et RIEN n'est stocké.
                                    tokens.save(res.device.id, res.device.tokenHash, res.device.token)
                                } catch (e: IllegalArgumentException) {
                                    form = form.copy(state = PairingState.Error("Appareil invalide"))
                                    return@post
                                }
                                form = form.copy(state = PairingState.Paired(res.device.id))
                                sse.connect(listener)
                            }
                            is PairingResult.Err -> {
                                val msg = when {
                                    res.kind.startsWith("http_404") -> "Session inconnue ou expirée"
                                    res.kind.startsWith("http_400") -> "PIN incorrect ou session verrouillée"
                                    res.kind == "network" -> "Réseau indisponible (${res.message})"
                                    else -> res.message.take(160)
                                }
                                form = form.copy(state = PairingState.Error(msg))
                            }
                        }
                    }
                }.start()
            },
            onSseConnect = { sse.connect(listener) },
            onSseDisconnect = {
                sse.disconnect()
                form = form.copy(sse = SseState.Disconnected)
            },
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * Champ « Serveur » de l'écran d'appairage : l'adresse saisie par
 * l'utilisateur, validée À LA SOUMISSION (rien n'est écrit ni purgé tant que
 * l'adresse n'est pas acceptée). Le message d'erreur est celui de la
 * validation, affiché tel quel : l'écran n'invente aucun diagnostic.
 * ponytail: aucune sonde de joignabilité ici — un appel au serveur pour tester
 * une adresse saisie serait une requête que l'utilisateur n'a pas confirmée.
 * L'appairage est la preuve de joignabilité.
 */
@Composable
fun ServerField(
    value: String,
    onChange: (String) -> Unit,
    error: String?,
    saved: Boolean,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("Serveur")
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            label = { Text("Adresse du serveur (https://domaine[:port])") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(serverHint(value))
        if (!error.isNullOrEmpty()) Text(error)
        if (saved) Text("Serveur enregistré. Ré-appairez l'appareil si l'adresse a changé.")
        Button(onClick = onSubmit, modifier = Modifier.fillMaxWidth()) { Text("Enregistrer le serveur") }
    }
}
