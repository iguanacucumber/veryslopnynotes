# android/ — client natif from scratch (phase 4, issue #13)

Règle d'or réseau : aucun hôte tiers ici. Un seul hôte serveur allowlist
(jamais en dur), un seul OkHttp (`data/ApiClient`), médias via proxy serveur,
pas de WebView distante. Voir `docs/architecture/INVARIANTS.md` (I1) et
`core/ServerConfig`.

Modules : `app/` (Activity + navigation), `core/` (config allowlist),
`data/` (client HTTP unique), `ui/` (écrans Compose Material3).

## Serveur : choisi à l'exécution, le build fournit le défaut

L'adresse est saisie à l'étape 1 de l'**assistant de connexion** (on ne peut pas
se connecter sans connaitre son serveur) et persistée par `data/ServerStore`. La
valeur `BuildConfig` ci-dessous n'est plus qu'une **graine** : elle sert quand
rien n'est choisi.

## Aide devoirs (clé du fournisseur)

Réglages → « Assistant devoirs » : saisie de la clé, puis « Oublier » pour l'effacer.
Elle est **chiffrée au repos** (`EncryptedSharedPreferences`), relue à chaque requête, jamais
affichée ailleurs, jamais loggée, jamais mise en URL. Elle part dans le **corps** de
`POST /v1/homework/generate` (`apiKey`), donc dans les logs du serveur non plus.

Onglet Tâches → bouton « Aide devoirs » sur un devoir : les sources sont la consigne et
l'extrait de cours de ce devoir, la réponse est un corrigé sourcé ou un refus motivé. Sans clé,
l'assistant reste inactif (aucun appel). Le serveur ne détient aucune clé : c'est une
credential d'app, comme le bearer d'appareil.

## Assistant de connexion (3 étapes, un seul appel)

Lancement → **1. ton serveur** (validé, puis `GET /v1/health` : sa version de
contrat s'affiche) → **2. ton établissement** (son adresse élève) → **3. le QR de
l'application de l'établissement** (contenu `login`+`jeton` + son PIN, scanné ou
collé). Un seul `POST /v1/setup` ouvre la session ET rend le jeton d'appareil,
stocké chiffré. Sans jeton appairé, le démarrage ouvre l'assistant au lieu de
l'accueil ; après un 401 ou un redémarrage du serveur, c'est lui qui rouvre la
session **et** le credential.

Aucun identifiant n'est saisi ni stocké sur le téléphone (0.7.0 : le QR est la
seule preuve de détention). Le QR et son PIN partent dans le POST ; le serveur ne
les garde qu'en mémoire, pour renouveler la session, et ne les journalise jamais.

Le QR de l'étape 3 se **scanne** (`ui/QrScanner.kt`, Google Code Scanner :
module Play Services téléchargé à la demande, **aucune permission CAMERA** dans
le manifeste, ~15 lignes d'appel). Annulation, refus ou téléphone sans Play
Services → `null`, et le champ de collage reste le chemin de secours.

L'allowlist est donc `core/ServerConfig.validateBaseUrl` (et `isAllowed` en
préfixe strict), pas une constante de build : `https` obligatoire, `http` uni-
quement pour `10.0.2.2`/`localhost`, hôte IPv4/IPv6-littérale/nom DNS borné,
port 1-65535, et refus de tout identifiant, chemin, query, fragment, espace ou
caractère de contrôle. Un changement de serveur invalide la session et purge
les caches par le chemin existant `AccountStore.logout()` (le jeton d'appareil
est un bearer pour l'ancien serveur), AVANT d'utiliser la nouvelle adresse.

## Config hôte serveur (jamais commité, jamais en dur)

`local.properties` (non commité, modèle ci-dessous) ou env `SERVER_HOST` :

```properties
server.host=10.0.2.2:3000
```

Défaut émulateur `10.0.2.2:3000` (http local). Hors émulateur : HTTPS-only
(`app/build.gradle.kts` force `https` sauf `10.0.2.2`/`localhost`).
`./gradlew installDebug` utilise le défaut sans config ; l'utilisateur peut le
remplacer ensuite depuis l'app.

## Build debug (SDK requis, pas de réseau tiers)

```sh
cd android
./gradlew assembleDebug
```

### Ce que `make check` compile vraiment

`make check` finit par `make android-compile` : Gradle compile les quatre modules
(`:core :data :ui :app`). C'est le **seul** filet qui voit une résolution de
symbole, un import manquant ou une surcharge ambiguë — les miroirs TypeScript et
`check-kotlin.ts` ne les voient pas (piège réel : `MAX_LABEL_CHARS` non qualifié
dans `core/Homework.kt`, invisible côté TS).

Prérequis, une fois par machine :

- **JDK 17 à 21** — Gradle 8.7 *refuse* un JDK supérieur (échec opaque). Un JDK 17
 'Adoptium suffit ; `ANDROID_JDK_HOME` ou `~/.cache/jdk17` sontrovés automatiquement.
- **SDK Android** (`platforms;android-34`, `build-tools;34.0.0`) : pointé par
  `ANDROID_HOME` ou par `sdk.dir` de `android/local.properties` (gitignoré).

```sh
sdkmanager "platforms;android-34" "build-tools;34.0.0" platform-tools
```

Si l'un des deux manque, la cible **SKIP bruyamment** et le dit : « compile Kotlin
NON vérifiée ». Un skip n'est jamais un faux vert — seul `check-kotlin`
(structurel) a tourné, et il le précise.

Versions figées (ADR-001) : Gradle 8.7, AGP 8.5.2, Kotlin 1.9.24,
compileSdk/targetSdk 34, minSdk 26, Compose BOM 2024.06.00, OkHttp 4.12.0.
Zéro dépendance ajoutée au-delà de la stack (Compose Material3 +
navigation-compose + OkHttp + core-ktx/activity, licences Apache-2.0).

## Release signée (issue #32, clé hors repo)

Voir `docs/RELEASE.md` (procédure complète) :

```sh
cd android
./gradlew assembleRelease   # signé si STORE_FILE (+ mots de passe/alias) présent, sinon non signé
```

Keystore généré une fois hors repo (`keytool -genkeypair ...`), config via
`~/.gradle/gradle.properties` (`release.storeFile/storePassword/keyAlias/
keyPassword`) ou env `STORE_FILE/STORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD`.
Jamais commité (`.gitignore` `*.keystore/*.jks`, APK `*.apk` ignoré).
Vérifier : `jarsigner -verify`, `check-secrets` OK.

## Renvoyé phases suivantes (hors scope #13)

- #14 offline : cache Room + affichage sans réseau.
- Persistance serveur (SQLite) : aujourd'hui un redémarrage fait refaire le setup.
- Phase 10 : pinning cert (reste hors scope, release #32 faite).

