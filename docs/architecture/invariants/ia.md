# Invariants — IA et contenu

> Détail du registre [`INVARIANTS.md`](../INVARIANTS.md). Une entrée par ID,
> dans l'ordre du registre ; ne lire que le fichier du thème concerné.

<a id="i4"></a>

## I4 — Le prompt LLM est vérifié, borné, et c'est celui qui part (ADR-003)
- Invariant : aucun secret dans un prompt — garde sur des FORMES (clé, JWT,
  en-tête, cookie, clé privée, entropie) — et le prompt VÉRIFIÉ est celui
  ENVOYÉ (`SafePromptProvider`). Une sortie texte/JSON mal formée est refusée,
  jamais réinterprétée. Le budget de tokens est DÉDUIT du plafond de caractères
  (`MAX_OUTPUT_CHARS` ÷ `CHARS_PER_TOKEN`, une constante) : le fournisseur ne
  produit pas ce que la garde jetterait. L'app appelle OpenRouter en HTTPS, clé
  dans `Authorization`, jamais le serveur. Un refus nomme la limite réelle, sans
  le secret.
- Test : `tests/unit/kotlin-llm-guard.test.ts`,
  `tests/unit/kotlin-llm-budget.test.ts`,
  `tests/unit/check-architecture-scan.test.ts`,
  `tests/unit/android-llm-catalogue.test.ts`,
  `tests/unit/android-homework.test.ts`, `tests/unit/android-revision.test.ts`.
- Commande : `make check`.
- Emplacement : `android/core/LlmGuard.kt`, `android/data/OpenRouterLlm.kt`.

<a id="i6"></a>

