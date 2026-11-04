# android/ — client natif Kotlin + frontend React en WebView

Règle d'or réseau : le téléphone parle à l'établissement en direct
(`android/pronote/`, ADR-003), jamais à un hôte tiers. Plus aucun client HTTP
vers un serveur applicatif (#206 : appairage, lectures et médias sont
device-only) ; le seul hôte choisi à l'exécution est le scraper de manuels
(allowlist `core/ServerConfig`, jamais en dur), pas de WebView distante. Voir
`docs/architecture/INVARIANTS.md` (I1) et `core/ServerConfig`.

Modules : `app/` (Activity, WebView + pont natif), `core/` (config allowlist +
logique pure), `data/` (session + dépôts locaux), `pronote/` (client direct).
L'interface est l'app React de `web/`, construite par Vite dans
`app/src/main/assets/web/` et servie par la WebView (ADR-004). Aucun module
Compose : `android/ui/` est supprimé.

## Retour matériel

Décidé côté JS (`web/src/ui/BackNavigation.tsx`, pur : `web/src/lib/back.ts`) :
dialogue du dessus, puis route (`meta.back` en repli), sortie à l'accueil
seulement. Le natif appelle `window.__vsnBack()` ; callback désactivé à
l'accueil (`enableOnBackInvokedCallback`), donc retour prédictif système.

Appareil (API 33+) : `make updateApkToPhone`, puis retour sur un dialogue
(fermé), sur une sous-route (recule), à l'accueil (sortie animée).

## Mort du rendu WebView (#866)

Le rendu WebView est un processus séparé qu'Android peut tuer. La vue morte ne
se réutilise jamais : `onRenderProcessGone` (`WebApp.kt`) la détruit
(`removeView` + `destroy`, callback retiré) et rend `true`. La session et le
pont restent intacts. L'écran « L'interface s'est arrêtée. » propose
« Réessayer », qui monte une coquille NEUVE sur la dernière route ; aucun
rechargement automatique, donc aucune boucle. Callback disponible depuis
l'API 26 = `minSdk` : pas de repli mort à coder.

Preuve « kill simulé » (émulateur) :

```sh
adb root
adb shell ps -A | grep -i sandboxed_process
adb shell kill -9 <pid_du_sandboxed_process>
adb logcat -d | grep -E "FATAL|AndroidRuntime"   # vide
```

Le retry recharge la route et un écran de données répond sans réappairer ;
répéter le kill ne boucle pas.

## Écran protégé (récents, captures)

En release, `FLAG_SECURE` est posé sur la fenêtre entière : récents, `adb
screencap` et enregistrements d'écran sont vides. Toutes les routes servies
portent une donnée scolaire, la clé LLM ou l'appairage : aucune liste d'écrans à
maintenir.

Le build debug est exempté (`SecureWindow.secureWindowRequired`) : `make shot`
et le débogage WebView en ont besoin, au prix d'un aperçu des récents visible.

Limites : pas de verrou propre (appareil déverrouillé = lecture), ni root/OS
compromis. Les exports et téléchargements restent des fichiers lisibles.

## Serveur facultatif : scraper de manuels

Le serveur n'est pas nécessaire pour Pronote ou l'assistant IA. Il ne sert qu'au
scraper de manuels ; son adresse se configure dans l'app (`data/ServerStore`).
L'adresse de build n'est qu'une valeur par défaut.

L'app demande **une seule fois** l'adresse du manuel de l'élève
(`data/Manuals.kt`). Le champ part VIDE : l'élève saisit une adresse qu'il a le
droit d'utiliser et coche l'attestation avant l'enregistrement. Si l'adresse
est un catalogue, `core/ManualCatalog.kt` devine la classe depuis le profil
(`classLabel`) et les spécialités depuis les matières présentes dans les caches,
puis choisit l'ouvrage de la matière du devoir. Une
matière absente de la table ne produit aucune source — jamais un manuel d'une
autre matière. Le texte récupéré est une donnée externe, marquée Untrusted
avant le prompt, comme le cours et la consigne.

## Aide devoirs (clé du fournisseur)

Réglages → « Assistant » : attestation d'âge ou d'autorisation parentale,
consentement, puis saisie de la clé ; « Oublier » pour l'effacer. Retirer le
consentement efface aussi clé et fil du professeur.
Elle est **chiffrée au repos** (`EncryptedSharedPreferences`), jamais affichée ailleurs,
loggée ou mise en URL. L'app l'envoie directement à OpenRouter dans l'en-tête HTTPS
`Authorization` ; la requête ne passe pas par le serveur de manuels.

