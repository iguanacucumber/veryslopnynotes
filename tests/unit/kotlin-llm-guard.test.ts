// #409 : la garde I4 doit viser des FORMES de secret, pas des mots.
//
// AVANT : cinq littéraux sensibles à la casse. Un cours de maths (ou une
// question d'élève) qui MENTIONNE « BEGIN PRIVATE KEY » était refusé, et la
// cause était avalée (« Échec de l'assistant. ») ; à l'inverse un JWT, un
// en-tête `Bearer …` ou une clé en base64 passaient.
//
// Ce test ne Miroite pas la logique : il COMPILE la VRAIE source de production
// (`android/core/.../LlmGuard.kt`) et la pilote via
// `agents/runtime/kotlin-parity/LlmGuardParityMain.kt`. Les assertions portent
// donc sur du code exécuté.
//
// AUCUN secret n'est écrit en clair dans ce fichier : les faux secrets sont
// ASSEMBLÉS à l'exécution (le scan anti-secrets refuse les formes contiguës,
// et un dépôt public n'a pas de secret à exposer).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "LlmGuardParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface Verdict {
  ok?: boolean;
  kind?: string;
  label?: string;
  message?: string;
  refusal?: string;
  error?: string;
}

// --- Faux secrets, ASSEMBLÉS à l'exécution ---------------------------------

/** Préfixe d'une clé de fournisseur (jamais écrit en clair). */
const KEY_PREFIX = ["sk", "or", "v1"].join("-") + "-";
const FAKE_KEY = KEY_PREFIX + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z5";

/** JWT : trois segments base64url, le premier en base64 de `{`. */
const FAKE_JWT = [
  ["ey", "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"].join(""),
  ["ey", "JzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkVsInZ1ZSJ9"].join(""),
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
].join(".");

/** En-tête d'autorisation : un jeton opaque, pas un JWT. */
const FAKE_BEARER = "A1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvWxYz012345";
const FAKE_AUTH = ["Authorization: Bear", "er ", FAKE_BEARER].join("");

/** Bloc de clé privée : en-tête PEM + corps base64. */
const FAKE_PEM = [
  ["-", "-", "-", "-", "-"].join(""),
  "BEGIN ",
  "PRIVATE ",
  "KEY",
  ["-", "-", "-", "-", "-"].join(""),
  "\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7T8uF2mN4pQ6rS8tU0vW2xY4zA6b8D0eF2gH4iJ6kL8mN0oP2qR4sU6wY8",
].join("");

