# Responsable du traitement et contact — dossier de décision

Statut : **décision humaine requise — aucune identité, aucune adresse, aucun
contact, aucun représentant dans l’Union européenne et aucun délégué à la
protection des données ne sont désignés par ce document.**

Ce dossier prépare la décision de l’issue
[#831](https://github.com/iguanacucumber/veryslopnynotes/issues/831) et alimente
la validation juridique de
[#976](https://github.com/iguanacucumber/veryslopnynotes/issues/976). Il ne vaut
pas avis juridique : **la validation par un conseil est requise avant toute
release publique**. Les valeurs entre `{{…}}` sont des champs à remplir par une
personne, jamais des données à inventer.

Date du constat : **2026-11-04**.

## 1. Objet et limites

La notice de confidentialité doit identifier le responsable du traitement et
donner un contact pour les demandes. Aujourd’hui, [`PRIVACY.md`](../../PRIVACY.md)
§1 décrit cette désignation comme **ouverte** et le dépôt ne publie ni entité,
ni adresse, ni adresse dédiée. Le statu quo n’est donc pas une option de
publication : il laisse la notice incomplète et l’issue #831 ouverte.

Ce dossier ne fait pas la décision à la place du mainteneur. Il :

- expose les options réalistes et ce que chacune doit publier ;
- distingue le représentant UE du DPO ;
- propose une recommandation, à valider par un conseil ;
- fournit les champs de décision et le texte de remplacement de la notice.

Il ne nomme aucune personne, aucune association, aucune société, aucun
représentant et aucun DPO. Il ne conclut pas qu’une exemption s’applique.

## 2. Repères RGPD

Les articles ci-dessous sont des repères de préparation, pas une analyse
juridique du cas du projet. Leur application doit être confirmée par un conseil.

| Question | Repère | Conséquence pour la notice |
|---|---|---|
| Qui est responsable ? | Article 4(7) du RGPD : la personne physique ou morale, l’autorité publique, le service ou un autre organisme qui détermine seul ou conjointement les finalités et les moyens du traitement | La notice doit nommer une identité légale, pas seulement un pseudonyme ou un compte GitHub |
| Que publier ? | Article 13(1)(a) : identité et coordonnées du responsable et, le cas échéant, de son représentant | Identité, adresse ou siège, contact vie privée ; le canal doit permettre d’exercer les droits |
| Un représentant UE ? | Article 27 : représentant dans un État membre lorsque le responsable ou le sous-traitant n’est pas établi dans l’Union et traite des personnes qui s’y trouvent, sous réserve des exceptions | À désigner si l’entité est hors UE ; son nom et ses coordonnées doivent être publiés |
| Un DPO ? | Article 37 : désignation obligatoire dans les cas limitativement énumérés, notamment le suivi régulier et systématique à grande échelle ou le traitement à grande échelle de catégories particulières | Ne pas confondre le contact vie privée avec un DPO ; une désignation, même volontaire, impose de publier son contact et de le notifier à l’autorité |
| Qui traite les données scolaires ? | L’établissement est présenté comme responsable des données qu’il héberge ; le projet n’en reçoit pas | La notice doit expliquer ce partage sans laisser croire que le projet détient ces données |

Le projet doit au minimum s’identifier pour le dépôt, les releases et le support
GitHub, et pour les traitements qu’il détermine lui-même. La qualification du
traitement local de l’application, entre projet, utilisateur et établissement,
reste à trancher par le conseil ; elle ne peut pas être remplacée par la mention
« logiciel libre ».

## 3. Périmètre à qualifier

| Traitement | Rôle proposé | Ce que la notice peut vérifier |
|---|---|---|
| Données scolaires lues et stockées dans l’app | Établissement responsable de la collecte d’origine ; projet sans copie serveur | Le projet ne reçoit pas ces données ; une demande se traite sur l’appareil ou auprès de l’établissement |
| Dépôt GitHub, releases, issues, pull requests et logs de téléchargement | Projet responsable de ce qu’il détermine | Identité et contact du projet ; GitHub reste hébergeur et destinataire |
| Traitement local dans l’application (cache, cours, fiches, consentement) | **À qualifier** : projet éditeur, utilisateur ou établissement | Le rôle retenu doit être écrit ; il ne peut pas rester implicite |
| Prompts et photos envoyés à OpenRouter | Utilisateur à l’origine de l’envoi ; OpenRouter destinataire | Le projet ne reçoit rien ; le rôle exact d’OpenRouter reste à confirmer dans la carte des données |
| Scraper de manuels facultatif | Utilisateur ou opérateur de l’instance | Le projet n’exploite pas l’instance ; le scraper ne reçoit jamais la session Pronote |

Cette séparation ne réduit pas la responsabilité du projet pour sa propre
notice, son support et les choix qu’il impose dans l’application. Le conseil doit
dire si le projet est responsable, responsable conjoint ou simple éditeur pour
chaque ligne, et la notice doit refléter la réponse.

## 4. Options réalistes

### A. Mainteneur personne physique, à titre personnel

Le responsable est le mainteneur, en son nom propre. Le compte GitHub
`iguanacucumber` peut rester le canal public de support, mais un pseudonyme ou
un compte ne suffit pas à lui seul à constituer l’identité légale demandée par
la notice ; le conseil doit confirmer ce qui doit être publié.

| À publier | Ce que l’option impose |
|---|---|
| Identité légale | Nom civil du mainteneur, tel qu’il accepte de le publier |
| Adresse | Une adresse de contact ou un siège ; publier le domicile personnel n’est pas anodin et doit être validé par le conseil (domiciliation, boîte postale ou service de courrier éventuel) |
| Contact vie privée | Un canal dédié, privé et durable ; une issue GitHub publique n’est pas un canal pour une demande contenant des données personnelles |
| Représentant UE | Requis si le mainteneur n’est pas établi dans l’Union, sous réserve de l’exception de l’article 27 |
| DPO | Seulement si l’article 37 l’impose ; sinon, documenter l’analyse et ne pas utiliser le titre de DPO pour un simple contact |

**Avantages** : immédiat, sans création d’entité, adapté au développement et à
une bêta fermée.

**Limites** : responsabilité personnelle, confusion entre la personne et le
projet, exposition de l’adresse, continuité incertaine (changement de
mainteneur, incapacité, décès), garde de la clé de signature et du dépôt. Pour
une application destinée à des mineurs, cette option est difficile à défendre
en release publique.

**Quand elle est réaliste** : développement, prototypes et bêta fermée, avec une
identité réelle, un contact qui répond et une analyse écrite du représentant UE
et du DPO.

### B. Association

Le responsable est une association dotée de la personnalité morale, déclarée
selon le droit applicable (en France, association loi 1901 ou forme équivalente
dans le pays d’établissement). Le projet reste libre ; l’association devient
l’éditeur identifié.

| À publier | Ce que l’option impose |
|---|---|
| Identité légale | Dénomination de l’association, numéro RNA et, le cas échéant, SIREN ; nom du représentant légal |
| Adresse | Siège social déclaré ; une domiciliation conforme au droit local peut séparer le siège du domicile personnel |
| Contact vie privée | Canal dédié, distinct du support public |
| Représentant UE | Requis si l’association n’est pas établie dans l’Union |
| DPO | Seulement si l’article 37 l’impose ; documenter l’analyse |

**Avantages** : personnalité morale, continuité au-delà d’un mainteneur, siège
distinct du domicile, possibilité de porter le dépôt, le domaine et la clé de
signature, responsabilité mieux séparée de la personne. C’est la forme la plus
proche d’un projet libre non commercial.

**Limites** : création et formalités, gouvernance, comptes annuels, temps
humain, cotisations éventuelles. La responsabilité des dirigeants n’est pas
supprimée en cas de faute personnelle.

**Quand elle est réaliste** : avant une release publique, en particulier avec
des données de mineurs.

### C. Société

Le responsable est une société commerciale (par exemple SAS ou SARL en France,
ou forme équivalente). Le projet devient une activité éditée par une personne
morale.

| À publier | Ce que l’option impose |
|---|---|
| Identité légale | Raison sociale, forme juridique, siège, numéro SIREN/RCS et représentant légal |
| Adresse | Siège social |
| Contact vie privée | Canal dédié |
| Représentant UE | Requis si la société n’est pas établie dans l’Union |
| DPO | Seulement si l’article 37 l’impose ; documenter l’analyse |

**Avantages** : personnalité morale, responsabilité limitée aux apports en
principe, contrats, salariés, partenaires, monétisation et continuité.

**Limites** : coût de création et de comptabilité, fiscalité, gouvernance,
obligations sociales. C’est disproportionné pour un projet gratuit sans revenu
ni salarié.

**Quand elle est réaliste** : si le projet vend un service, emploie quelqu’un,
signe des contrats importants ou veut une structure commerciale.

### D. Statu quo : ne désigner personne

Ce n’est pas une option de publication. La notice resterait sans identité ni
contact, #831 resterait ouverte et la dérogation de release rappelle que ce
point n’est **pas dérogeable**. Un compte GitHub et une adresse de support
publique ne remplacent ni l’identité légale ni un canal privé.

## 5. Ce que chaque option doit publier

| Élément | Personne physique | Association | Société |
|---|---|---|---|
| Identité légale | Nom civil complet | Dénomination, RNA, SIREN le cas échéant | Raison sociale, forme, SIREN/RCS |
| Adresse | Adresse de contact ou siège, avec l’accord du conseil sur le domicile | Siège social | Siège social |
| Contact vie privée | Canal dédié, privé et durable | Canal dédié, privé et durable | Canal dédié, privé et durable |
| Représentant UE (art. 27) | Nom, adresse et contact si le responsable est hors UE | Idem | Idem |
| DPO (art. 37) | Nom et contact si désigné ; sinon mention d’absence après analyse | Idem | Idem |
| Mentions complémentaires | Le cas échéant, choix de domiciliation | RNA, statuts, représentant légal | SIREN/RCS, représentant légal |

Le contact vie privée doit permettre une demande d’accès, d’effacement, de
rectification, de limitation, d’opposition ou de portabilité sans publier de
notes, de messages, de photo, d’identifiant, de QR, de PIN ou de clé. Une issue
GitHub publique ne convient pas à une demande contenant des données
personnelles.

## 6. Représentant UE et DPO

### Représentant dans l’Union européenne (article 27)

Si le responsable n’est pas établi dans l’Union européenne et traite des
personnes qui s’y trouvent, l’article 27 impose en principe un représentant
établi dans un État membre où ces personnes se trouvent. Le représentant est
désigné par écrit, peut être contacté par les personnes concernées et par
l’autorité de contrôle, et son nom et ses coordonnées doivent figurer dans la
notice.

L’exception de l’article 27 vise notamment un traitement occasionnel, qui ne
porte pas sur des catégories particulières à grande échelle et qui ne présente
pas de risque élevé. Une application scolaire destinée à des mineurs, avec des
absences, des sanctions, des photos et des prompts IA, ne permet pas de
supposer cette exception : **le conseil doit l’examiner et l’écrire**. Si le
responsable est établi en France ou dans un autre État membre, aucun
représentant au titre de l’article 27 n’est requis, mais l’adresse
d’établissement reste à publier.

Le représentant UE n’est pas un DPO et ne transfère pas la responsabilité du
responsable. Pour des personnes au Royaume-Uni, un représentant UK GDPR peut
être distinct ; ce point est hors du périmètre de #831 mais doit être posé au
conseil si l’app y est distribuée.

### DPO (article 37)

Le DPO n’est obligatoire que dans les cas de l’article 37 : autorité publique,
activités de base impliquant un suivi régulier et systématique à grande échelle,
ou traitement à grande échelle de catégories particulières de données. Le
projet ne reçoit pas les données scolaires et n’exploite pas de serveur central
de scolarité ; cela ne dispense pas de documenter l’analyse, car l’app cible des
mineurs et peut traiter des données de santé ou de vie privée.

Si aucun DPO n’est désigné, la notice peut le dire après une analyse écrite ;
il ne faut pas présenter un contact de support comme un DPO. Si un DPO est
désigné, même volontairement, son contact doit être publié et sa désignation
notifiée à l’autorité de contrôle compétente (article 37(7)). Le conseil doit
confirmer la conclusion et la formulation.

## 7. Recommandation

**Recommandation proposée, à valider par un conseil et à trancher par une
personne :**

1. **Avant la release publique, retenir une association** établie dans l’Union
   européenne (en France, association loi 1901 ou forme équivalente) comme
   responsable du traitement pour le dépôt, les releases, le support et les
   traitements que le projet détermine. Publier sa dénomination, son siège, son
   numéro RNA et, le cas échéant, son SIREN, ainsi qu’un contact vie privée
   dédié. Aucun représentant UE n’est alors requis si l’association est établie
   dans l’Union ; le DPO ne l’est que si l’analyse de l’article 37 le conclut.
2. **Si le projet devient une activité commerciale** (vente, salariés, contrats
   importants), retenir une société et publier raison sociale, forme, siège,
   SIREN/RCS, représentant légal et contact vie privée.
3. **Le mainteneur personne physique** ne devrait être retenu que comme
   responsable intérimaire de développement ou de bêta fermée, avec une
   identité réelle, un contact qui répond, une adresse de contact validée et une
   analyse écrite du représentant UE et du DPO. Il n’est pas recommandé pour une
   release publique destinée à des mineurs.
4. **Dans tous les cas**, conserver l’établissement comme responsable des
   données scolaires qu’il héberge, ne pas laisser croire que le projet en
   détient une copie, puis remplacer la section 1 de la notice et retirer les
   points 1 et 2 de sa section 15. Faire valider la décision et la notice dans
   le cadre de [#976](https://github.com/iguanacucumber/veryslopnynotes/issues/976).

Cette recommandation privilégie l’association parce qu’elle donne une identité
légale et une adresse distinctes du domicile, une continuité au-delà d’un
mainteneur, et une structure adaptée à un logiciel libre non commercial. Une
société serait plus lourde sans activité commerciale ; une personne physique
reste la voie la plus simple pour le développement, mais expose davantage la
personne et ne règle pas la continuité.

## 8. Champs de décision

À remplir uniquement après une décision humaine et un avis du conseil. Un champ
vide n’est pas une réponse et ne doit pas être comblé par une supposition.

| Champ | Valeur (à remplir) | Référence ou preuve |
|---|---|---|
| Nom ou entité juridique | ____________________________________________ | |
| Forme juridique | ____________________________________________ | Personne physique, association, société, autre |
| Adresse ou siège | ____________________________________________ | |
| Contact vie privée | ____________________________________________ | Canal privé et durable, sans donnée scolaire |
| Représentant UE (art. 27) | ____________________________________________ | Aucun ou nom, adresse et contact |
| DPO (art. 37) | ____________________________________________ | Aucun ou nom et contact, avec analyse |
| Périmètre du rôle | ____________________________________________ | Dépôt, releases, support, traitement local |
| Décision prise par et date | ____________________________________________ | |
| Validation du conseil | ____________________________________________ | Nom, date et référence de l’avis |

## 9. Texte exact de remplacement de `PRIVACY.md` §1

Le bloc ci-dessous remplace intégralement le contenu actuel de
`## 1. Responsable du traitement et contact` dans [`PRIVACY.md`](../../PRIVACY.md).
Il ne doit être publié qu’une fois chaque `{{…}}` remplacé : un placeholder
visible n’est pas une notice valide.

```markdown
## 1. Responsable du traitement et contact

Le responsable du traitement est **{{NOM_OU_ENTITÉ}}**, {{FORME_JURIDIQUE}}, dont l’adresse est {{ADRESSE_OU_SIÈGE}}.

Contact vie privée : {{CONTACT_VIE_PRIVÉE}}. Pour une question de confidentialité, n’envoie pas de notes, de messages, de photo, d’identifiant, de QR, de PIN ou de clé. Pour une faille de sécurité, ne crée pas d’issue publique : suis `SECURITY.md`.

{{REPRÉSENTANT_UE}}

{{DPO}}
```

Substitutions obligatoires :

| Placeholder | Valeur exacte à insérer |
|---|---|
| `{{NOM_OU_ENTITÉ}}` | Nom civil ou dénomination légale, tel qu’il doit être publié |
| `{{FORME_JURIDIQUE}}` | Par exemple « personne physique », « association déclarée » ou la forme sociale retenue |
| `{{ADRESSE_OU_SIÈGE}}` | Adresse de contact ou siège social décidé |
| `{{CONTACT_VIE_PRIVÉE}}` | Canal privé dédié, avec la règle de non-envoi de données scolaires |
| `{{REPRÉSENTANT_UE}}` | Voir les deux formulations ci-dessous |
| `{{DPO}}` | Voir les deux formulations ci-dessous |

Si le responsable est établi dans l’Union européenne, insérer exactement :

> Aucun représentant dans l’Union européenne n’est requis : le responsable est établi dans l’Union européenne.

Si le responsable est établi hors de l’Union européenne, insérer exactement :

> Le responsable a désigné **{{NOM_REPRÉSENTANT_UE}}**, établi à {{ADRESSE_REPRÉSENTANT_UE}}, comme représentant dans l’Union européenne. Contact : {{CONTACT_REPRÉSENTANT_UE}}.

Si aucun DPO n’est désigné après l’analyse de l’article 37, insérer exactement :

> Aucun délégué à la protection des données n’est désigné.

Si un DPO est désigné, insérer exactement :

> Délégué à la protection des données : **{{NOM_DPO}}**, {{CONTACT_DPO}}.

Après la publication de la section 1, retirer les points 1 et 2 de la section 15
de `PRIVACY.md` : ils ne sont plus des points ouverts. Le lien vers ce dossier
peut rester comme trace de la préparation, mais la notice doit porter la
décision, pas le placeholder.

## 10. Validation et traçabilité

- La décision est prise par une personne identifiée, datée et archivée selon la
  procédure de [`SIGNOFF.md`](SIGNOFF.md), section « Archive de la copie
  signée ».
- Le conseil valide l’identité, le périmètre, le représentant UE, le DPO, le
  texte de la notice et les bases légales. Son nom, sa date et la référence de
  son avis remplissent le champ « Validation du conseil ».
- Une réponse orale, un commentaire d’issue ou une relecture d’ingénierie ne
  remplacent pas cette validation écrite.
- Le dossier est rattaché à [#831](https://github.com/iguanacucumber/veryslopnynotes/issues/831)
  et à [#976](https://github.com/iguanacucumber/veryslopnynotes/issues/976) ;
  il ne clôt ni l’un ni l’autre.

Vérification de forme : `bun test tests/architecture/controller-brief.test.ts`
et les liens relatifs sont couverts par `tests/architecture/docs.test.ts`. Aucun
test ne peut prouver une décision juridique ou une signature.
