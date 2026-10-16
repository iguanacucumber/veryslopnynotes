package fr.veryslopnynotes.ui

import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.PairingInput
import fr.veryslopnynotes.data.PairingRepository
import fr.veryslopnynotes.data.PairingResult
import fr.veryslopnynotes.data.SessionStores
import fr.veryslopnynotes.data.isBoundedSchoolUrl
import fr.veryslopnynotes.data.parseSchoolQr

// Assistant de connexion (#120, repointé #206 : device-only) : l'adresse de
// l'établissement PUIS le QR de l'application Pronote + son PIN. UN SEUL appel
// ouvre la session, et il part du téléphone vers l'établissement — aucun
// serveur intermédiaire (ADR-003). Le PIN déchiffre `login`/`jeton` sur place
// et n'est jamais persisté : seul le jeton tourné dort chiffré (SessionStore).
//
// L'écran est aussi la destination de la session morte (#113) : après un jeton
// tourné ou une session refermée, c'est lui qui rouvre la session locale, pas
// un ancien appairage serveur. Aucun hôte tiers ici : seul `android/pronote/`
// parle réseau (I1).
//
// #145 : la validation VIBRE quand l'appairage réussit (le parcours se termine et
// l'écran disparaît : sans retour physique, rien ne dit que c'est passé), et les
// messages d'erreur passent en COULEUR D'ERREUR — ils étaient en encre de texte,
// exactement comme les messages de succès, donc un refus se lisait comme une
// validation. Ils apparaissent en plus avec l'ouverture mesurée, au lieu
// d'apparaître d'un coup.
@Composable
fun PairingRoute(
    onBack: () -> Unit,
    // #113 : arrivée ici après une session morte. Phrase factuelle
    // (« session refusée »), jamais une cause devinée ni un chrono.
    notice: String? = null,
    // Appairage réussi : l'assistant sort vers l'accueil. L'utilisateur n'a rien
    // à confirmer de plus — sa saisie EST la preuve qu'il est son compte.
    onPaired: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val main = remember { Handler(Looper.getMainLooper()) }
    // UN store pour l'écran : la session y dort chiffrée, les dépôts la
    // relisent au démarrage (restauration sans rescanner).
    val sessions = remember(context) { SessionStores.get(context) }
    val repo = remember(sessions) { PairingRepository(sessions) }
    // #147 : tout l'état de l'assistant est en `rememberSaveable`. AVANT, ZÉRO
    // `rememberSaveable` dans le module : tourner le téléphone en plein
    // appairage effaçait l'adresse tapée, l'erreur affichée et l'ÉTAPE atteinte
    // (retour au premier champ, QR à rescanner).
    var step by rememberSaveable { mutableStateOf(SetupStep.SCHOOL) }
    var form by rememberSaveable(stateSaver = SetupFormSaver) { mutableStateOf(SetupForm()) }
    val haptics = rememberPapHaptics()

    /** Envoi de l'appairage : réseau sur thread, retour sur le main. */
    val submit: (PairingInput) -> Unit = { input ->
        form = form.copy(state = PairingState.Submitting)
        Thread {
            val res = repo.pairBlocking(input, deviceName())
            main.post {
                when (res) {
                    is PairingResult.Ok -> {
                        // #145 : le parcours est terminé et l'écran va quitter —
                        // le retour physique est le seul signal qui reste.
                        haptics.confirm()
                        form = form.copy(state = PairingState.Paired)
                        onPaired()
                    }
                    is PairingResult.Err -> {
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
        // lancement l'assistant EST la route de départ ; après une session
        // morte la pile a été vidée), donc l'étape 2 n'avait aucun chemin de retour.
        //
        // #148 (recette des 14 écrans) : c'était un `Button` REMPLI, donc
        // deux boutons verts de même poids sur l'écran — « Retour » et
        // « Continuer » — et aucun n'était plus l'action principale. Le retour
        // est une action SECONDAIRE : `TextButton` le dit par son encre, et
        // l'image ne change pas.
        val previous = previousStep(step)
        TextButton(
            onClick = { if (previous != null) step = previous else onBack() },
            modifier = Modifier.padding(start = 8.dp, end = 8.dp),
        ) { Text(if (previous != null) "Étape précédente" else "Retour") }
        if (!notice.isNullOrEmpty()) {
            Text(
                text = notice,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        // `heading()` : l'étape en cours est le titre de l'assistant — c'est par
        // elle qu'on sait quoi faire, donc c'est elle que le survol annonce.
        Text(
            text = setupStepLabel(step),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .semantics { heading() },
        )
        when (step) {
            SetupStep.SCHOOL -> SchoolStep(
                form = form,
                onChange = { form = it },
                onNext = { next -> step = next },
            )
            SetupStep.QR -> QrStep(
                form = form,
                onChange = { form = it },
                onSubmit = submit,
            )
        }
    }
}

/** Nom du device transmis à l'établissement (2e tour 2FA). Jamais une donnée personnelle. */
private fun deviceName(): String = Build.MODEL?.takeIf { it.isNotBlank() } ?: "appareil"

/**
 * Étape 1 : l'adresse de l'établissement, et basta. L'app ne saisit PLUS
 * aucun identifiant — la seule preuve de détention est le QR de l'étape 2.
 */
@Composable
private fun SchoolStep(
    form: SetupForm,
    onChange: (SetupForm) -> Unit,
    onNext: (SetupStep) -> Unit,
) {
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("Ton établissement")
        OutlinedTextField(
            value = form.schoolUrl,
            onValueChange = { onChange(form.copy(schoolUrl = it)) },
            label = { Text("Adresse de l'établissement") },
            supportingText = { Text("Exemple : le lycée Louis Payen. Celle de ton espace élève, avec son port si besoin.") },
            singleLine = true,
            // Champ 16 dp (#258) : le rayon du `TextInput` de référence — pas
            // le 8 dp par défaut du champ Material.
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.fillMaxWidth(),
        )
        // #145 : couleur d'erreur + ouverture mesurée.
        PapAppear(visible = error != null) {
            // #146 : l'encre d'ERREUR du thème et trois lignes — le refus vient
            // d'une saisie, donc de longueur connue mais pas forcément courte.
            error?.let {
                Text(
                    text = it,
                    color = errorTextColor(),
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Button(
            onClick = {
                if (!isBoundedSchoolUrl(form.schoolUrl)) {
                    error = "Adresse de l'établissement absente : elle est obligatoire."
                } else {
                    onNext(SetupStep.QR)
                }
            },
            // Bouton 50 dp (#258) : la hauteur du bouton de référence.
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) { Text("Continuer") }
    }
}

/**
 * Étape 2 : le QR affiché par l'application Pronote, scanné avec la caméra.
 * `login` + `jeton` sont des blocs chiffrés dont la clé est le PIN : les deux
 * sont donc nécessaires, et le PIN est celui défini dans Pronote (pas un code
 * à 6 chiffres imposé par l'app).
 */
@Composable
private fun QrStep(
    form: SetupForm,
    onChange: (SetupForm) -> Unit,
    onSubmit: (PairingInput) -> Unit,
) {
    // #147 : l'erreur du scan survit à la rotation, sinon l'utilisateur rescane
    // un QR pour apprendre la même chose.
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val qr = parseSchoolQr(form.qrRaw)
    // #127 : rien de lu (annulé, permission refusée, QR illisible) -> une phrase
    // qui dit quoi faire. Le silence de #122 rendait le bouton « inerte ».
    val scan = rememberQrScanner { scanned ->
        if (scanned != null) {
            error = null
            onChange(form.copy(qrRaw = scanned))
        } else {
            error = "Aucun QR lu (annulé, caméra refusée ou code illisible) : réessaie de le scanner."
        }
    }
    val input = PairingInput(
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
        // le message le dit.
        Button(
            onClick = scan,
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) { Text("Scanner le QR") }
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
            // dans l'arbre. La transformation porte sur l'AFFICHAGE : la saisie
            // et ce qui part dans `PairingInput` sont inchangés.
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.fillMaxWidth(),
        )
        // #145 : les DEUX refus de cette étape (scan, puis appairage) partagent la
        // couleur d'erreur et la même ouverture mesurée.
        PapAppear(visible = error != null || form.state is PairingState.Error) {
            error?.let {
                Text(
                    text = it,
                    color = errorTextColor(),
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (form.state is PairingState.Error) {
                // `errorTextColor()` : l'encre d'erreur lisible dans les deux
                // thèmes, trois lignes (le refus vient de l'établissement).
                Text(
                    text = pairingStateLabel(form.state),
                    color = errorTextColor(),
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        // QR + PIN = la méthode UNIQUE. Un des deux seul -> refus local,
        // message actionnable, aucun appel réseau.
        val pret = qr != null && form.pin.isNotBlank()
        if (pret) {
            Button(
                onClick = { onSubmit(input) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text(if (busy) "Connexion…" else "Terminer") }
        } else {
            Text(
                when {
                    qr == null && form.pin.isNotBlank() -> "QR illisible : rescane-le."
                    qr != null -> "Code PIN du QR obligatoire : il déchiffre le contenu scanné."
                    else -> "Il faut le QR affiché par ton application + son PIN."
                },
            )
        }
        // #208 : plus de diagnostic SSE — sans serveur il n'y a plus de flux
        // serveur→app, donc plus d'état de connexion à replier ici. Le sync
        // de fond est passé à WorkManager (PeriodicSyncWorker).
    }
}

/** Miroir de PIN_MAX_CHARS (PairingRepository) : l'écran borne la saisie, pas la sécurité. */
private const val PIN_MAX_CHARS = 64
