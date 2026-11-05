# Checklist de publication

Cette checklist est la **preuve de release**. Une case non cochée, une preuve
absente ou une signature vide bloque le tag. Les commandes sont celles du
dépôt ; les workflows, scripts et documents cités font foi.

La copie remplie et signée est jointe à l'issue de release (ou à la PR de
release). Ce fichier reste le modèle versionné, avec ses champs vides. Ne jamais
inventer une preuve, une empreinte, un nom ou une date : « OK » seul ne prouve
rien, et un agent ne signe pas à la place d'un humain.

## Identité de la release

| Champ | Valeur |
|---|---|
| Version (`versionName`) | `<X.Y.Z>` |
| Code (`versionCode`) | `<sortie de android-version.ts>` |
| Tag | `<vX.Y.Z>` |
| Commit (`git rev-parse HEAD`) | `<sha>` |
| Canal | `<finale ou bêta>` |
| Responsable de release | `<nom>` |
| Approbateur | `<nom>` |

## Ne pas livrer si

- Une case de cette checklist reste ouverte, ou une preuve manque.
- `make check` n'est pas vert sur le commit exact qui sera taggé, ou la
  compilation Kotlin a été sautée (`ALLOW_SKIP_ANDROID=1`).
- Un job CI du commit (`check`, `web-smoke`, `gitleaks`, `release-artifact`,
  `licenses`, `apk-size`) est rouge.
- Le tag ne pointe pas le commit vérifié, plusieurs tags de version pointent
  `HEAD`, ou la version calculée diffère du tag.
- L'APK porte `CN=Android Debug`, l'empreinte du certificat diffère de celle du
  keystore ou de la valeur publiée, ou `sha256sum -c SHA256SUMS` échoue.
- Une licence nouvelle ou inconnue apparaît, une notice manque, ou les versions
  de `THIRD_PARTY_NOTICES.md` ne suivent plus `bun.lock` et le catalogue Gradle.
- La notice de confidentialité ou la version de consentement IA change sans
  mise à jour de `PRIVACY.md` et de `docs/legal/DATA-MAP.md`, sans note de
  re-consentement, ou sans que les versions TS et Kotlin concordent.
- `CHANGELOG.md` n'a pas de section `## [<version>]`, ou `[Unreleased]` n'a pas
  été recréé vide avant le tag.
- L'offre de source GPL manque : archive du tag, archive jointe ou `LICENSE`
  absent de la page de release.
- Une revue de bêta J+0, J+1, J+3 ou J+7 manque, ou un seuil de pause/retrait
  S1 à S6 de [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) est franchi sans les
  quatre preuves de reprise.
- L'issue `[known-issues] <tag>` n'existe pas, n'est pas épinglée, ou ne porte
  pas le label `bug`.
- Un incident P0/P1 est ouvert, ou un secret, une clé, un `.env*` ou une donnée
  scolaire apparaît dans le dépôt, un log ou un artefact.
- Les signatures humaines de fin de checklist sont absentes. Pour v1.0, la
  signature du responsable de release **et** celle du mainteneur de garde sont
  obligatoires.

## 1. Gate vert

```sh
make check
```

- [ ] Les 9 étapes de `make check` sont vertes sur le commit de `main` qui
      sera taggé : `android-compile` (Kotlin + Android Lint), `unit`,
      `typecheck`, `architecture`, `contracts`, `lint`, `audit`,
      `web-typecheck`, `web-test`.
- [ ] Le commit est sur `main`, le diff de release a été relu, et la CI du
      commit de `main` est verte.
- [ ] Les runs `gate`, `release-artifact`, `licenses` et `apk-size` de ce
      commit sont verts.
- [ ] Aucun `ALLOW_SKIP_ANDROID=1`, `make -i` ni `MAKEFLAGS` n'a servi à
      obtenir ce vert.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<URL du run et du commit>`

## 2. Version

```sh
git tag --points-at HEAD
git tag --list "v<X.Y.Z>*"
bun agents/runtime/android-version.ts
```

- [ ] Le `versionName` et le `versionCode` prévus sont consignés ci-dessus.
- [ ] Aucun tag de la même version n'existe déjà, localement ou sur `origin`.
- [ ] Aucun autre tag de version ne pointe `HEAD`.
- [ ] Une finale a un `versionCode` strictement supérieur à celui de chaque
      bêta publiée ; une bêta utilise le format accepté par
      `agents/runtime/android-version.ts`, jamais un suffixe improvisé.
- [ ] Le numéro de version n'a jamais été publié auparavant.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<sortie des commandes et tags>`

