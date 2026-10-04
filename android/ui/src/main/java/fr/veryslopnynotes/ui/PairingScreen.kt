package fr.veryslopnynotes.ui

import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.HealthResult
import fr.veryslopnynotes.data.ServerStore
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

// Assistant de connexion (#120) : serveur -> compte Pronote -> QR Pronote.
// Un SEUL appel (POST /v1/setup) ouvre la session de l'établissement ET rend le
// jeton d'appareil, là où il fallait avant coller du JSON obtenu au curl, retaper
// un PIN, puis découvrir que l'établissement n'était même pas joignable.
//
// L'écran est aussi la destination du 401 (#113) : après un redémarrage serveur,
// c'est lui qui rouvre la session ET le credential, pas l'ancien appairage.
// Aucun hôte tiers ici : ApiClient allowlist serveur seul (I1).
//
// #145 : la validation VIBRE quand l'appairage réussit (le parcours se termine et
// l'écran disparaît : sans retour physique, rien ne dit que c'est passé), et les
// messages d'erreur passent en COULEUR D'ERREUR — ils étaient en encre de texte,
// exactement comme les messages de succès (« Serveur enregistré », « Serveur
// joignable »), donc un refus se lisait comme une validation. Ils apparaissent en
// plus avec l'ouverture mesurée, au lieu d'apparaître d'un coup.
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
    val haptics = rememberPapHaptics()

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
                        // #145 : le parcours est terminé et l'écran va quitter —
                        // le retour physique est le seul signal qui reste.
                        haptics.confirm()
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
        // #172 : le retour remonte D'ABORD d'un cran dans le parcours. Hors
        // première étape, `popBackStack` ne peut rien faire (au premier
        // lancement l'assistant EST la route de départ ; après un 401 la pile a
        // été vidée), donc les étapes 2 et 3 n'avaient aucun chemin de retour.
        val previous = previousStep(step)
        Button(
            onClick = { if (previous != null) step = previous else onBack() },
            modifier = Modifier.padding(16.dp),
        ) { Text(if (previous != null) "Étape précédente" else "Retour") }
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
        // #130 : en paysage la colonne débordait et « Continuer » tombait hors
        // écran — l'assistant était inutilisable. Chaque étape défile donc.
        modifier = modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
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
        // #145 : l'erreur prend la couleur d'erreur et s'OUVRE au lieu d'apparaître
        // d'un coup — elle était en encre de texte, comme les deux messages de
        // succès qui l'entourent.
        PapAppear(visible = !error.isNullOrEmpty()) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        if (saved) Text("Serveur enregistré. Si l'adresse change, reconnecte l'appareil.")
        if (!version.isNullOrEmpty()) Text("Serveur joignable — contrats $version.")
        Button(onClick = onSubmit, modifier = Modifier.fillMaxWidth()) { Text("Continuer") }
    }
}

/**
 * Étape 2 : l'adresse de l'établissement, et basta. 0.7.0 : l'app ne saisit
 * PLUS aucun identifiant — la seule preuve de détention est le QR de l'étape 3,
 * que le serveur ne stocke pas (il le garde en mémoire le temps de la session,
 * pour la renewal, et ne le journalise jamais).
 */
