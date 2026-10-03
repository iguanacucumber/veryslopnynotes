package fr.veryslopnynotes.ui

import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.ServerUrlResult
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.HealthResult
import fr.veryslopnynotes.data.SessionTokens
import fr.veryslopnynotes.data.SetupInput
import fr.veryslopnynotes.data.SetupRepository
import fr.veryslopnynotes.data.SetupResult
import fr.veryslopnynotes.data.SseClient
import fr.veryslopnynotes.data.SseListener
import fr.veryslopnynotes.data.SseState
import fr.veryslopnynotes.data.isBoundedSchoolUrl
import fr.veryslopnynotes.data.parseSchoolQr
import fr.veryslopnynotes.data.probeHealthBlocking

// Assistant de connexion (#120) : serveur -> compte EduConnect -> QR Pronote.
// Un SEUL appel (POST /v1/setup) ouvre la session de l'établissement ET rend le
// jeton d'appareil, là où il fallait avant coller du JSON obtenu au curl, retaper
// un PIN, puis découvrir que l'ENT n'était même pas joignable.
//
// L'écran est aussi la destination du 401 (#113) : après un redémarrage serveur,
// c'est lui qui rouvre la session ET le credential, pas l'ancien appairage.
// Aucun hôte tiers ici : ApiClient allowlist serveur seul (I1).
@Composable
fun PairingRoute(
    baseUrl: String,
    onBack: () -> Unit,
    // #113 : arrivée ici après un 401. Phrase factuelle (« credential
    // refusée »), jamais une cause devinée ni un chrono.
    notice: String? = null,
    // Adresse du serveur : validation + persistance en aval. Renvoie null si
    // elle est enregistrée (la session a alors été purgée), sinon le message
    // de refus à afficher tel quel.
    onServerChange: (String) -> String? = { null },
    // Setup réussi : l'assistant sort vers l'accueil. L'utilisateur n'a rien
    // à confirmer de plus — sa saisie EST la preuve qu'il est son compte.
    onPaired: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val main = remember { Handler(Looper.getMainLooper()) }
    // UN store pour l'écran : il alimente ApiClient (bearer) ET reçoit le
    // secret de la réponse. Le client le relit à chaque requête, donc le
    // token s'utilise tout de suite après le setup.
    val tokens = remember(context) { SessionTokens.get(context) }
    val api = remember(baseUrl, tokens) { ApiClient(baseUrl, tokens = tokens) }
    val repo = remember(api) { SetupRepository(api) }
    val sse = remember(api) { SseClient(api) }
    // Saisie du serveur, pré-remplie avec l'adresse courante. Volontairement
    // NON liée à `baseUrl` pour le texte : un changement de serveur ne doit pas
    // effacer ce que l'utilisateur est en train de taper.
    var serverDraft by remember { mutableStateOf(baseUrl) }
    var serverError by remember { mutableStateOf<String?>(null) }
    // Confirmation du changement (la session a été purgée) : hors `baseUrl`
    // sinon elle serait effacée par le changement qu'elle annonce.
    var serverSaved by remember { mutableStateOf(false) }
    var step by remember { mutableStateOf(SetupStep.SERVER) }
    var form by remember { mutableStateOf(SetupForm()) }
    // Version de contrat annoncée par le serveur joignable : preuve que la
    // réponse vient bien de trèsslopnynotes, affichée telle quelle.
    var serverVersion by remember { mutableStateOf<String?>(null) }

    // ponytail: callbacks OkHttp hors main → post main. Upgrade: Flow/ViewModel.
    val listener = remember {
        object : SseListener {
            override fun onState(s: SseState) {
                main.post { form = form.copy(sse = s) }
            }

            override fun onEvent(json: String) {
                main.post { form = form.copy(lastEventPreview = json.take(120)) }
            }
        }
    }

    DisposableEffect(sse) {
        onDispose { sse.disconnect() }
    }

    /** Envoi du setup : réseau sur thread, retour sur le main. */
    val submit: (SetupInput) -> Unit = { input ->
        form = form.copy(state = PairingState.Submitting)
        Thread {
            val res = repo.runBlocking(deviceName(), input)
            main.post {
                when (res) {
                    is SetupResult.Ok -> {
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
                        onPaired()
                    }
                    is SetupResult.Err -> {
                        form = form.copy(state = PairingState.Error(res.message))
                    }
                }
            }
        }.start()
    }

    Column(
        modifier = modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        Button(onClick = onBack, modifier = Modifier.padding(16.dp)) { Text("Retour") }
        if (!notice.isNullOrEmpty()) Text(notice, modifier = Modifier.padding(horizontal = 16.dp))
        Text(setupStepLabel(step), modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        when (step) {
            SetupStep.SERVER -> ServerField(
                value = serverDraft,
                onChange = { serverDraft = it; serverError = null; serverSaved = false },
                error = serverError,
                saved = serverSaved,
                version = serverVersion,
                onSubmit = {
                    val refusal = onServerChange(serverDraft)
                    if (refusal != null) {
                        serverError = refusal
                        return@ServerField
                    }
                    serverError = null
                    serverSaved = true
                    // Adresse VALIDÉE (donc normalisée) que la sonde doit
                    // interroger : `api` est encore bound sur l'ancien serveur.
                    val target = (ServerConfig.validateBaseUrl(serverDraft) as? ServerUrlResult.Ok)?.baseUrl ?: serverDraft
                    // Sonde de joignabilité, mais SEULEMENT maintenant : l'utilisateur
                    // vient d'appuyer sur « Continuer », donc l'appel est le sien. Sans
                    // elle, une mauvaise adresse se découvre trois écrans plus tard,
                    // sous la forme d'un « identifiants refusés » mensonger.
                    Thread {
                        val probe = probeHealthBlocking(target)
                        main.post {
                            when (probe) {
                                is HealthResult.Alive -> {
                                    serverVersion = probe.version
                                    step = SetupStep.ACCOUNT
                                }
                                is HealthResult.Unreachable -> {
                                    serverError = probe.message
                                    serverSaved = false
                                }
                            }
                        }
                    }.start()
                },
                modifier = Modifier.weight(1f),
            )
            SetupStep.ACCOUNT -> AccountStep(
                form = form,
                onChange = { form = it },
                onNext = { next -> step = next },
            )
            SetupStep.QR -> QrStep(
                form = form,
                onChange = { form = it },
                onSubmit = submit,
                onSseConnect = { sse.connect(listener) },
                onSseDisconnect = { sse.disconnect(); form = form.copy(sse = SseState.Disconnected) },
            )
        }
    }
}

/** Nom du device transmis au serveur. Jamais une donnée personnelle. */
private fun deviceName(): String = Build.MODEL?.takeIf { it.isNotBlank() } ?: "appareil"

/**
 * Champ « Serveur » : l'adresse saisie, validée À LA SOUMISSION (rien n'est
 * écrit ni purgé tant qu'elle n'est pas acceptée). Le message d'erreur est
 * celui de la validation ou de la sonde, affiché tel quel : l'écran
 * n'invente aucun diagnostic.
 */
@Composable
fun ServerField(
    value: String,
    onChange: (String) -> Unit,
    error: String?,
    saved: Boolean,
    version: String?,
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
        if (saved) Text("Serveur enregistré. Si l'adresse change, reconnecte l'appareil.")
        if (!version.isNullOrEmpty()) Text("Serveur joignable — contrats $version.")
        Button(onClick = onSubmit, modifier = Modifier.fillMaxWidth()) { Text("Continuer") }
    }
}