## 3. Build

```sh
make buildRelApk
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

- [ ] `make buildRelApk` produit
      `android/app/build/outputs/apk/release/app-release.apk` avec la clé
      release, selon [`SIGNING.md`](SIGNING.md).
- [ ] Le job `release-artifact` est vert ; l'APK publié sera celui de ce job,
      re-signé par `release.yml`, pas une copie locale.
- [ ] `apk-size` est vert : la taille mesurée reste sous le plafond de
      `apk-size-baseline.json`.
- [ ] L'APK release ne répond à aucun deep link : `adb shell am start -W -a
      android.intent.action.VIEW -c android.intent.category.BROWSABLE -d
      "veryslopnynotes://grades"` échoue, et `DEMO_MODE=false`.
- [ ] Si le serveur est livré avec cette version : `make build` est vert, le
      digest de l'image est épinglé dans `Dockerfile.server` et `/v1/ready`
      répond. Sinon, noter « non applicable » avec la raison.
- [ ] `git status` est propre : aucun `*.apk`, `*.jks`, `*.keystore`, `.env*`
      ni donnée personnelle.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<URL du job release-artifact, taille APK, sortie adb>`

## 4. Licences et notices

```sh
bun run check:licenses
```

- [ ] `bun run check:licenses` rend `check-licenses OK`, et le job CI
      `licenses` est vert sur le commit.
- [ ] `THIRD_PARTY_NOTICES.md` inventorie les dépendances réellement livrées ;
      les versions suivent `bun.lock` et `android/gradle/libs.versions.toml`.
- [ ] Les textes intégraux de `web/public/licenses/` sont présents et voyagent
      dans l'APK (`assets/web/licenses/`), avec la GPL-3.0-only de l'app.
- [ ] Aucune nouvelle licence, aucun composant hors allowlist et aucun outil de
      build (MPL-2.0) n'est distribué dans l'APK.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<sortie check-licenses, URL du run, liste des notices>`

## 5. Confidentialité et consentement

```sh
rg -n "Notice version|AI_CONSENT_VERSION" PRIVACY.md \
  web/src/features/assistant/consent.ts \
  android/core/src/main/java/fr/veryslopnynotes/core/AiConsent.kt
bun test tests/unit/privacy-claims.test.ts
```

- [ ] La version de la notice de `PRIVACY.md` est relevée et reportée dans les
      notes de release.
- [ ] `AI_CONSENT_VERSION` est identique dans le miroir TS et dans
      `AiConsent.kt` ; `tests/unit/privacy-claims.test.ts` est vert.
- [ ] Tout changement matériel de texte ou de périmètre a incrémenté la version
      de consentement dans la même release, avec `PRIVACY.md` et
      `docs/legal/DATA-MAP.md` à jour.
- [ ] Les notes de release disent qu'un accord d'une autre version redemande
      l'accord ; aucun accord antérieur n'est réutilisé.
- [ ] Aucune donnée scolaire, clé LLM ou adresse d'établissement n'est ajoutée
      aux notes, aux captures ou aux artefacts.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<versions notice et consentement, URL du test>`

## 6. CHANGELOG et notes

```sh
rg -n "^## \[" CHANGELOG.md
```

- [ ] `## [Unreleased]` a été renommé en `## [<X.Y.Z>] - <AAAA-MM-JJ>` (ou en
      section bêta acceptée par `release.yml`), puis un `[Unreleased]` vide a
      été recréé.
- [ ] La section est sur `main` avant le tag ; `release.yml` refuse une release
      sans section correspondante.
- [ ] Les notes listent les changements visibles, les ruptures, les limites
      connues et le lien vers l'issue `known-issues`.
- [ ] Les notes ne contiennent ni secret, ni donnée scolaire, ni promesse non
      tenue par cette version.
- [ ] L'empreinte du certificat et les valeurs de `SHA256SUMS` seront ajoutées
      à la note de release après publication (sections 10 et 11).

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<lien de la PR CHANGELOG et de la section>`

## 7. Clé, signature et empreinte

```sh
gh secret list --env release
keytool -list -v -keystore <keystore> -alias <alias>
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

