# DOGFOOD-LOG.md — journal du dogfood interne

> **Aucune donnée scolaire dans ce journal.** Pas de nom, d'établissement, de
> classe, de note, de message, d'actualité, de pièce jointe, de QR, de PIN, de
> jeton, de clé OpenRouter, de capture non caviardée, d'export de données, de
> numéro de série ni d'identifiant d'appareil. Uniquement « Connexion démo » et
> du texte synthétique.

Modèle vierge du journal demandé par #965. Le protocole, le triage et la règle
d'arrêt sont dans [`DOGFOOD.md`](DOGFOOD.md) ; ce fichier est vierge :
**aucune entrée** et aucune date préremplie. Le remplir d'une ligne par jour,
même un jour sans usage. Une cellule vide signifie « non exercé » ou « sans
preuve », jamais « réussi ».

## Entrées quotidiennes

`Sévérité` : `aucune`, `P0`, `P1`, `P2` ou `P3`. `Décision` : `continue`,
`pause` ou `arrêt`. Les définitions et la reprise sont dans
[`DOGFOOD.md`](DOGFOOD.md#triage-p0p1-et-règle-darrêt).

| Jour | Date | Build/tag | Appareil/WebView | Parcours testés | Hors-ligne | IA désactivée/activée | Mise à jour / données conservées | Erreurs | Sévérité | Décision |
|---|---|---|---|---|---|---|---|---|---|---|
| J1 | | | | | | | | | | |
| J2 | | | | | | | | | | |
| J3 | | | | | | | | | | |
| J4 | | | | | | | | | | |
| J5 | | | | | | | | | | |
| J6 | | | | | | | | | | |
| J7 | | | | | | | | | | |
| J8 | | | | | | | | | | |
| J9 | | | | | | | | | | |
| J10 | | | | | | | | | | |
| J11 | | | | | | | | | | |
| J12 | | | | | | | | | | |
| J13 | | | | | | | | | | |
| J14 | | | | | | | | | | |

Chaque erreur note le code exact, le message, l'écran, les étapes de
reproduction et le nombre d'occurrences. Chaque mise à jour note le build
précédent, le nouveau build et les données retrouvées. Ne joindre que des
preuves caviardées et bornées, sans télémétrie.

## Signature finale

À remplir seulement après les 14 entrées et leurs preuves.

```text
Propriétaire du dogfood : ______________________________
Date de clôture : ______________________________________
Build final (commit) : _________________________________
SHA-256 de l'APK : _____________________________________
Décision : [ ] GO    [ ] NO-GO
```
