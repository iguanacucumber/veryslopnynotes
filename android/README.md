# android/ — client natif Kotlin + Compose

Règle d'or réseau : le téléphone parle à l'établissement en direct
(`android/pronote/`, ADR-003), jamais à un hôte tiers. Plus aucun client HTTP
vers un serveur applicatif (#206 : appairage, lectures et médias sont
device-only) ; le seul hôte choisi à l'exécution est le scraper de manuels
(allowlist `core/ServerConfig`, jamais en dur), pas de WebView distante. Voir
`docs/architecture/INVARIANTS.md` (I1) et `core/ServerConfig`.

Modules : `app/` (Activity + navigation), `core/` (config allowlist),
`data/` (session + dépôts locaux), `ui/` (écrans Compose Material3).

## Serveur facultatif : scraper de manuels

Le serveur n'est pas nécessaire pour Pronote ou l'assistant IA. Il ne sert qu'au
scraper de manuels ; son adresse se configure dans l'app (`data/ServerStore`).
L'adresse de build n'est qu'une valeur par défaut.

## Aide devoirs (clé du fournisseur)

Réglages → « Assistant devoirs » : saisie de la clé, puis « Oublier » pour l'effacer.
Elle est **chiffrée au repos** (`EncryptedSharedPreferences`), jamais affichée ailleurs,
loggée ou mise en URL. L'app l'envoie directement à OpenRouter dans l'en-tête HTTPS
`Authorization` ; la requête ne passe pas par le serveur de manuels.

Onglet Tâches → bouton « Aide devoirs » sur un devoir : les sources sont la consigne et
l'extrait de cours de ce devoir, la réponse est un corrigé sourcé ou un refus motivé. Sans clé,
l'assistant reste inactif (aucun appel). Le serveur de manuels ne reçoit pas cette clé ; elle
reste une credential stockée sur l'appareil.

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

Aucun identifiant n'est saisi ni stocké sur le téléphone (le QR est la
seule preuve de détention). Le QR et son PIN ne quittent pas l'appareil : le
PIN déchiffre `login`+`jeton` en mémoire, au moment de l'appairage, et n'est
ni persisté, ni journalisé.

Le QR se **scanne** (`ui/QrScanner.kt`, `zxing-android-embedded`
4.3.0 : décodeur dans l'APK, permission CAMERA déclarée par l'AAR et demandée par
l'activité de scan, ~20 lignes d'appel, pas d'aperçu à maintenir). Ça marche
donc partout, **y compris sans Google Play Services** — ce que ne faisait pas le
Google Code Scanner de #122, dont le module était téléchargé à la demande par un
service absent (émulateur, téléphone sans GMS) et dont l'échec revenait en `null`
sans rien afficher, donc un bouton qui semblait inerte. Annulation,
permission refusée ou QR illisible → `null` **et une phrase qui dit de
rescanner** ; le scan est verrouillé en portrait (manifeste + `QrScanner.kt`),
comme l'écran qui affiche le QR. Un QR sans `url` est illisible pour l'app
(plus de repli sur une saisie) : `parseSchoolQr` renvoie `null`, même phrase
« rescane ».

L'allowlist est donc `core/ServerConfig.validateBaseUrl` (et `isAllowed` en
préfixe strict), pas une constante de build : `https` obligatoire, `http` uni-
quement pour `10.0.2.2`/`localhost`, hôte IPv4/IPv6-littérale/nom DNS borné,
port 1-65535, et refus de tout identifiant, chemin, query, fragment, espace ou
caractère de contrôle. Elle ne valide plus que l'adresse du scraper de manuels
(#209) : l'app ne parle plus métier à personne. Une déconnexion invalide la
session et purge les caches par le chemin existant `AccountStore.logout()`.

## Config hôte serveur (jamais commité, jamais en dur)

`local.properties` (non commité, modèle ci-dessous) ou env `SERVER_HOST` :

```properties
server.host=10.0.2.2:3000
```

Défaut émulateur `10.0.2.2:3000` (http local). Hors émulateur : HTTPS-only
(`app/build.gradle.kts` force `https` sauf `10.0.2.2`/`localhost`).
`./gradlew installDebug` utilise le défaut sans config ; l'utilisateur peut le
remplacer ensuite depuis l'app.

### Certificat de `make runServer` (« Trust anchor … not found »)

`make runServer` sert en HTTPS avec un certificat **auto-signé**. Depuis
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

```sh
make buildDebugApk
make updateApkToPhone   # construit l'APK debug et l'installe (données conservées)
make buildRelApk   # APK + AAB release, signés (custom si STORE_FILE, sinon debug #297)
```

`make check` compile réellement Kotlin si JDK 17–21 et SDK Android 34 sont
présents ; sinon il signale explicitement le skip. Prérequis, versions,
signature et procédure de release : [`docs/RELEASE.md`](../docs/RELEASE.md).