- [ ] Le détenteur unique et, le cas échéant, son remplaçant sont connus
      (décision DEC-03, registre privé), et le keystore reste hors du dépôt.
- [ ] Les quatre secrets `RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`,
      `RELEASE_KEY_ALIAS` et `RELEASE_KEY_PASSWORD` existent dans
      l'environnement `release` ; aucun nom ni valeur n'est publié.
- [ ] Le certificat de l'APK local n'est pas `CN=Android Debug` et son
      empreinte SHA-256, normalisée, est celle du keystore release.
- [ ] L'empreinte attendue est consignée pour publication, sans inventer de
      valeur : première release ou rotation.
- [ ] Aucun mot de passe, keystore ou secret n'apparaît dans l'historique, un
      log ou `git status`.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<empreinte normalisée, noms des secrets, sortie apksigner>`

## 8. Préparation du tag

```sh
git switch main
git pull --ff-only
git status --short
git rev-parse HEAD
```

- [ ] `main` est à jour, l'arbre est propre et `HEAD` est le commit vérifié en
      section 1.
- [ ] Le tag sera annoté par la commande de la section 9, sans force-push ni
      déplacement ultérieur.
- [ ] `LICENSE`, `THIRD_PARTY_NOTICES.md` et `web/public/licenses/` sont
      présents dans l'arbre taggé.
- [ ] L'approbation de l'environnement `release` est prête : le relecteur
      nommé est disponible pour approuver le job `publish`.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<sha, statut git, approbateur>`

## 9. Publication du tag

```sh
git tag -a <vX.Y.Z> -m "Very Slop Notes <X.Y.Z>"
bun agents/runtime/android-version.ts
git push origin <vX.Y.Z>
```

- [ ] La sortie de `android-version.ts` donne exactement le `versionName` et le
      `versionCode` consignés, et correspond au tag poussé.
- [ ] Le tag est poussé sur le commit vérifié, une seule fois.
- [ ] `release.yml` démarre ; le job `publish` attend l'approbation de
      l'environnement `release`, puis re-signe et publie.
- [ ] Une bêta sort en **pré-release** GitHub, jamais en « Latest » ; une
      finale peut être « Latest ».
- [ ] Le workflow va au bout sans secret absent, sans certificat debug et sans
      tag déplacé.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<URL du run release, tag, sortie version>`

## 10. Signature et empreinte publiées

```sh
gh release download <vX.Y.Z> --dir /tmp/vsn-release
cd /tmp/vsn-release
apksigner verify --print-certs veryslopnynotes-<X.Y.Z>.apk
```

- [ ] Le certificat du fichier téléchargé est le certificat release attendu,
      jamais `CN=Android Debug`.
- [ ] L'empreinte SHA-256 du certificat, normalisée, est identique à celle du
      keystore et à celle publiée dans la note de release.
- [ ] L'empreinte est reportée dans le tableau de [`SIGNING.md`](SIGNING.md)
      dans la même PR que la release, ou la ligne de rotation est justifiée.
- [ ] Une empreinte différente bloque la publication et ouvre un incident S5,
      même sans autre symptôme.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<empreinte publiée et sortie apksigner>`

## 11. SHA-256

```sh
cd /tmp/vsn-release
sha256sum -c SHA256SUMS
```

- [ ] `SHA256SUMS` couvre l'APK, l'archive source, `mapping.txt` et `seeds.txt`.
- [ ] `sha256sum -c` réussit sur tous les fichiers téléchargés.
- [ ] Les valeurs affichées sur la page de release sont identiques à celles du
      fichier `SHA256SUMS`.
- [ ] Toute différence bloque la publication : le SHA-256 prouve le
      téléchargement, l'empreinte du certificat prouve le signataire.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<sortie sha256sum -c et URL de release>`

## 12. Offre de source

```sh
gh release view <vX.Y.Z> --json assets,url,body
```

- [ ] La page de release pointe le tag exact et
      `archive/refs/tags/<vX.Y.Z>.tar.gz`.
- [ ] L'archive jointe `veryslopnynotes-<X.Y.Z>-source.tar.gz` est présente et
      son SHA-256 est dans `SHA256SUMS`.
