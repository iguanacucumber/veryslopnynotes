# Sécurité

Deux canaux distincts : **GitHub Security Advisories** pour une vulnérabilité,
les **issues publiques** pour le support et les bugs non exploitables.

## Signaler une vulnérabilité

Ne pas ouvrir d'issue publique pour une faille exploitable. Utiliser
**GitHub Security Advisories** : onglet *Security* du dépôt, puis
*Report a vulnerability*, ou
<https://github.com/iguanacucumber/veryslopnynotes/security/advisories/new>.
Le rapport reste privé le temps de l'analyse.

Joindre, sans donnée scolaire réelle : version ou commit, plateforme, étapes de
reproduction, impact et preuve. Une capture caviardée suffit ; ne jamais joindre
une session, une clé, une URL d'établissement, une note ou un message.

**Pas de courriel, de clé PGP ni de `security.txt`.** Le dépôt n'a ni adresse de
signalement par courriel ni site public ([`docs/REPOSITORY.md`](docs/REPOSITORY.md)) :
aucune origine du projet ne sert `.well-known/security.txt`, et une clé PGP sans
adresse ne protégerait aucun rapport. Aucun des deux n'est donc publié, et il ne
faut supposer ni adresse, ni clé, ni empreinte. Advisories est le seul canal
privé ; il passe par HTTPS.

## Délais et divulgation coordonnée

Objectif : accuser réception sous **7 jours ouvrés**, puis publier un correctif
ou un avis sous **90 jours** à compter de cet accusé. Une faille activement
exploitée ou une clé exposée suit le triage P0 de
[`docs/INCIDENTS.md`](docs/INCIDENTS.md) : accusé sous 4 h, décision sous 24 h.

Le délai peut être raccourci dès qu'un correctif est prêt. Une prolongation
au-delà de 90 jours exige l'accord écrit du rapporteur et une raison consignée
dans l'avis ; à défaut d'accord, l'avis est publié à l'échéance avec les
mitigations connues. Ces délais sont des objectifs de maintenance, pas un
engagement contractuel.

## Assistance et rapports de bug