Onglet Tâches → bouton « Aide devoirs » sur un devoir : les sources sont la consigne,
TOUS les cours rattachés (matière + jour) dans leur borne de payload, les pièces
jointes lisibles et, s'il est enregistré, un extrait du manuel. La réponse est un
corrigé sourcé ou un refus motivé. Sans clé, l'assistant reste inactif (aucun
appel). Le serveur de manuels ne reçoit pas cette clé ; elle reste une credential
stockée sur l'appareil.

Les pièces jointes (#631) sont téléchargées avec le client local (jamais une URL
d'établissement côté web), bornées (taille, nombre), mises en cache dans
`cacheDir/attachments/` (borné, purgé avec le compte) puis extraites **sur
l'appareil** : texte/markdown/HTML désinfecté, PDF texte, image par le chemin
vision existant. Un format non lisible devient une source nommée « illisible »
avec sa raison — l'OCR d'un PDF scanné n'est pas disponible et le dit. Tout le
texte reste une donnée externe (Untrusted) : aucun HTML n'est rendu.

## Assistant de connexion (une page, device-only, #206/#299)

Lancement → **le QR de l'application de l'établissement** (contenu
`login`+`jeton`+`url` + son PIN, scanné avec la caméra). Le QR porte l'adresse
de l'établissement : **rien n'est saisi à l'écran** (l'ancienne étape « adresse
de l'établissement » est supprimée, #299), et le téléphone ouvre la session en
direct (`Client.qrcodeLogin`, ADR-003) : aucun serveur intermédiaire. Le PIN
déchiffre le QR sur place et n'est jamais persisté ; seul le jeton tourné dort
chiffré (`SessionStore`). Sans session persistée, le démarrage ouvre l'assistant
au lieu de l'accueil ; après une session morte (jeton tourné, session refermée),
c'est lui qui rouvre la session locale.

La page **défile** : en paysage (rotation verrouillée), la colonne
débordait et l'action principale tombait hors de l'écran. Ouvrir le scan ne
détruit plus l'assistant non plus : zxing déclare son activité
`clearTaskOnLaunch`, ce qui relançait `MainActivity` à zéro au retour du scan —
l'appartenance `android:clearTaskOnLaunch="false"` + `tools:replace` dans
`app/src/main/AndroidManifest.xml` annule ce drapeau (vérifié sur l'appareil).

Aucun identifiant de connexion n'est saisi : le QR est la seule preuve de
détention. L'identifiant de compte publié par l'établissement est conservé
localement pour la liste des comptes (voir la carte des données). Le QR et son
PIN ne quittent pas l'appareil : le PIN déchiffre `login`+`jeton` en mémoire,
au moment de l'appairage, et n'est ni persisté, ni journalisé.

Le QR se **scanne** (`app/VsnBridge.kt` via `ScanContract`,
`zxing-android-embedded` 4.3.0 : décodeur dans l'APK, permission CAMERA déclarée
par l'AAR et demandée par l'activité de scan, ~20 lignes d'appel, pas d'aperçu à
maintenir). Ça marche
donc partout, **y compris sans Google Play Services** — ce que ne faisait pas le
Google Code Scanner de #122, dont le module était téléchargé à la demande par un
service absent (émulateur, téléphone sans GMS) et dont l'échec revenait en `null`
sans rien afficher, donc un bouton qui semblait inerte. Annulation,
permission refusée ou QR illisible → `null` **et une phrase qui dit de
rescanner** ; le scan est verrouillé en portrait (manifeste + activité de scan),
comme l'écran qui affiche le QR. Un QR sans `url` est illisible pour l'app
(plus de repli sur une saisie) : `parseSchoolQr` renvoie `null`, même phrase
« rescane ».

L'allowlist est donc `core/ServerConfig.validateBaseUrl` (et `isAllowed` en
préfixe strict), pas une constante de build : `https` obligatoire ; le clair
(`http`) n'est accepté qu'en build debug et pour `10.0.2.2`, `localhost`,
`127.0.0.0/8` ou `[::1]` (`CleartextPolicy.LOOPBACK_ONLY`), la release refusant
tout clair (`CleartextPolicy.FORBID`, défaut). Hôte IPv4/IPv6-littérale/nom DNS
borné, port 1-65535, et refus de tout identifiant, chemin, query, fragment,
espace ou caractère de contrôle. Elle ne valide plus que l'adresse du scraper de
manuels (#209) : l'app ne parle plus métier à personne. Une déconnexion invalide
la session et purge les caches par le chemin existant `PairingRepository.logoutBlocking()`.

### Autorisation réseau local (Android 17+)

`ACCESS_LOCAL_NETWORK` est demandée seulement à l'enregistrement d'une adresse
LAN (`ServerConfig.isLocalNetworkUrl`), après une rationale. Un refus ou une
annulation n'écrit rien et indique Réglages Android > Applications >
VerySlopyNyNotes > Autorisations. Boucle locale, émulateur et HTTPS public ne
demandent rien. Test appareil API 37 : Réglages → Appareil, saisir
`https://192.168.1.10:3000`, refuser puis accepter ; test source
`tests/web/settings-server-permission`.
## Config hôte serveur (jamais commité, jamais en dur)

`local.properties` (non commité, modèle ci-dessous) ou env `SERVER_HOST` :

```properties
server.host=10.0.2.2:3000
```

Défaut émulateur `10.0.2.2:3000` (http local) **en debug seulement** : la
release part avec une graine vide et HTTPS obligatoire (`app/build.gradle.kts`).
`./gradlew installDebug` utilise le défaut sans config ; l'utilisateur peut le
remplacer ensuite depuis l'app. Le clair n'est autorisé que par le
`network_security_config` de `src/debug` ; l'APK publiable l'interdit partout.

### Certificat de `make runServer` (« Trust anchor … not found »)

`make runServer` sert en HTTPS avec un certificat **auto-signé** (généré
seulement si `TLS_CERT_FILE`/`TLS_KEY_FILE` ne sont pas fournis : un couple
fourni est servi tel quel, installez-le sur l'appareil). Depuis
Android 7, une app ne fait pas confiance par défaut aux certificats installés
par l'utilisateur, d'où `CertPathValidatorException: Trust anchor for
certification path not found`. Le correctif est en deux temps :

1. Installer le certificat du serveur sur l'appareil (`~/.cache/veryslopnynotes/tls/cert.pem`) :

   ```sh
   adb push ~/.cache/veryslopnynotes/tls/cert.pem /sdcard/vsn.crt
   adb shell am start -a android.credentials.INSTALL \
     -t application/x-x509-ca-cert -d file:///sdcard/vsn.crt
   ```

   Sur téléphone : `Paramètres > Sécurité > Chiffrement et identifiants >
   Installer un certificat > Certificat CA`. Il est déclaré `CA:TRUE`, sinon
   l'écran d'installation le refuse.

2. Utiliser l'APK **debug** : `app/src/debug/res/xml/network_security_config.xml`
   ajoute `<certificates src="user" />` aux ancres. Ce fichier n'existe qu'en
   debug — la release garde la config stricte d'`src/main` (ancres plateforme
   seules) et ne peut donc pas joindre un certificat auto-signé. Pour la
   release, fournissez un certificat émis (`TLS_CERT_FILE`/`TLS_KEY_FILE`,
   mkcert ou une autorité).

Le nom saisi doit rester couvert par le SAN du certificat
(`localhost`, `veryslopnynotes.local`, `127.0.0.1`, `10.0.2.2`, IP LAN) :
sinon l'erreur suivante est un `HostnameVerifier`, pas une erreur d'ancre.

## Build

L'interface est construite par Bun/Vite **avant** Gradle : `preBuild` dépend de
la tâche `buildWebUi` (`bun run build:web`), qui écrit dans
`app/src/main/assets/web/` (gitignoré). Un build APK sans `bun` échoue donc
bruyamment plutôt que d'embarquer une UI absente.

```sh
bun run build:web   # optionnel : build seul de l'interface
make buildDebugApk
make updateApkToPhone   # construit l'APK debug et l'installe (données conservées)
make buildRelApk   # APK + AAB release, signés (custom si STORE_FILE, sinon debug #297)
```

`make check` compile réellement Kotlin si JDK 17–21 et SDK Android 37 sont
présents ; sinon il signale explicitement le skip. Prérequis, versions,
signature et procédure de release : [`docs/RELEASE.md`](../docs/RELEASE.md).
