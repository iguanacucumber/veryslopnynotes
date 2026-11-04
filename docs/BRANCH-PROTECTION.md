# Protection de `main`, environnement `release` et Actions

État vérifié le 2026-11-04 par l'API GitHub. Ce fichier est la source de
vérité des réglages de sécurité du dépôt : toute modification se fait par
l'interface ou `gh api`, puis se reporte ici. Les commandes de vérification
doivent rendre les valeurs décrites, pas une approximation.

## Périmètre : dépôt personnel

`iguanacucumber/veryslopnynotes` appartient à un **compte utilisateur**, pas à
une organisation. Les règles d'organisation (2FA obligatoire pour les membres,
rulesets et politiques Actions d'organisation) ne s'appliquent donc pas.

Le propriétaire a la 2FA **activée** (`gh api user --jq
.two_factor_authentication` rend `true`). Un second collaborateur a le droit
`push` ; GitHub n'expose pas la 2FA d'un autre compte et un compte personnel ne
peut pas l'imposer. « 2FA obligatoire pour tous les écrivains » demande un
transfert vers une organisation : décision humaine, hors API.

## `main` — ruleset « main — gate obligatoire »

Le ruleset existant porte l'identifiant `26465268` (il change si le ruleset est
recréé). Il vise `refs/heads/main`, en `active`, sans acteur de contournement.

| Règle | Effet |
|---|---|
| `deletion` | suppression de `main` interdite |
| `non_fast_forward` | force-push interdit |
| `pull_request` | merge uniquement via PR, 0 approbation requise, merge/squash/rebase autorisés |
| `required_status_checks` | `check`, `web-smoke` et `gitleaks` requis, sans politique stricte |

`agents/protect-main.sh` réapplique ce ruleset de façon idempotente.
`GET /repos/.../branches/main/protection` rend **404** : la protection vient
du ruleset, pas de l'ancienne branch protection. C'est attendu.

## Environnement `release`

| Réglage | Valeur |
|---|---|
| Nom | `release` |
| Relecteur obligatoire | `iguanacucumber` (id `173815334`), 1 approbation |
| Auto-relecture | autorisée (`prevent_self_review: false`), un seul mainteneur |
| Délai | 0 minute |
| Branche/tag de déploiement | tags personnalisés uniquement : `v*` |
| Contournement admin | activé (défaut GitHub, non réglable par cette API) |

`v*` couvre les tags `vX.Y.Z` décrits dans [`RELEASE.md`](RELEASE.md). Le job
`publish` de `.github/workflows/release.yml` déclare `environment: release` :
une release attend l'approbation du mainteneur avant signature et publication.
`release-artifact.yml` tourne sur chaque PR et reste sans approbation.

## Permissions GitHub Actions

| Réglage | Valeur |
|---|---|
| Actions activées | oui |
| Actions autorisées | `selected` (liste ci-dessous) |
| SHA complet obligatoire | oui (`sha_pinning_required: true`) |
| Jeton par défaut | lecture seule (`default_workflow_permissions: read`) |
| Approbation de PR par Actions | interdite (`can_approve_pull_request_reviews: false`) |

Allowlist : actions GitHub (`github_owned_allowed: true`), aucun créateur
vérifié générique (`verified_allowed: false`), et deux motifs pour les actions
tierces réellement utilisées :

- `oven-sh/setup-bun@*`
- `ReactiveCircus/android-emulator-runner@*`

Tous les `uses:` des workflows sont déjà épinglés sur un SHA de 40 caractères.
La commande suivante ne doit **rien** afficher :

```bash
rg -n '^\s*uses:' .github/workflows/ | rg -v '@[0-9a-f]{40}'
```

Une nouvelle action tierce échoue tant que son motif n'est pas ajouté à
l'allowlist ; c'est le but, pas un incident.

## Vérifier

```bash
R=iguanacucumber/veryslopnynotes
gh api "repos/$R/rulesets" --jq '.[] | {name, enforcement, id}'
gh api "repos/$R/rulesets/26465268" --jq '{name, enforcement, bypass_actors, rules}'
gh api "repos/$R/environments/release" --jq '{name, protection_rules, deployment_branch_policy}'
gh api "repos/$R/environments/release/deployment-branch-policies"
gh api "repos/$R/actions/permissions"
gh api "repos/$R/actions/permissions/selected-actions"
gh api "repos/$R/actions/permissions/workflow"
gh api user --jq '{login, two_factor_authentication}'
gh api "repos/$R/tags"; gh api "repos/$R/releases"
```

Attendu : un ruleset actif nommé « main — gate obligatoire » ; un environnement
`release` avec `required_reviewers` et la politique `v*` ; `allowed_actions:
selected`, `sha_pinning_required: true` ; `two_factor_authentication: true` ;
aucun tag ni release publié à ce jour.

## Revenir en arrière

Chaque réglage est réversible ; le retrait affaiblit la protection, donc il se
justifie dans la PR ou l'issue.

- **Environnement** : `gh api --method DELETE
  repos/iguanacucumber/veryslopnynotes/environments/release` supprime le
  relecteur et la politique de tags.
- **Politique de tags** : `gh api --method DELETE
  repos/iguanacucumber/veryslopnynotes/environments/release/deployment-branch-policies/65479971`
  laisse l'environnement sans restriction de branche/tag.
- **Actions** : `gh api --method PUT
  repos/iguanacucumber/veryslopnynotes/actions/permissions -F enabled=true
  -f allowed_actions=all -F sha_pinning_required=false` rétablit « toutes les
  actions, sans épinglage ». La méthode est `PUT` ; `PATCH` rend 404.
- **Ruleset `main`** : `gh api --method DELETE
  repos/iguanacucumber/veryslopnynotes/rulesets/26465268` retire le gate de
  `main` (PR, checks, force-push, suppression). À éviter ; `agents/protect-main.sh`
  le recrée.
- **2FA** : réglage du compte, jamais modifiable par l'API du dépôt.

## Actions humaines restantes

1. **2FA de tous les écrivains** : la 2FA du propriétaire est active. Pour
   l'imposer aussi au collaborateur avec droit `push`, transférer le dépôt dans
   une organisation avec 2FA obligatoire, ou retirer ce collaborateur. Aucun
   appel API de ce dépôt ne peut le faire.
2. **Secrets de signature** : créer dans l'environnement `release`
   `RELEASE_KEYSTORE_BASE64` (keystore PKCS12 encodé base64),
   `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`. Sans
   eux, `release.yml` échoue avant toute publication (aucun repli debug).
3. **Dependabot** : alertes et mises à jour de sécurité sont désactivées
   (`dependabot_security_updates: disabled`) ; les activer est une décision
   distincte, avec du bruit de PR attendu. Le scan de secrets et la protection
   push sont déjà actifs.
