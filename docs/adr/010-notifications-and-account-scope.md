# ADR-010 — aucun rappel, compte élève uniquement

- Statut : accepté (issue #832)
- Complète : [ADR-006](006-no-notifications.md) — les notifications ne sont
  pas seulement reportées, elles sont hors du périmètre de cette version.
- Ne change aucune loi de [`AGENTS.md`](../../AGENTS.md).

## Contexte

[ADR-006](006-no-notifications.md) a supprimé la chaîne de notifications
(`NotifyFormat.kt`, `GradeDiff.kt`, détection d'examens) parce qu'elle n'avait
ni entrée applicative ni demande utilisateur. Restaient deux questions de
produit : l'app doit-elle rappeler un devoir ou un cours, et doit-elle servir
le compte d'un parent en plus de celui de l'élève ?

Le code répond déjà non sur les deux points. Aucun `NotificationManager`, canal
ou `POST_NOTIFICATIONS` n'existe ; `PeriodicSyncWorker` réécrit le cache toutes
les 6 h sans comparer ni alerter. La session est mono-compte : changer de
compte remplace l'appairage et purge la racine du précédent (loi 4). Le profil
affiche les enfants publiés par `/v1/me` en lecture seule, sans sélecteur ni
appel `accounts.select`.

Sans décision écrite, une copie produit peut promettre un rappel ou laisser
croire qu'un parent ouvre l'app à la place de l'élève.

## Décision

**Aucun rappel.** L'app n'émet ni notification push ni notification locale
programmée pour un devoir, une note ou un cours. La synchronisation de fond
met le cache à jour en silence ; elle ne notifie jamais. Aucune permission
`POST_NOTIFICATIONS` n'est demandée. Livrer un rappel exigera une nouvelle
décision avec son UX de permission, sa déduplication au redémarrage et ses
tests.

**Compte élève uniquement.** L'app sert un seul compte Pronote à la fois,
celui de l'élève appairé. Les comptes parent sont hors périmètre : aucun écran
parent, aucun accès aux enfants depuis un compte parent, aucune bascule d'un
enfant à l'autre. Les comptes liés publiés par l'établissement restent une
information en lecture seule, pas une entrée de session.

Aucun développement n'est planifié pour ces deux fonctions.

## Alternatives écartées

- **Notification locale seule, sans serveur** : conserve l'esprit local, mais
  impose la permission, un canal, une déduplication et un texte borné pour une
  fonctionnalité sans demande ; ADR-006 avait déjà tranché le coût.
- **Mode parent** : demanderait un second modèle de session, une règle de
  purge par enfant et des écrans dédiés, alors que l'app est centrée sur
  l'élève et que les comptes liés sont déjà publiés.
- **Masquer les comptes liés** : supprimerait une information que
  l'établissement publie ; la lecture seule suffit et ne promet rien.

## Conséquences

- `README.md`, [`docs/PRODUCT.md`](../PRODUCT.md), l'aide et le profil disent
  la même limite : pas de rappel, compte élève uniquement, comptes parent hors
  périmètre.
- `tests/architecture/notifications-scope.test.ts` verrouille l'ADR, les
  copies et l'absence de permission de notifier.
- Une notification ou un compte parent futur repart d'un nouvel ADR ; la
  décision d'aujourd'hui n'est pas un « pour plus tard » implicite.