@Composable
private fun AccountStep(
    form: SetupForm,
    onChange: (SetupForm) -> Unit,
    onNext: (SetupStep) -> Unit,
) {
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("Ton établissement")
        OutlinedTextField(
            value = form.schoolUrl,
            onValueChange = { onChange(form.copy(schoolUrl = it)) },
            label = { Text("Adresse de l'établissement") },
            supportingText = { Text("Celle de ton espace élève, avec son port si besoin.") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        // #145 : couleur d'erreur + ouverture mesurée (cf. `ServerField`).
        PapAppear(visible = error != null) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        Button(
            onClick = {
                if (!isBoundedSchoolUrl(form.schoolUrl)) {
                    error = "Adresse de l'établissement absente : elle est obligatoire."
                } else {
                    onNext(SetupStep.QR)
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Continuer") }
    }
}

/**
 * Étape 3 : le QR affiché par l'application Pronote. `login` + `jeton` sont
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
    // #127 : rien de lu (annulé, permission refusée, QR illisible) -> une phrase
    // qui dit quoi faire. Le silence de #122 rendait le bouton « inerte ».
    val scan = rememberQrScanner { scanned ->
        if (scanned != null) {
            error = null
            onChange(form.copy(qrRaw = scanned))
        } else {
            error = "Aucun QR lu (annulé, caméra refusée ou code illisible) : colle le contenu ci-dessous."
        }
    }
    val input = SetupInput(
        schoolUrl = form.schoolUrl,
        qr = qr,
        pin = form.pin.trim(),
    )
    val busy = form.state == PairingState.Submitting
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("QR de l'application")
        // #127 : scan direct, décodeur dans l'APK (permission CAMERA demandée
        // par l'activité de scan). `null` = rien de lu, on ne remplace rien et
        // le message le dit ; le collage ci-dessous reste le repli.
        Button(
            onClick = scan,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Scanner le QR") }
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
            // #172 : le PIN est un SECRET — il masque par défaut, comme la clé
            // LLM des Réglages (#140). Sans `visualTransformation`, les chiffres
            // étaient lisibles par-dessus l'épaule ET présents tels quels dans la
            // hiérarchie de vues (ce que relit `uiautomator dump`, donc une
            // capture, donc un fichier) : `KeyboardType.NumberPassword` ne change
            // que le clavier, jamais ce qui est affiché ni ce qui est stocké
            // dans l'arbre. La transformation porte sur l'AFFICHAGE : la saisie,
            // le collage et ce qui part dans `SetupInput` sont inchangés.
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )
        // #145 : les DEUX refus de cette étape (scan, puis setup) partagent la
        // couleur d'erreur et la même ouverture mesurée.
        PapAppear(visible = error != null || form.state is PairingState.Error) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (form.state is PairingState.Error) {
                Text(pairingStateLabel(form.state), color = MaterialTheme.colorScheme.error)
            }
        }
        // QR + PIN = la méthode UNIQUE (0.7.0). Un des deux seul -> refus local,
        // message actionnable, aucun appel réseau.
        val pret = qr != null && form.pin.isNotBlank()
        if (pret) {
            Button(
                onClick = { onSubmit(input) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (busy) "Connexion…" else "Terminer") }
        } else {
            Text(
                when {
                    qr == null && form.pin.isNotBlank() -> "QR illisible : rescane-le ou colle-le en JSON."
                    qr != null -> "Code PIN du QR obligatoire : il déchiffre le contenu scanné."
                    else -> "Il faut le QR affiché par ton application + son PIN."
                },
            )
        }
        // #172 : l'état SSE sort du parcours principal. L'état brut (« SSE
        // reconnexion… (essai 3, 1500 ms) ») et le dernier événement écrit
        // étaient un TABLEAU DE BORD d'exploitation, visible par un élève dès la
        // première étape, sous les deux seuls gestes qui comptent (scanner le QR,
        // saisir son PIN). Ils sont repliés derrière UN bouton — repliés, pas
        // supprimés : c'est le seul endroit de l'app où l'on peut constater si
        // les notifications en direct fonctionnent, donc le diagnostic doit
        // rester atteignable. Ouvert, il dit la même chose en français courant
        // (`sseLabel`), et le JSON brut reste sous le même dépliant que les
        // « Détails » de `PapErrorState` : une donnée affichée, jamais exécutée.
        var sseDetails by remember { mutableStateOf(false) }
        TextButton(onClick = { sseDetails = !sseDetails }) {
            Text(if (sseDetails) "Masquer l'état des notifications" else "État des notifications")
        }
        if (sseDetails) {
            SseStatusRow(state = form.sse, onConnect = onSseConnect, onDisconnect = onSseDisconnect)
            form.lastEventPreview?.let { preview -> Text("Dernier événement : $preview") }
        }
    }
}

/**
 * Changement de serveur = changement d'établissement. (#135 : cette fonction
 * vivait dans `AppNav.kt` ; elle est la logique de CET écran — changer de
 * serveur, c'est se ré-appairer — et elle y prenait 40 lignes pour rien.) Le jeton d'appareil est
 * un BEARER de l'ANCIEN serveur : le conserver enverrait un credential vivant
 * au nouveau. Donc, dans cet ordre : valider (aucun effet de bord), purger
 * session + caches par le chemin EXISTANT `accounts.logout()` (ni purge
 * parallèle, ni nouveau store), puis persister. Un refus renvoie son message
 * français et ne change RIEN ; `onSwitched` n'est appelé qu'une fois la purge
 * faite et l'adresse enregistrée.
 *
 * ponytail: purge AVANT écriture — un stockage KO coûte alors une déconnexion,
 * alors que l'inverse laisserait une fenêtre où le nouveau serveur est écrit et
 * le credential de l'ancien encore vivant. Fonction top-level (pas une locale
 * dans le composable) : la validation et l'ordre des effets n'ont rien à faire
 * dans un corps recomposé. `when` + `is` positif : dans ce module, le plugin
 * Compose casse le smart cast après un `!is` (vérifié à la compilation).
 */
internal fun changeServer(
    raw: String,
    current: String,
    accounts: AccountStore,
    serverStore: ServerStore,
    onSwitched: (String) -> Unit,
): String? {
    val target = when (val validated = ServerConfig.validateBaseUrl(raw)) {
        is ServerUrlResult.Rejected -> return validated.message
        is ServerUrlResult.Ok -> validated.baseUrl
    }
    if (target == current) return null
    // On enregistre AVANT de déconnecter : si l'écriture échoue, l'utilisateur
    // garde sa session et son cache au lieu d'être déconnecté pour rien.
    val saved = serverStore.save(target)
    if (saved is ServerUrlResult.Rejected) return saved.message
    accounts.logout()
    onSwitched(target)
    return null
}

/** Miroir de SETUP_PIN_MAX_CHARS (shared/contracts/api.ts). */
private const val PIN_MAX_CHARS = 64