- [ ] L'archive contient `LICENSE` (GPL-3.0-only) et le code correspondant au
      tag, sans fichier ignoré ni secret.
- [ ] L'offre de source reste accessible tant que l'APK est proposé.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<URLs du tag, de l'archive et du SHA-256>`

## 13. Soak de la bêta

La cohorte, l'installation et le retour suivent [`BETA.md`](BETA.md).

- [ ] Pour v1.0, au moins une bêta a été publiée avant la finale.
- [ ] Les revues de bêta J+0, J+1, J+3 et J+7 ont eu lieu, puis chaque semaine
      jusqu'à J+30 ; chaque revue est consignée avec sa date et sa preuve.
- [ ] Aucun seuil S1 à S6 de [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) n'est
      franchi ; une absence de signal est notée « muet », jamais « vert ».
- [ ] Si une pause ou un retrait a eu lieu, les quatre preuves de reprise sont
      jointes : 24 h sous les seuils, gate vert, empreintes republiées,
      rapports clos ou expliqués.
- [ ] Le `versionCode` de la finale est supérieur à celui de chaque bêta ; la
      note de release rappelle qu'un downgrade exige une désinstallation et
      efface les données locales.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<liens des revues J+0 à J+7 et décision>`

## 14. Issue known-issues

- [ ] Une issue épinglée `[known-issues] <tag>` existe, avec le label `bug`.
- [ ] Chaque défaut connu y figure avec son contournement, son propriétaire et
      sa version cible.
- [ ] Elle est mise à jour à chaque revue de bêta et liée depuis la note de
      release.
- [ ] Elle est close quand la version n'est plus proposée ; aucun défaut connu
      ne reste seulement dans un fil de discussion.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<URL de l'issue épinglée>`

## 15. Annonce

Le texte et les notes suivent [`RELEASE-ANNOUNCEMENT.md`](RELEASE-ANNOUNCEMENT.md).

- [ ] La GitHub Release est publiée avec les notes, `SHA256SUMS`, l'empreinte du
      certificat, l'offre de source, le lien `known-issues` et les versions de
      notice et de consentement.
- [ ] L'annonce reste sur les canaux prévus : GitHub Release, `CHANGELOG.md` et
      issue `known-issues`. Aucun courriel, push, DM ou adresse inventée.
- [ ] Aucun contenu de l'annonce ne contient de donnée scolaire, personnel,
      secret ou capture non caviardée.
- [ ] Une bêta reste marquée pré-release ; la finale seule peut être « Latest ».

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<URL de la release et de l'annonce>`

## 16. Retrait et retour arrière

- [ ] La dernière version connue bonne est identifiée avec son URL, son
      `SHA256SUMS` et son empreinte de certificat.
- [ ] Les décideurs sont nommés : le responsable de release prononce la pause ;
      le retrait exige le responsable **et** le mainteneur de garde ; une clé
      exposée ou une faille exploitable exige aussi le mainteneur sécurité.
- [ ] Le chemin de retrait est connu : arrêt du déploiement Play si applicable,
      retrait de l'APK et de ses empreintes en sideload, republication de la
      dernière version bonne, retour au digest serveur précédent si applicable.
- [ ] Aucune release n'est supprimée en silence : la page porte la mention
      « retiré », le motif et la version de remplacement, et une issue
      `incident` est ouverte selon [`INCIDENTS.md`](INCIDENTS.md).
- [ ] Les canaux de secours sont connus : issues GitHub pour un incident non
      sensible, GitHub Security Advisory pour une faille ou une clé exposée.

> **Preuve** — propriétaire : `<nom>` · date : `<AAAA-MM-JJ>` · preuve : `<URL de la dernière version bonne, empreintes, décideurs>`

## Signatures

Pour v1.0, deux signatures humaines sont obligatoires : responsable de release
et mainteneur de garde. Ajouter le mainteneur sécurité si la release touche une
clé ou une faille. Un agent ne remplit ni ne signe ces lignes.

| Rôle | Nom | Date | Décision | Preuve |
|---|---|---|---|---|
| Responsable de release |  |  | `<livrer / refuser>` |  |
| Mainteneur de garde |  |  | `<livrer / refuser>` |  |
| Mainteneur sécurité (si requis) |  |  | `<livrer / refuser>` |  |
