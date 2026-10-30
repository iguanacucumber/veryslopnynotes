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
- Invariant : une sortie mal formée est REFUSÉE, jamais réinterprétée en valeur vide. Un champ `sources` non-liste est refusé (fail-closed). Capabilities invalide = `null` (« rien n'est affirmé »), jamais liste d'onglets vide (qui affirmerait « tous désactivés »). `sources` ABSENT/`[]` = corpus vide ; `capabilities: null` = inconnu ; `capabilities: {tabs: []}` = contrat affirmé désactivant tout. Payload corrompu (JSON illisible) → erreur, jamais état vide. Parseurs tolérants : l'écran distingue « illisible » de « vide ».
- Test : `tests/unit/kotlin-core-validation-parity.test.ts`, `tests/web/home.test.ts`, `tests/web/social.test.ts`, `tests/web/grades.test.ts`, `tests/web/messages.test.ts`.
- Commande : `make check`.
- Emplacement : `android/core/Humanize.kt`, `android/core/CapabilityProbe.kt`,
  `android/core/Capabilities.kt`, `android/core/CapabilitiesJson.kt`,
  `android/data/PronotePayloads.kt`, `web/src/features/attendance/model.ts`,
  `web/src/features/grades/model.ts`, `web/src/features/messages/model.ts`.

<a id="i15"></a>

## I15 — L'export PDF d'une fiche garde le corps entier et ses sources
- Invariant : l'export PDF rend le corps ENTIER (`RevisionPdf` pagine) et la liste CANONIQUE des sources (`sheet.sources`), jamais un bloc « Sources : » recopié du modèle. Une citation du modèle ne remplace pas l'attribution ni n'introduit une source absente. Tout bloc « Sources » du modèle, final ou au milieu, est retiré jusqu'à la première ligne vide ou non-source ; le cours suivant reste entier. Une troncature (au-delà de I5, 12 000 caractères, ou du filet de rendu) est SIGNALÉE, jamais silencieuse.
- Test : `tests/unit/kotlin-revision-sheet.test.ts`
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
- Invariant : aucune photo capturée ni envoyée automatiquement : la capture part d'un geste explicite, jamais d'un rafraîchissement, job de fond ou sortie LLM. L'image est ré-encodée en JPEG, bornée à 1600 px et 2 Mo, envoyée seule au modèle vision (prompt sous I4). L'image est OPAQUE : pas de scan de secrets, pas de pont JS, pas de journal, pas d'octet dans une erreur. Fichier temporaire supprimé après usage ; purge de compte efface `cacheDir/photos/`.
- Test : `tests/unit/kotlin-vision.test.ts`, `tests/web/course-notes.test.ts`
- Commande : `make check`.
- Emplacement : `android/app/PhotoCapture.kt`, `android/app/PhotoPrep.kt`,
  `android/core/Vision.kt`, `android/core/LessonAi.kt`,
  `android/data/OpenRouterLlm.kt`, `android/data/LocalDataStore.kt`,
  `web/src/features/course-notes/CourseNotesScreen.tsx`.

<a id="i35"></a>

## I35 — Le cours complet et les pièces jointes arrivent à l'IA, bornés et sans HTML rendu
- Invariant : les sources IA d'un devoir = consigne, tous les cours de la même matière + jour et pièces jointes extraites localement. Une pièce est résolue par le client local, téléchargée dans le cache du compte (borné, purgé avec lui), lue sans réseau : texte/markdown, HTML désinfecté, PDF texte, image via le chemin vision. Bornes déclarées, toute coupe signalée. Format illisible ou MIME exécutable → source nommée « (illisible) » avec sa raison. OCR d'un PDF scanné indisponible et dit. Le texte reste Untrusted.
- Test : `tests/unit/attachment-text.test.ts`
- Commande : `make check`.
- Emplacement : `android/data/AttachmentText.kt`,
  `android/core/AssignmentContext.kt`, `android/core/Assignment.kt`,
  `android/app/VsnBridge.kt`.
