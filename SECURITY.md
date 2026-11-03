# Sécurité

## Signaler une vulnérabilité

Ne pas ouvrir d'issue publique pour une faille exploitable. Utiliser
**GitHub Security Advisories** : onglet *Security* du dépôt, puis
*Report a vulnerability*. Le rapport reste privé le temps de l'analyse.

Le dépôt n'a pas d'adresse de signalement par courriel : tout passe par ce
canal privé.

## Périmètre

- **App Android** (`android/`) : stockage de la session Pronote et de la clé
  LLM, pont WebView, contenu non fiable, journalisation.
- **Interface web** (`web/`) : CSP, absence de réseau, injection dans le pont.
- **Serveur et scraper** (`server/`, `Dockerfile.server`) : SSRF, traversée de
  fichiers, fuite de cookie jar, image Docker.
- **Chaîne de build** (`.github/workflows/`, scripts `agents/`) : injection
  dans le gate, dépendances compromises.

Hors périmètre : une faille propre à Pronote ou à OpenRouter, une
configuration de l'établissement, et un déploiement du scraper fait par un
opérateur hors des règles ci-dessous.

## Modèle de menace

Les menaces, leurs mitigations et leurs preuves sont détaillées dans
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) : appareil partagé, charge scolaire
malveillante, dépendance compromise, scraper local et clé perdue.

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

Seule la branche `main` est maintenue : les correctifs de sécurité y arrivent.
Les versions publiées antérieures ne reçoivent pas de correctif isolé ; la
mise à jour vers la dernière version est la voie de correction.