/**
 * Étape 2 : l'URL de l'établissement + les identifiants EduConnect. Aucun mot de
 * passe n'est persisté côté app : il part dans le POST /v1/setup et n'en
 * ressort jamais (le serveur le garde en mémoire pour renouveler la session).
 */
@Composable
private fun AccountStep(
    form: SetupForm,
    onChange: (SetupForm) -> Unit,
    onNext: (SetupStep) -> Unit,
) {
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("Ton compte sur l'ENT")
        OutlinedTextField(
            value = form.schoolUrl,
            onValueChange = { onChange(form.copy(schoolUrl = it)) },
            label = { Text("Adresse de l'établissement") },
            supportingText = { Text("Celle de ton espace élève, avec son port si besoin.") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        TextField2(
            value = form.ent,
            onValueChange = { onChange(form.copy(ent = it.trim())) },
            label = "Type d'ENT",
        )
        OutlinedTextField(
            value = form.username,
            onValueChange = { onChange(form.copy(username = it)) },
            label = { Text("Identifiant EduConnect") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = form.password,
            onValueChange = { onChange(form.copy(password = it)) },
            label = { Text("Mot de passe") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it) }
        if (form.hasCredentials) {
            Button(
                onClick = { onNext(SetupStep.QR) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Continuer") }
        }
        // Établissement sans identifiants utilisables (compte QR seul, compte
        // transmis par l'établissement) : on ne bloque pas sur une étape vide.
        OutlinedButton(
            onClick = {
                if (!isBoundedSchoolUrl(form.schoolUrl)) {
                    error = "Adresse de l'établissement absente : elle est obligatoire."
                } else {
                    onNext(SetupStep.QR)
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("J'ai seulement un QR") }
    }
}

/**
 * Étape 3 : le QR affiché par l'application Pronote/ENT. `login` + `jeton` sont
 * des blocs chiffrés dont la clé est le PIN : les deux sont donc nécessaires,
 * et le PIN est celui défini dans Pronote (pas un code à 6 chiffres imposé par
 * l'app). Le collage reste possible quand l'appareil n'a pas de caméra.
 */
@Composable
private fun QrStep(
    form: SetupForm,
    onChange: (SetupForm) -> Unit,
    onSubmit: (SetupInput) -> Unit,
    onSseConnect: () -> Unit,
    onSseDisconnect: () -> Unit,
) {
    var error by remember { mutableStateOf<String?>(null) }
    val qr = parseSchoolQr(form.qrRaw)
    val input = SetupInput(
        schoolUrl = form.schoolUrl,
        ent = form.ent,
        username = form.username,
        password = form.password,
        qr = qr,
        pin = form.pin.trim(),
    )
    val busy = form.state == PairingState.Submitting
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("QR de l'application")
        OutlinedTextField(
            value = form.qrRaw,
            onValueChange = { onChange(form.copy(qrRaw = it)) },
            label = { Text("Contenu du QR (login + jeton)") },
            supportingText = { Text("Colle le contenu affiché par l'application de ton établissement, ou scanne-le.") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = false,
            maxLines = 4,
        )
        OutlinedTextField(
            value = form.pin,
            onValueChange = { v -> if (v.length <= PIN_MAX_CHARS) onChange(form.copy(pin = v)) },
            label = { Text("Code PIN du QR") },
            supportingText = { Text("Celui défini dans ton compte établissement : il déchiffre le QR.") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it) }
        if (form.state is PairingState.Error) Text(pairingStateLabel(form.state))
        // QR + PIN = méthode complète. Sinon les identifiants de l'étape 2
        // partent seuls : les deux ensemble sont deux sessions concurrentes.
        if (qr != null && form.pin.isNotBlank() || form.hasCredentials) {
            Button(
                onClick = {
                    if (qr == null && form.pin.isNotBlank()) {
                        error = "QR illisible : rescane-le ou colle-le en JSON."
                    } else if (qr != null && form.pin.isBlank()) {
                        error = "Code PIN du QR obligatoire : il déchiffre le contenu scanné."
                    } else {
                        onSubmit(input)
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (busy) "Connexion…" else "Terminer") }
        } else {
            Text("Il faut le QR + son PIN, ou les identifiants EduConnect de l'étape 2.")
        }
        SseStatusRow(state = form.sse, onConnect = onSseConnect, onDisconnect = onSseDisconnect)
        form.lastEventPreview?.let { preview -> Text("Dernier événement : $preview") }
    }
}

/** Champ texte court, factorisé (libellé + valeur + clavier). */
@Composable
private fun TextField2(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Miroir de SETUP_PIN_MAX_CHARS (shared/contracts/api.ts). */
private const val PIN_MAX_CHARS = 64