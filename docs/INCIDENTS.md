# Incidents et suivi de release

Un incident est un écart observable entre une release publiée et son contrat :
crash, ANR, perte de données, artefact non conforme, gate rouge sur un commit
taggé ou serveur indisponible. Les signaux, seuils et décisions de retrait sont
dans [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) ; ce document règle le triage et
la communication.

## Déclencheurs

- Un seuil S1, S2, S3, S4, S5 ou S6 de `RELEASE-HEALTH.md` est franchi.
- Deux rapports indépendants de perte de données visent la même version.
- Un signalement `SECURITY.md` est exploitable ou une clé est exposée.
- Le même échec se produit trois fois : il ouvre une issue `incident` (AGENTS.md).

## Triage

| Priorité | Exemple | Accusé de réception | Décision |
|---|---|---|---|
| P0 | Perte de données, démarrage cassé, faille exploitable, clé exposée | ≤ 4 h | Retrait ou correctif ≤ 24 h |
| P1 | Crash ou ANR au-dessus du seuil de pause | ≤ 1 jour ouvré | Pause ou correctif ≤ 72 h |
| P2 | Régression sans perte de données, artefact douteux | ≤ 3 jours ouvrés | Correctif à la prochaine release |
| P3 | Gêne mineure, question de comportement | ≤ 5 jours ouvrés | Vers la file normale |

Un rapport sans version, sans étape de reproduction et sans trace est demandé en
complément une fois, puis classé P3. Le triage ne demande ni identifiant
d'appareil ni journal automatique : la trace vient de l'utilisateur, jamais d'une
collecte cachée.

## Règle de pause

Deux rapports indépendants de **perte de données** sur la même version en
7 jours, ou un seuil de crash/ANR de `RELEASE-HEALTH.md` franchi, imposent la
pause immédiate du déploiement. La reprise exige les quatre preuves de
`RELEASE-HEALTH.md` : 24 h sous les seuils, gate vert, empreintes republiées,
rapports clos ou expliqués.

## Issue « known-issues »

Une issue épinglée `[known-issues] vX.Y.Z` (label `bug`) liste, pour chaque
version publiée ou en bêta, les défauts connus, leur contournement, leur
propriétaire et la version cible. Elle est mise à jour à chaque revue de bêta et
close quand la version n'est plus proposée. Aucun défaut connu ne reste seulement
dans un fil de discussion.

## Revue de bêta

Revue de bêta : J+0, J+1, J+3, J+7, puis hebdomadaire jusqu'à J+30. Ordre du
jour : vitals S1/S2, verdict CI S3, rapports S4, empreintes S5, santé serveur S6,
issue `known-issues`, décision de poursuite, de pause ou de retrait. Le
responsable de release tient la revue ; l'absence de signal se note « muet »,
pas « vert ».

## Procédure

1. Ouvrir une issue `incident` avec version, signal, seuil franchi et preuve.
2. Geler la publication ou le déploiement concerné ; ne pas merger de correctif
   sans gate vert.
3. Appliquer la décision de [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) : pause,
   retrait, retour arrière serveur ou correctif.
4. Publier un avis court sur l'issue et dans les notes de version : versions
   touchées, contournement, version corrigée, empreintes.
5. Clore après les quatre preuves de reprise. Trois échecs identiques donnent une
   entrée d'invariant via `OPERATING.md`.
