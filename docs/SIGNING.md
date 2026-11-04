# Clé de signature Android : cycle de vie

Ce document est la procédure de la clé de signature release. Il complète
[`RELEASE.md`](RELEASE.md), qui garde les commandes de build et de publication.
La clé, ses mots de passe et ses sauvegardes ne quittent jamais le poste hors
ligne : aucun secret dans le dépôt, un log, un artefact ou une issue.

Les valeurs entre chevrons (`<…>`) sont des **placeholders**. Aucune empreinte,
aucun nom de détenteur et aucun secret réel n'est commité ici. Le détenteur, les
lieux de sauvegarde et le coffre à mots de passe relèvent de DEC-03 (#828) :
tant que cette décision humaine n'est pas tranchée, remplacer les placeholders
sans inventer de valeur.

## Identité et conséquences

L'`applicationId` est `fr.veryslopnynotes.app`. Android identifie une mise à
jour par le certificat qui signe l'APK, pas par le numéro de version :

- même certificat ⇒ `adb install -r` et le sideload mettent à jour l'app en
  conservant ses données ;
- certificat différent ⇒ `INSTALL_FAILED_UPDATE_INCOMPATIBLE` ; il faut
  désinstaller, ce qui **efface session Pronote, cache, clé OpenRouter,
  conversations, pièces jointes et préférences** ;
- clé debug (`CN=Android Debug`, générée par le SDK dans
  `~/.android/debug.keystore`) ≠ clé release : un APK debug ne peut jamais
  devenir un APK release sans désinstallation. Inversement, un build release
  sans `STORE_FILE` retombe sur la signature debug (repli #297) : il s'installe
  en sideload mais ne peut pas recevoir les mises à jour de la vraie release.

La release publiée est signée par la clé de l'environnement GitHub `release`.
`release-artifact.yml` utilise une clé éphémère pour prouver que le build
compile et n'est pas signé debug ; cette clé ne sert jamais à publier.

## Génération (une fois)

Générer sur une machine hors ligne, hors du dépôt, avec le JDK 17–21 déjà requis
par le build Android. Le fichier est ignoré par git (`*.keystore`, `*.jks`) :

```sh
install -d -m 700 ~/.keystore
keytool -genkeypair \
  -keystore ~/.keystore/vsn-release.jks \
  -storetype PKCS12 \
  -alias vsn \
  -keyalg RSA -keysize 2048 -validity 9125
```

Paramètres à retenir :

| Paramètre | Valeur | Pourquoi |
|---|---|---|
| Type de store | `PKCS12` | format attendu par `release.yml` et `keytool` récent |
| Alias | `vsn` | doit égaler le secret `RELEASE_KEY_ALIAS` |
| Algorithme / taille | `RSA` / `2048` | compatible Android 8+ et `apksigner` |
| Validité | `9125` jours (25 ans) | une clé expirée ne peut plus signer de mise à jour |
| Fichier | hors dépôt, permissions `600` | jamais commité, jamais dans un artefact |

`keytool` demande interactivement le mot de passe, le DN et la confirmation. Ne
pas passer le mot de passe en argument (`-storepass`, `-keypass`) : il resterait
dans l'historique du shell et la liste des processus. Réponses attendues :

- **DN** : `CN=Very Slop Notes release, O=<détenteur DEC-03>, C=FR` — le nom du
  détenteur est un placeholder, jamais un nom inventé ;
- **mot de passe** : long et aléatoire (`openssl rand -base64 48`), conservé
  dans le coffre hors ligne, jamais dans un fichier à côté du keystore.

PKCS12 utilise par défaut le même mot de passe pour le store et la clé. Les deux
secrets GitHub restent distincts (`RELEASE_STORE_PASSWORD` et
`RELEASE_KEY_PASSWORD`) pour permettre une clé protégée différemment, mais ils
portent la même valeur avec ce format.

Vérifier immédiatement que la clé est lisible et noter son empreinte :

```sh
keytool -list -v -keystore ~/.keystore/vsn-release.jks -alias vsn
```

## Custody et sauvegarde

Le keystore est un secret **d'identité** : le perdre interdit toute mise à jour
des installations existantes ; le divulguer permet de signer un faux APK.

- Deux copies chiffrées hors ligne, sur deux supports distincts, dans deux lieux
  physiques distincts (références exactes : `<lieu A>`, `<lieu B>`, DEC-03).
- Le mot de passe vit dans un coffre à mots de passe ou une enveloppe scellée
  **séparé** des supports : une copie seule ne doit pas suffire.
- Tester la restauration au moins une fois par an : déchiffrer une copie,
  `keytool -list` sur le keystore restauré, comparer l'empreinte.
- Un seul détenteur nommé et un remplaçant documentés (DEC-03 / #828). Ne pas
  inscrire ces noms dans le dépôt public : le registre de custody est
  `<registre privé DEC-03>`.
- Ne jamais stocker le keystore dans le cloud non chiffré, un gestionnaire de
  mots de passe en pièce jointe, un artifact CI, une image Docker ou un backup
  de téléphone.
- Seules les métadonnées non sensibles (alias, date, empreinte publiée,
  référence de custody) peuvent figurer dans ce document.

## Secrets GitHub de l'environnement `release`

L'environnement `release` exige une approbation et n'autorise que les tags
`v*` ([`BRANCH-PROTECTION.md`](BRANCH-PROTECTION.md)). Les quatre secrets sont
lus par `.github/workflows/release.yml` ; un seul vide fait échouer le job avant
signature et publication, sans repli debug :

| Secret | Contenu |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | keystore PKCS12 encodé base64, sans retour à la ligne |
| `RELEASE_STORE_PASSWORD` | mot de passe du store |
| `RELEASE_KEY_ALIAS` | `vsn` |
| `RELEASE_KEY_PASSWORD` | mot de passe de la clé |

Les créer sans recopier les valeurs dans un terminal partagé :

```sh
base64 -w0 ~/.keystore/vsn-release.jks | gh secret set RELEASE_KEYSTORE_BASE64 --env release
gh secret set RELEASE_STORE_PASSWORD --env release   # saisie interactive masquée
gh secret set RELEASE_KEY_PASSWORD --env release     # saisie interactive masquée
gh secret set RELEASE_KEY_ALIAS --env release --body vsn
gh secret list --env release                         # noms et dates, jamais les valeurs
```

Sur macOS, `base64 -w0` n'existe pas : utiliser
`openssl base64 -A -in ~/.keystore/vsn-release.jks`. Ne jamais coller un secret
dans une issue, une PR, un commentaire de commit ou une capture. Le workflow
masque les valeurs (`::add-mask::`) et décode le keystore dans `RUNNER_TEMP`,
hors du workspace, puis l'efface même en cas d'échec.

Toute exposition d'un de ces secrets impose la rotation de la clé (section
« Compromission »), pas seulement la recréation du secret.

## Empreinte publiée

L'empreinte de confiance est le SHA-256 du certificat de la clé release, pas le
SHA-256 de l'APK. La calculer depuis le keystore :

```sh
keytool -list -v -keystore ~/.keystore/vsn-release.jks -alias vsn \
  | sed -n 's/^[[:space:]]*SHA256: //p'
```

Normaliser pour comparer (le workflow fait la même normalisation) :

```sh
tr -d ':' | tr '[:upper:]' '[:lower:]'
```

Publication : à la première release, puis à chaque rotation, reporter
l'empreinte normalisée dans la note GitHub Release et dans le tableau
ci-dessous, dans la même PR que la mise à jour de la release. Ne pas la déduire
d'un APK tiers.

| Certificat release | Empreinte SHA-256 |
|---|---|
| `<première release>` | `<empreinte SHA-256 du certificat release>` |
| `<rotation>` | `<nouvelle empreinte>` |

Le SHA-256 de chaque fichier reste publié séparément dans `SHA256SUMS` par
`release.yml`. Vérifier les deux : l'empreinte du certificat prouve l'identité
du signataire, `SHA256SUMS` prouve l'intégrité du téléchargement.

## Vérifier un APK

`apksigner` vient des Build-Tools du SDK Android (`build-tools;36.0.0`) :

```sh
apksigner verify --print-certs veryslopnynotes-<version>.apk
```

Lire `Signer #1 certificate SHA-256 digest` et le comparer à l'empreinte
publiée après normalisation. Refuser l'APK si :

- le certificat porte `CN=Android Debug` (build debug ou repli sans clé) ;
- l'empreinte diffère de la valeur publiée, même d'un caractère ;
- `sha256sum -c SHA256SUMS` échoue sur un fichier téléchargé.

Vérification locale avant publication, sur l'APK construit par
`make buildRelApk` :

```sh
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

## Commandes de release

Build local signé, sans écrire les mots de passe dans l'historique :

```sh
export STORE_FILE="$HOME/.keystore/vsn-release.jks"
export KEY_ALIAS=vsn
read -rsp 'Mot de passe store : ' STORE_PASSWORD; export STORE_PASSWORD
read -rsp 'Mot de passe clé : ' KEY_PASSWORD; export KEY_PASSWORD
make buildRelApk
unset STORE_PASSWORD KEY_PASSWORD
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

Publication sur tag (le tag doit pointer sur le commit de `main` qui contient
la section `## [x.y.z]` du CHANGELOG) :

```sh
git switch main
git pull --ff-only
git tag -a vX.Y.Z -m "Very Slop Notes X.Y.Z"
git push origin vX.Y.Z
```

Le job `publish` attend l'approbation de l'environnement `release`. Il re-signe
l'APK avec la clé de l'environnement, refuse un certificat debug, compare le
certificat à celui du keystore, écrit `SHA256SUMS`, puis publie la GitHub
Release. Un tag déplacé, une version incohérente ou un secret vide échoue avant
publication.

Dry-run, sans publier de release :

```sh
gh workflow run release.yml --ref vX.Y.Z
```

Vérifier ensuite l'artefact publié, comme un utilisateur :

```sh
gh release download vX.Y.Z --dir /tmp/vsn-release
cd /tmp/vsn-release
sha256sum -c SHA256SUMS
apksigner verify --print-certs veryslopnynotes-X.Y.Z.apk
```

## Rotation

**Sideload (état actuel).** Il n'existe ni Play App Signing ni révocation de
certificat : une nouvelle clé est une **nouvelle identité**. Les installations
existantes ne peuvent pas être mises à jour, seulement désinstallées puis
réinstallées, avec perte des données locales. Procédure :

1. Générer la nouvelle clé hors ligne (section « Génération »), avec un
   nouveau nom de fichier et un nouvel alias si l'ancien keystore est conservé.
2. Mettre à jour les quatre secrets de l'environnement `release`.
3. Publier la nouvelle empreinte et prévenir explicitement : désinstallation,
   perte des données, export préalable depuis les réglages.
4. Incrémenter `versionCode` par le tag (`vX.Y.Z`) et publier la release.
5. Conserver l'ancienne clé et son empreinte tant que des utilisateurs peuvent
   encore installer une version signée avec elle ; ne jamais réutiliser
   l'ancienne pour une nouvelle version.

**Play App Signing (si le canal Play est ouvert un jour).** La clé de
distribution est alors détenue par Google : la rotation se demande dans Play
Console (« rotation de la clé de signature » pour la clé de distribution,
« réinitialisation de la clé d'upload » pour la clé locale). Une rotation de la
clé d'upload ne change pas l'identité vue par les utilisateurs ; une rotation
de la clé de distribution exige la procédure Play et une période de
compatibilité. Aucune des deux ne s'applique au sideload actuel.

**Clé debug.** Elle n'est pas sauvegardée et n'a aucune valeur de release. La
supprimer (`~/.android/debug.keystore`) casse les mises à jour des builds debug
et recrée une identité debug ; cela ne touche jamais la clé release.

## Compromission et révocation

En sideload, il n'existe **aucune révocation** : un APK déjà installé continue
de faire confiance à l'ancien certificat. Retirer un fichier de la page Release
n'efface ni les copies téléchargées ni la confiance déjà accordée. La seule
correction est une nouvelle identité signée avec une nouvelle clé.

1. **Arrêter** toute signature et publication avec la clé suspecte ; retirer
   les secrets de l'environnement `release` ou les remplacer immédiatement.
2. **Qualifier** la fuite : keystore, mot de passe, base64 du secret, accès au
   runner ou au poste. Un keystore sans mot de passe reste sensible : traiter
   toute exposition comme une compromission de la clé.
3. **Retirer** l'APK compromis de la page Release et marquer la release
   « retirée » avec le motif, sans supprimer l'historique du tag.
4. **Générer** une nouvelle clé hors ligne, remplacer les quatre secrets,
   publier la nouvelle empreinte et un avis (advisory privé tant que la faille
   est exploitable, puis avis public) : versions touchées, ancienne et nouvelle
   empreinte, obligation de désinstaller, perte de données.
5. **Republier** avec un `versionCode` supérieur et une section CHANGELOG ; ne
   jamais re-signer l'ancien APK avec la nouvelle clé comme s'il s'agissait
   d'une mise à jour.
6. **Consigner** l'incident et la rotation dans une issue `incident`, puis
   relire [`INCIDENTS.md`](INCIDENTS.md) et [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md)
   (signal S5 : certificat différent de la publication = retrait immédiat).
7. Si le keystore peut avoir été copié, considérer aussi les sauvegardes comme
   compromises : remplacer les deux copies et le coffre, pas seulement la copie
   active.

## Check-list mainteneur

Avant la première release :

- [ ] Détenteur, remplaçant, deux lieux de sauvegarde et coffre nommés dans le
      registre privé DEC-03 (#828) ; placeholders de ce document remplacés.
- [ ] Keystore PKCS12 généré hors ligne, alias `vsn`, permissions `600`,
      sauvegardé deux fois, restauration testée.
- [ ] Mots de passe dans le coffre, séparés des sauvegardes.
- [ ] Quatre secrets présents dans l'environnement `release`
      (`gh secret list --env release`).
- [ ] Empreinte SHA-256 du certificat calculée et publiée (note de release et
      tableau ci-dessus), sans jamais publier la clé.
- [ ] `make buildRelApk` local puis `apksigner verify --print-certs` : certificat
      release attendu, jamais `CN=Android Debug`.
- [ ] `git status` propre : aucun `*.jks`, `*.keystore`, `.env*` ni APK.

À chaque release :

- [ ] CHANGELOG renommé, `versionCode` cohérent avec le tag, `main` à jour.
- [ ] Environnement `release` approuvé par le détenteur ; secrets inchangés ou
      rotation tracée.
- [ ] Tag `vX.Y.Z` poussé sur le bon commit ; workflow vert jusqu'à la
      publication.
- [ ] `sha256sum -c SHA256SUMS` et `apksigner verify --print-certs` réussis sur
      l'APK téléchargé depuis la Release.
- [ ] Empreinte publiée identique à celle du keystore ; sinon retrait immédiat
      et incident S5.