/** Affectation d'une variable d'environnement sensible. */
const FAKE_ENV = ["export OPENROUTER_", "API_KEY=", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z5"].join("");

/** Cookie de session. */
const FAKE_COOKIE = ["Cookie: sessionid=", "aB3dE5fG7hJ9kL1mN3pQ5rS7"].join("");

/** Chaîne base64 à forte entropie (trois classes de caractères). */
const FAKE_OPAQUE = "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z5A7b9C1d3E5f7G9h1J3k5L7m9N0p2Q4r";

/**
 * Contenus LÉGITIMES : un cours, une question d'élève, un exemple de shell.
 *
 * Aucun n'a la FORME d'un secret : ils doivent tous passer.
 */
const LEGITIMES: string[] = [
  // Le cas de l'issue : un cours qui MENTIONNE le mot-clé n'est pas une clé.
  "Explique la différence entre une clé privée (BEGIN PRIVATE KEY) et une clé publique.",
  "Qu'est-ce qu'une clé privée ? À quoi sert-elle dans un certificat ?",
  // Un mot-clé, une variable, un mot de cours : rien de la forme d'un secret.
  "Comment fonctionne un JWT ? On lit le header, le payload et la signature.",
  "le token de session expire au bout de 30 minutes",
  "export PATH=/usr/local/bin",
  "export API_KEY=your-api-key-here",
  "Calculer l'intégrale de f(x) = 3x^2 + 2x - 5 entre 0 et 2.",
  "Le réseau est en CIDR /24 : combien d'adresses utilisables ?",
  "En Python, comment lire un fichier CSV avec le module csv ?",
  "Le théorème de Pythagore : dans un triangle rectangle, c² = a² + b².",
  "Le protocole HTTPS utilise le port 443 et TLS 1.3.",
  // Une empreinte n'est pas une clé : la garde vise les secrets, pas les
  // empreintes (plafond assumé, cf. `looksLikeOpaqueSecret`).
  "Une empreinte SHA-256 fait 64 caractères : 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  // Une variable d'environnement, pas un secret.
  "export PATH=$PATH:/usr/local/bin",
  // Un exemple de documentation : un en-tête, un placeholder, une consigne.
  "Authorization : Bearer <votre-token>",
  "Mot de passe : ne le partage jamais.",
  // #493 : un paramètre de URL n'est pas une affectation de variable (c'est
  // la forme d'un exemple de doc, pas d'un secret collé dans un cours).
  "L'API se lit ainsi : https://api.exemple.fr/eleves?token=aB3dE5fG7hJ9kL1mN3pQ5rS7",
];

async function ask(op: "prompt" | "output", text: string): Promise<Verdict> {
  return JSON.parse(await link!.ask({ op, text }, { allowError: true })) as Verdict;
}

describe("garde I4 : des FORMES de secret, pas des mots (#409)", () => {
  test.skipIf(skip)("un cours qui MENTIONNE un mot-clé n'est PAS un secret", async () => {
    for (const texte of LEGITIMES) {
      const r = await ask("prompt", texte);
      expect({ texte: texte.slice(0, 24), kind: r.kind, error: r.error }).toEqual({
        texte: texte.slice(0, 24),
        kind: undefined,
        error: undefined,
      });
      expect(r.ok).toBe(true);
    }
  });

  test.skipIf(skip)("un JWT est détecté", async () => {
    const r = await ask("prompt", "Voici mon jeton : " + FAKE_JWT);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("JWT");
  });

  test.skipIf(skip)("un en-tête d'autorisation (Bearer …) est détecté", async () => {
    const r = await ask("prompt", "Authorization: " + ["Bear", "er "].join("") + FAKE_BEARER);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("AUTHORIZATION");
  });

  test.skipIf(skip)("une clé de préfixe connu est détectée", async () => {
    const r = await ask("prompt", "ma clé c'est " + FAKE_KEY);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("API_KEY");
  });

  test.skipIf(skip)("une affectation de variable sensible est détectée", async () => {
    const r = await ask("prompt", FAKE_ENV);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("ENV_ASSIGN");
  });

  // #493 : l'affectation n'est plus cantonnée au DÉBUT de ligne. La valeur
  // fait 30 caractères (donc `RE_OPAQUE`, qui en exige 40, ne peut pas la
  // prendre) : seul `RE_ENV` peut la voir.
  test.skipIf(skip)("une affectation sensible en MILIEU de ligne est détectée", async () => {
    const r = await ask("prompt", ["mon cours utilise GITHUB_", "TOKEN=aB3dE5fG7hJ9kL1mN3pQ5rS7"].join(""));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("ENV_ASSIGN");
  });

  test.skipIf(skip)("un cookie de session est détecté", async () => {
    const r = await ask("prompt", FAKE_COOKIE);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("SESSION_COOKIE");
  });

  test.skipIf(skip)("un bloc de clé privée est détecté", async () => {
    const r = await ask("prompt", FAKE_PEM);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("PRIVATE_KEY");
  });

  test.skipIf(skip)("une chaîne à forte entropie est détectée", async () => {
    const r = await ask("prompt", FAKE_OPAQUE);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("OPAQUE");
  });

  test.skipIf(skip)("un en-tête d'autorisation sans schéma est détecté", async () => {
    // « Authorization: <jeton opaque> » : la forme vaut aussi sans « Bearer ».
    const r = await ask("prompt", ["Authorization: ", FAKE_BEARER].join(""));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("ENV_ASSIGN");
  });

  test.skipIf(skip)("une affectation « nom: valeur » est détectée", async () => {
    const r = await ask("prompt", ["PRONOTE_", "PASSWORD: ", "aB3dE5fG7hJ9kL1mN3pQ5rS7"].join(""));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("ENV_ASSIGN");
  });

  test.skipIf(skip)("une clé privée échappée (dans du JSON) est détectée", async () => {
    // Le corps d'un PEM peut être colle avec un « \\n » echappe : la forme
    // reste celle d'une cle.
    const r = await ask("prompt", FAKE_PEM.replace("\n", "\\n"));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("PRIVATE_KEY");
  });

  test.skipIf(skip)("la sortie du modèle est gardée aussi", async () => {
    const r = await ask("output", "Voici ton jeton : " + FAKE_JWT);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("JWT");
    // Une sortie normale passe.
    expect((await ask("output", "Voici la correction : 3x = 6, donc x = 2.")).ok).toBe(true);
  });
});

describe("refuser en expliquant (#409)", () => {
  const CAS: { secret: string; kind: string }[] = [
    { secret: FAKE_JWT, kind: "JWT" },
    { secret: FAKE_AUTH, kind: "AUTHORIZATION" },
    { secret: FAKE_KEY, kind: "API_KEY" },
    { secret: FAKE_ENV, kind: "ENV_ASSIGN" },
    { secret: FAKE_COOKIE, kind: "SESSION_COOKIE" },
    { secret: FAKE_PEM, kind: "PRIVATE_KEY" },
    { secret: FAKE_OPAQUE, kind: "OPAQUE" },
  ];

  test.skipIf(skip)("le refus dit le TYPE du secret et JAMAIS le secret", async () => {
    for (const c of CAS) {
      const r = await ask("prompt", c.secret);
      expect(r.kind).toBe(c.kind);
      // Le message porte la cause (I4 + le type)…
      expect(r.message).toContain("I4");
      expect(r.label).toBeTruthy();
      // …et NE recopie JAMAIS le secret, ni un fragment de lui.
      for (const extrait of [c.secret, c.secret.slice(0, 24), c.secret.slice(-16)]) {
        expect(r.message).not.toContain(extrait);
        expect(r.refusal).not.toContain(extrait);
      }
    }
  });

  test.skipIf(skip)("la phrase affichée est bornée et en français", async () => {
    const r = await ask("prompt", FAKE_JWT);
    expect(r.refusal).toBeTruthy();
    expect(r.refusal!.length).toBeLessThanOrEqual(200);
    expect(r.refusal).toMatch(/[éèêàç]/);
    // Pas de code HTTP, pas d'URL, pas de nom de variable d'environnement.
    expect(r.refusal).not.toMatch(/https?:\/\//);
    expect(r.refusal).not.toMatch(/[A-Z_]{4,}=/);
  });
});

describe("le câblage ne ravale plus la cause (#409)", () => {
  const data = codeOnly(readFileSync(join(DATA, "OpenRouterLlm.kt"), "utf8"));
  const bridge = codeOnly(readBridgeSource());
  const core = codeOnly(readFileSync(join(CORE, "LlmGuard.kt"), "utf8"));

  test("le module data remonte le refus de secret, pas « hors format »", () => {
    // La branche SECRET passe AVANT le repli `AiError` (qui dirait
    // « Réponse de l'assistant hors format ») : l'élève voit la cause.
    const secret = data.indexOf("catch (e: SecretDetectedException)");
    const format = data.indexOf("catch (_: AiError)");
    expect(secret).toBeGreaterThan(-1);
    expect(format).toBeGreaterThan(-1);
    expect(secret).toBeLessThan(format);
    expect(data).toContain("secretRefusalMessage(e.kind)");
  });

  test("le pont (fiches de révision) fait de même", () => {
    const secret = bridge.indexOf("catch (e: SecretDetectedException)");
    expect(secret).toBeGreaterThan(-1);
    expect(bridge.slice(secret, secret + 400)).toContain("secretRefusalMessage(e.kind)");
  });

  test("la garde n'est plus une liste de mots, mais des formes", () => {
    // L'ancienne liste de cinq littéraux a disparu…
    expect(core).not.toContain("SECRET_RE");
    expect(core).not.toContain("SECRET_F1");
    // …et la détection porte sur des FORMES (préfixe, en-tête, JWT, PEM…).
    expect(core).toContain("SecretKind");
    expect(core).toContain("detectSecret");
    for (const forme of ["PRIVATE_KEY", "AUTHORIZATION", "JWT", "SESSION_COOKIE", "ENV_ASSIGN"]) {
      expect(core).toContain(forme);
    }
  });

  // #493 : le prompt VÉRIFIÉ par la garde doit être le prompt ENVOYÉ. Avant,
  // `callProvider` acceptait un `LlmProvider` et, si ce n'était pas un
  // `SafePromptProvider`, RECONSTRUISAIT le prompt (nouveau nonce) : le corps
  // envoyé n'était alors pas le corps vérifié.
  test("le fournisseur est un SafePromptProvider : plus de reconstruction du prompt", () => {
    // Le type porte la garantie : le point d'entrée exige un
    // `SafePromptProvider`.
    expect(core).toMatch(/fun generateGuardedJson\(\s*provider: SafePromptProvider/);
    // Et le repli « reconstruct » a disparu.
    expect(core).not.toContain("provider.generate(");
    expect(core).not.toContain("as? SafePromptProvider");
    // L'ancien contrat `LlmProvider` (system + data) n'existe plus : il
    // reconstruisait le prompt.
    expect(core).not.toContain("fun interface LlmProvider");
    // L'adaptateur réel n'implémente que le chemin sûr.
    const openRouter = codeOnly(
      readFileSync(
        join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data", "OpenRouterLlm.kt"),
        "utf8",
      ),
    );
    expect(openRouter).toContain(": SafePromptProvider");
    expect(openRouter).not.toContain("override fun generate(");
  });
});