Le canal privé sert aux vulnérabilités, pas au support. Une question d'usage,
un crash non exploitable, une incompatibilité QR/MFA/WebView ou une demande
d'accessibilité s'ouvre en **issue publique** :
<https://github.com/iguanacucumber/veryslopnynotes/issues/new/choose>. L'aide
est communautaire, sans délai garanti. Ne jamais joindre de donnée scolaire :
version de l'app, version d'Android et de la WebView, écran, message exact et
étapes suffisent. Les limites d'accessibilité et leur canal sont dans
[`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) ; les versions Android et
WebView prises en charge sont dans
[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).

Un rapport de sécurité n'est pas une demande de support et reste privé jusqu'à
la publication de l'avis.

## Périmètre

Le périmètre est celui du [modèle de menace](#modèle-de-menace) : une faille
n'est traitée ici que si elle affecte un actif ou une frontière qu'il décrit.

- **App Android** (`android/`) : stockage de la session Pronote et de la clé
  LLM, pont WebView, contenu non fiable, journalisation.
- **Interface web** (`web/`) : CSP, absence de réseau, injection dans le pont.
- **Serveur et scraper** (`server/`, `Dockerfile.server`) : SSRF, traversée de
  fichiers, fuite de cookie jar, image Docker.
- **Chaîne de build** (`.github/workflows/`, scripts `agents/`) : injection
  dans le gate, dépendances compromises.

Hors périmètre : une faille propre à Pronote ou à OpenRouter, une
configuration de l'établissement, un déploiement du scraper fait par un
opérateur hors des règles ci-dessous, un appareil rooté ou un OS compromis, et
l'ingénierie sociale. Une faille dans une dépendance amont se signale aussi à
l'amont ; si elle affecte l'app, un rapport ici reste utile.

## Modèle de menace

Les menaces, leurs mitigations et leurs preuves sont détaillées dans
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) : appareil partagé, charge scolaire
malveillante, dépendance compromise, scraper local et clé perdue. Ce document ne
remplace ni un test d'intrusion ni une preuve formelle ; il nomme aussi ce qui
reste ouvert.

La santé d'une release se lit sans télémétrie dans
[`docs/RELEASE-HEALTH.md`](docs/RELEASE-HEALTH.md) ; le triage et la règle de
pause sont dans [`docs/INCIDENTS.md`](docs/INCIDENTS.md).

## Règles que le dépôt tient

- **Aucun secret dans le dépôt.** Pas de clé, de session, de mot de passe, de
  `.env`, ni de donnée personnelle. Un secret exposé est **révoqué et
  remplacé** : retirer le commit ne suffit pas.
- **Le scraper est sans authentification sur la boucle locale** (I8). Toute
  écoute hors loopback est REFUSÉE sans `ALLOW_PUBLIC=1` ; ce mode exige un
  `SCRAPER_TOKEN` vérifié en Bearer, un seau par jeton (`429` + `Retry-After`)
  et un proxy authentifié devant. Une exposition publique est un choix de
  l'opérateur, pas un défaut de l'image.
- **Les actions GitHub sont épinglées** à un SHA de commit, pas à un tag
  mutable. Dependabot propose les mises à jour.

## Scan de l'historique et push protection

`make lint` ne voit que les fichiers trackés : un secret retiré par un commit
ultérieur reste lisible dans l'historique. La CI rejoue donc **tout**
l'historique avec gitleaks, sur chaque PR et sur `main` :
[`.github/workflows/secret-scan.yml`](.github/workflows/secret-scan.yml). Le
binaire `8.30.1` est épinglé et vérifié par SHA-256, aucune action ni aucun
secret n'est requis ; le job échoue dès une trouvaille. Les exemptions de
[`.gitleaks.toml`](.gitleaks.toml) ne portent que sur des valeurs de test
exactes, jamais sur un chemin.

Reproduire localement avec gitleaks 8.30.1 installé :

```bash
gitleaks git . --log-opts=--all --config .gitleaks.toml --redact
```

**Push protection** : c'est un réglage du dépôt, pas un fichier. Il doit
rester activé dans *Settings → Code security → Secret scanning → Push
protection* (vérifiable avec
`gh api repos/<owner>/<repo> --jq .security_and_analysis`). Un push contenant
un secret reconnu est alors refusé avant d'entrer dans l'historique ; une
valeur de test volontaire s'exempte dans `.gitleaks.toml`, pas par un
`gitleaks:allow` dispersé.

## Dépendances et conteneur

Trois contrôles couvrent la chaîne d'approvisionnement, sur chaque PR et sur
`main` : [`security-scan.yml`](.github/workflows/security-scan.yml) diffe le
graphe de dépendances de la PR (`fail-on-severity: high`) ; si le graphe du
dépôt est désactivé, le job se replie sur `bun audit --audit-level=high` quand
un manifeste change. Trivy scanne ensuite l'arbre et l'IMAGE serveur construite
dans le job. Le binaire Trivy `0.76.1`
est épinglé et vérifié par SHA-256 ; un cache indisponible ne change pas le
verdict. Une trouvaille HIGH/CRITICAL **avec correctif** échoue le job.
`--ignore-unfixed` est une politique explicite : une CVE sans version corrigée
ne peut être réparée par aucune PR. Les rapports partent en artefact 7 jours.

Les artefacts Gradle sont vérifiés par
[`android/gradle/verification-metadata.xml`](android/gradle/verification-metadata.xml),
appliqué par l'étape `android-compile` de `make check` (mode `strict` par
défaut). Un jar, une AAR ou un module dont l'empreinte SHA-256 n'est pas dans
ce fichier fait échouer la compilation, localement comme en CI. Après une mise
à jour de dépendance volontaire, régénérer le fichier avec
`./gradlew --write-verification-metadata sha256 <tâche>` et relire le diff :
chaque nouvelle empreinte est une décision de sécurité.

## Versions prises en charge

| Artefact | Pris en charge | Correctifs |
|---|---|---|
| Branche `main` | Oui | Correctifs de sécurité, sans rétroportage |
| Dernière version publiée (APK/AAB) | Oui, par mise à jour | Pas de correctif isolé sur une version antérieure |
| Version publiée antérieure | Non | Mettre à jour vers la dernière version |
| Image serveur (`Dockerfile.server`) | Digest épinglé | Reconstruire depuis le digest corrigé |

Aucune branche LTS ni série de correctifs parallèle n'est maintenue. Une faille
corrigée sur `main` n'est pas rétroportée : la mise à jour vers la dernière
version est la voie de correction. Les versions Android, WebView et Pronote
acceptées par l'app sont dans [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).