## I6 — Contenu externe = UNTRUSTED_DATA
- Invariant : tout contenu externe marqué `Untrusted` avant traitement IA, entre délimiteurs à nonce, déclaré donnée (`server/ai/` supprimé en #210 ; le marquage vit dans `android/core/Untrusted.kt`). Une pièce jointe nommée par le serveur ne sort jamais en type MIME **exécutable** (`text/html`, `image/svg+xml`, `application/xhtml+xml`…) : son type vient d'une table blanche bornée, le reste sort en `text/plain` ou `application/octet-stream` (#398).
- Test : `tests/architecture/invariants.test.ts` (I6) + `tests/unit/android-homework.test.ts` (miroirs) + `tests/unit/android-untrusted.test.ts` (Kotlin réel : marqueur non forgeable, #373) + `tests/unit/attachment-mime.test.ts` (Kotlin réel : type MIME d'une pièce jointe jamais exécutable, #398).
- Commande : `make check`.
- Emplacement : `android/core/Untrusted.kt`, `android/app/src/main/java/fr/veryslopnynotes/app/AttachmentMime.kt`.

<a id="i14"></a>

## I14 — « Invalide » n'est jamais « vide » (fail-closed / fail-open)
- Invariant : une sortie mal formée est REFUSÉE, jamais réinterprétée en valeur
  vide. Un champ `sources` qui n'est pas une liste ne veut pas dire « aucune
  source » : le corrigé est refusé (fail-closed sur la validation), sinon le
  texte sort comme un corrigé validé, sans sources. Symétriquement, un contrat
  de capabilities INVALIDE vaut « rien n'est affirmé » (`null`), JAMAIS une
  liste d'onglets vide : une liste vide AFFIRME « tous les onglets
  désactivés » et blackoute la navigation sur une panne (fail-open attendu :
  les onglets restent accessibles). Les deux notions restent distinctes :
  `sources` ABSENT ou `[]` = corpus vide (autorisé) ; `capabilities: null` =
  inconnu ; `capabilities: {tabs: []}` = contrat affirmé qui désactive tout.
  Même règle dans l'INTERFACE (#537) : un payload CORROMPU (JSON illisible)
  n'est pas une absence de donnée — l'écran Notes affiche une erreur (« cache
  illisible »), jamais « aucune note en cache », et un fil de messagerie
  illisible n'est jamais présenté comme « un fil vide ». Les parseurs
  restent TOLÉRANTS (aucun crash) : c'est l'écran qui distingue « illisible »
  de « vide ».
- Test : `tests/unit/kotlin-core-validation-parity.test.ts` (Kotlin EXÉCUTÉ :
  `sources: "abc"` refusé, contrat invalide → `null` et aucun onglet masqué) +
  `tests/web/home.test.ts` et `tests/web/social.test.ts` (web : `capabilities:
  null` = inconnu, la sanction reste visible) + `tests/web/grades.test.ts` et
  `tests/web/messages.test.ts` (écrans RENDUS : cache illisible = erreur, pas
  un état vide).
- Commande : `make check`.
- Emplacement : `android/core/Humanize.kt`, `android/core/CapabilityProbe.kt`,
  `android/core/Capabilities.kt`, `android/core/CapabilitiesJson.kt`,
  `android/data/PronotePayloads.kt`, `web/src/features/attendance/model.ts`,
  `web/src/features/grades/model.ts`, `web/src/features/messages/model.ts`.

<a id="i15"></a>

## I15 — L'export PDF d'une fiche garde le corps entier et ses sources
- Invariant : l'export PDF d'une fiche de révision rend le corps ENTIER
  (`RevisionPdf` pagine) et la liste CANONIQUE des sources (`sheet.sources`),
  jamais un bloc « Sources : » recopié du texte libre du modèle : une
  citation écrite par le modèle ne peut ni remplacer l'attribution ni
  introduire une source absente du corpus (citations validées comme le chemin
  devoirs, `HomeworkAi.parseHomeworkResponse`). Le bloc « Sources : » du modèle
  n'est retiré que s'il est le **dernier** bloc du corps : un « Sources : » au
  milieu (le cours en contient un, ou le modèle en cite un) ne mange plus le
  contenu qui suit — les puces qui ne sont pas des sources canoniques sont du
  CONTENU, elles restent (#499) ; une citation libre, elle, n'entre jamais dans
  la liste des sources. Une troncature — au-delà de
  la garde I5 (12 000 caractères) ou du filet de sécurité du rendu — est
  SIGNALÉE (« suite tronquée »), jamais silencieuse.
- Test : `tests/unit/kotlin-revision-sheet.test.ts` (Kotlin compilé : corps
  entier + bloc « Sources : » pour une fiche de 6 000 caractères, corps à
  « Sources : » qui ne remplace pas la liste canonique, troncature signalée).
- Commande : `make check`.
- Emplacement : `android/core/src/main/java/fr/veryslopnynotes/core/RevisionSheet.kt`,
  `android/core/src/main/java/fr/veryslopnynotes/core/RevisionPdf.kt`.

<a id="i25"></a>

## I25 — Une réponse périmée n'écrit pas dans l'écran
- Invariant : le payload d'une ressource est rattaché à sa requête (clé +
  query) ; changer de requête ou échouer invalide le payload précédent, jamais
  affiché sous le nouveau sélecteur. Une réponse qui arrive après un changement
  d'écran est PÉRIMÉE et n'écrit rien : un envoi de message ne peut écrire que
  dans le fil ouvert au départ, et un rechargement dépassé est ignoré. Le
  brouillon tapé pendant l'attente reste ; seul le brouillon envoyé part.
  Rafraîchir la MÊME requête garde le cache affiché (offline-first).
- Test : `tests/web/grades.test.ts`, `tests/web/messages.test.ts`.
- Commande : `make check`.
- Emplacement : `web/src/lib/resource.ts`,
  `web/src/features/messages/reply.ts`, `web/src/lib/seq.ts`.

<a id="i32"></a>

## I32 — Une photo ne part que sur geste explicite, ré-encodée et bornée
- Invariant : aucune photo n'est capturée ni envoyée automatiquement. Une
  capture part d'un bouton (« Prendre une photo » ou « Choisir une image »),
  jamais d'un rafraîchissement, d'un job de fond ou d'une sortie LLM. L'image
  est ré-encodée en JPEG (métadonnées EXIF supprimées), bornée à 1600 px et
  2 Mo, puis elle seule est envoyée au modèle vision — le texte du prompt
  reste soumis à la garde I4. L'image est OPAQUE : elle n'est pas scannable
  pour des secrets, d'où le geste explicite et l'avertissement affiché. Aucun
  octet d'image ne traverse le pont JS, n'est journalisé ou recopié dans un
  message d'erreur. Le fichier temporaire est supprimé après usage et la purge
  de compte efface `cacheDir/photos/`.
- Test : `tests/unit/kotlin-vision.test.ts` (Kotlin EXÉCUTÉ : types bitmap
  bornés, taille décodée, schéma de transcription, prompt Untrusted) +
  `tests/web/course-notes.test.ts` (le pont ne renvoie que du texte, l'écran exige
  un geste explicite) + `tests/unit/kotlin-vision.test.ts` (source :
  `PhotoPrep` ré-encode/borne, `LocalDataStore` purge les photos).
- Commande : `make check`.
- Emplacement : `android/app/PhotoCapture.kt`, `android/app/PhotoPrep.kt`,
  `android/app/VsnBridge.kt`, `android/core/Vision.kt`,
  `android/core/LessonAi.kt`, `android/core/HomeworkAi.kt`,
  `android/data/OpenRouterLlm.kt`, `android/data/LocalDataStore.kt`,
  `web/src/features/course-notes/CourseNotesScreen.tsx`,
  `web/src/features/tasks/TasksScreen.tsx`.

<a id="i35"></a>

## I35 — Le cours complet et les pièces jointes arrivent à l'IA, bornés et sans HTML rendu
- Invariant : les sources IA d'un devoir sont la consigne, tous les cours de
  la même matière + jour (borne signalée) et les pièces jointes extraites
  localement. Une pièce est résolue par le client local (jamais
  une URL d'établissement côté web), téléchargée dans le cache du compte
  (borné, purgé avec lui), puis lue sans réseau : texte/markdown, HTML
  désinfecté (balises et blocs actifs retirés, aucun rendu), PDF texte, image
  via le chemin vision. Les bornes (octets, pages, caractères, nombre) sont
  déclarées et toute coupe est signalée. Un format illisible ou un MIME
  exécutable devient une source nommée « (illisible) » avec sa raison ; l'OCR
  d'un PDF scanné n'est pas disponible et le dit. Le texte reste Untrusted (I6).
- Test : `tests/unit/attachment-text.test.ts` (Kotlin EXÉCUTÉ sur fixtures
  synthétiques : texte, markdown, HTML désinfecté, PDF texte, PDF scanné, format
  inconnu, MIME exécutable, coupes de caractères et de pages ; un devoir avec un
  cours long et une PJ texte produit des sources > 500 caractères, la PJ y
  figure ; câblage du pont vérifié).
- Commande : `make check`.
- Emplacement : `android/data/AttachmentText.kt`,
  `android/core/AssignmentContext.kt`, `android/core/Assignment.kt`,
  `android/data/PronotePayloads.kt`, `android/data/AssignmentsRepository.kt`,
  `android/app/VsnBridge.kt`.
