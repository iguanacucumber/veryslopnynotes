# Relicence MIT → GPL-3.0-only

Statut : **fait d'ingénierie consigné — avis juridique non rendu**. Ce document
rassemble les preuves de la décision [ADR-008](../adr/008-relicense-gpl.md) ; il
ne remplace ni l'ADR ni la revue du conseil suivie dans #976.

Date du constat : **2026-11-04**. Issue : #827. Décision : ADR-008.

## Décision en une ligne

Le dépôt est distribué sous **GPL-3.0-only** depuis le commit `2def868`
(2026-11-04), qui remplace `LICENSE`. Les commits antérieurs ont été publiés
sous MIT à partir de `aa47c0e` ; le commit initial `1b061ad` ne contient qu'un
README, sans fichier de licence.

Aucun tag, aucune GitHub Release et aucun binaire `*.apk`/`*.aab` n'existe dans
l'historique au 2026-11-04 : la fenêtre de relicence couvre tout le code publié.
Un binaire qui aurait circulé hors dépôt resterait sous MIT pour ses
destinataires ; la relicence ne révoque pas ce droit (ADR-008 §5).

## Pourquoi MIT permet la relicence

Le texte MIT alors en vigueur (`LICENSE` au commit `2def868^`) accorde :

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, **sublicense**, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.

Le droit de sous-licencier couvre la distribution du code sous un autre texte,
y compris GPL-3.0-only. MIT n'est pas copyleft : hors la condition
d'attribution, il ne limite pas la licence des distributions dérivées. Le texte
ne prévoit aucune signature ni formalité supplémentaire pour ce changement.

La condition d'attribution reste : la ligne de copyright et l'avis MIT sont
conservés dans l'historique et reproduits ci-dessous. Ils ne disparaissent pas
parce que la distribution courante est GPL.

### Avis MIT conservé

```text
MIT License

Copyright (c) 2026 veryslopnynotes contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Le texte intégral reste lisible avec `git show 2def868^:LICENSE`.

## Ayants droit et contributeurs (preuve Git)

Relevé le 2026-11-04 sur toutes les refs avec
`git shortlog -sne --all` et
`git log --all --format='%an <%ae>' | sort -u`. Les adresses électroniques
restent dans l'historique Git et ne sont pas recopiées ici (règle « pas de
donnée personnelle ») ; les identités sont regroupées par nom affiché.

| Identité Git | Commits | Période | Lecture |
|---|---:|---|---|
| `IguanaCucumber` (trois adresses) | 1 028 | 2026-10-02 → 2026-11-04 | personne |
| `Opencode Slopper` (deux adresses) | 287 | 2026-10-02 → 2026-11-03 | identité d'outil |
| `Brassdelere` | 13 | 2026-10-02 → 2026-10-03 | personne |
| `dependabot[bot]` | 8 | 2026-10-28 → 2026-11-04 | bot de dépendances |
| `agent` | 5 | 2026-10-19 → 2026-10-21 | automatisation |
| `opencode` | 4 | 2026-10-19 → 2026-10-21 | automatisation |
| `agent-427` | 1 | 2026-10-19 | automatisation |
| `x` | 1 | 2026-10-04 | identité de remplacement |

Des trailers `Co-authored-by` émis par l'outil `opencode` existent aussi : même
lecture que les identités d'outillage.

`IguanaCucumber` apparaît sous trois adresses (deux adresses noreply GitHub et
une adresse personnelle) ; `Opencode Slopper` partage l'adresse noreply GitHub
du mainteneur. Une même personne peut donc apparaître sous plusieurs adresses ;
l'inventaire ne fusionne pas les identités au-delà de ce que Git montre. Les
entrées `agent`, `agent-427`, `opencode`, `x` et `dependabot[bot]` sont des
outils ou des identités de remplacement, pas des personnes nommables. Les
seules identités humaines distinctes que l'historique permet de nommer sont
**IguanaCucumber** et **Brassdelere**.

Toutes les contributions antérieures à `2def868` ont été faites sous le texte
MIT ajouté par `aa47c0e` ; le README du commit initial est la seule exception.
Aucune cession de copyright ni CLA n'existe : chaque auteur garde son copyright
et la ligne collective « veryslopnynotes contributors » couvre l'ensemble
(ADR-008 §2).

## Politique de contribution : inbound = outbound et DCO

- **Inbound = outbound** : toute contribution entrante est publiée sous
  GPL-3.0-only, la licence de sortie du dépôt (ADR-008 §2).
- **DCO** : la règle exige `Signed-off-by: Nom <email>` sur chaque commit
  (`git commit -s`), qui atteste que l'auteur peut publier sa contribution sous
  GPL-3.0-only. Pas de CLA et pas de cession de copyright.
- Le contrôle du trailer est humain, pas automatisé : le relecteur le vérifie
  avant le merge ([`CONTRIBUTING.md`](../../CONTRIBUTING.md) § DCO).
- Une nouvelle dépendance doit être compatible GPL-3.0-only ; le contrôle de
  compatibilité est décrit dans ADR-008 et exécuté par le gate (#842).
- Cette politique vaut pour les contributions futures. Elle ne convertit pas
  les fichiers dérivés de Papillon, qui n'ont jamais été sous MIT.

## Origine Papillon et inventaire #838

Papillon est distribué sous GPL-3.0. Les fichiers portés ou adaptés depuis
Papillon ne sont pas relicenciés par la voie MIT : ils restent sous GPL-3.0 avec
le copyright et l'attribution d'origine (ADR-008 §4). Ils ne sont ni blanchis ni
présentés comme clean-room.

`docs/legal/PROVENANCE.md` (#838) doit inventorier les fichiers, la version ou
le commit source et la logique portée ; l'inventaire est en cours dans #838. Au
2026-11-04, ce fichier n'existe pas sur `origin/main` ; ce document ne duplique
donc pas l'inventaire. Tant qu'il est incomplet, un fichier qui ressemble à un
portage est traité comme dérivé et crédité. Les crédits tiers sont dans
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) ; aucun logo ni capture
de Papillon n'est livré.

## Fait d'ingénierie, pas avis juridique

Ce document et ADR-008 consignent une lecture d'ingénierie des textes publics
des licences et de l'historique Git. Aucun avis de conseil n'est enregistré :
[`SIGNOFF.md`](SIGNOFF.md) (#976) porte le suivi, ses sept sujets sont `pending`
à la révision 1 du 2026-11-04 et aucune signature n'y est consignée. La revue
juridique écrite — GPL, vie privée, IA et mineurs, autorisation Pronote, marque
et droits des manuels — reste requise avant une release publique.

Rien ici ne doit être lu comme une validation par un conseil. Si cette revue
contredit un point du dossier, ADR-008 et ce document sont corrigés ; le fait
d'ingénierie ne prime pas sur l'avis juridique.

## Vérification

- `git show 2def868^:LICENSE` : texte MIT reproduit ci-dessus.
- `git show 2def868:LICENSE` : bascule vers GPL-3.0-only.
- `git shortlog -sne --all` : tableau des identités.
- `git tag` et `gh release list` : aucune release au 2026-11-04.
- `bun test tests/architecture/relicensing.test.ts` : sections et liens.
- Décision et conséquences : [ADR-008](../adr/008-relicense-gpl.md).
