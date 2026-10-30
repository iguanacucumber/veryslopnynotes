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
 * Contenu EMBARQUÉ d'un cours HTML/NSI : le base64 d'une image a la FORME
 * d'une chaîne opaque (trois classes, entropie haute) mais c'est une donnée.
 */
const FAKE_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAYAAAByDd+UAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJ";
const DATA_URI_IMAGE = '<img src="data:image/png;base64,' + FAKE_IMAGE_BASE64 + '">';

/** Caractères de FORMAT Unicode, invisibles : ils coupent une forme contiguë. */
const ZWSP = "\u200B";
const ZWNJ = "\u200C";
/** Marques non-`Cf` : combinateur CGJ et sélecteur de variation VS16 (`Mn`). */
const CGJ = "\u034F";
const VS16 = "\uFE0F";

/**
 * Lettres cyrilliques/grecques qui ONT L'APPARENCE d'une lettre ASCII.
 * Écrites en échappements : le fichier reste ASCII. Le `р` cyrillique est le
 * sosie de `p` (pas de `r`) : « Веаrеr » mélange cyrillique et latin.
 */
const CYRILLIC_BEARER = ["\u0412", "\u0435", "\u0430", "r", "\u0435", "r"].join("");
const CYRILLIC_S = "\u0455"; // ѕ : le `s` de `sk-or-v1-`.

/** Valeur à la FORME d'un secret (3 classes, entropie haute), jamais réelle. */
const SECRET_VALUE = ["aB3dE5", "fG7hJ9", "kL1mN3", "pQ5rS7", "tU9vW1", "xY3z5"].join("");

/** Corps de clé assez long pour le préfixe, assez court pour rester < 40. */
const KEY_BODY = ["aB3dE5", "fG7hJ9", "kL1mN3", "pQ5rS7"].join("");

/** JWT court : aucun segment n'atteint 40 caractères (donc pas d'OPAQUE). */
const FAKE_SHORT_JWT = [
  ["ey", "JhbGciOiJIUzI1NiJ9"].join(""),
  ["ey", "JzdWIiOiIxMjM0NTY3ODkwIn0"].join(""),
  "c2lnbmF0dXJlMTIzNDU2Nzg5MA",
].join(".");

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

describe("le contenu embarqué et les caractères invisibles (I4)", () => {
  test.skipIf(skip)("une image de cours en data: URI est acceptée", async () => {
    // Faux positif vécu : le base64 d'une image a la forme d'une chaîne
    // opaque, l'élève était invité à retirer un secret qu'il n'avait pas.
    const r = await ask("prompt", DATA_URI_IMAGE);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    // Le marqueur se lit sans tenir compte de la casse.
    const majuscules = await ask("prompt", '<img src="data:image/png;BASE64,' + FAKE_IMAGE_BASE64 + '">');
    expect(majuscules.ok).toBe(true);
  });

  test.skipIf(skip)("un opaque arbitraire après data:...;base64, reste refusé", async () => {
    // `data:` n'est pas un laissez-passer : sans signature de format connu,
    // le run garde la forme d'un identifiant secret.
    const r = await ask("prompt", '<img src="data:image/png;base64,' + FAKE_OPAQUE + '">');
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("OPAQUE");
  });

  test.skipIf(skip)("le même base64 hors data: URI reste refusé", async () => {
    // L'exemption tient au CONTEXTE (`data:` + `base64,`), pas au contenu :
    // un identifiant opaque collé seul reste un secret.
    const r = await ask("prompt", FAKE_IMAGE_BASE64);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("OPAQUE");
  });

  test.skipIf(skip)("un en-tête d'autorisation coupé par un invisible est refusé", async () => {
    // Jeton court : sans cela `RE_OPAQUE` verrait le jeton seul (≥ 40) et le
    // verdict serait OPAQUE, pas AUTHORIZATION.
    const r = await ask("prompt", "Authorization: Bear" + ZWSP + "er " + "aB3dE5fG7hJ9kL1mN3pQ5rS7");
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("AUTHORIZATION");
  });

  test.skipIf(skip)("une clé de préfixe connu coupée par un invisible est refusée", async () => {
    const r = await ask("prompt", "ma clé c'est " + KEY_PREFIX + ZWSP + FAKE_KEY.slice(KEY_PREFIX.length));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("API_KEY");
  });

  test.skipIf(skip)("une affectation sensible coupée par un invisible est refusée", async () => {
    // L'invisible est DANS le nom : le brut ne voit pas de variable sensible,
    // la copie normalisée si.
    const r = await ask("prompt", "PRONOTE_PASS" + ZWSP + "WORD=" + "aB3dE5fG7hJ9kL1mN3pQ5rS7");
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("ENV_ASSIGN");
  });

  test.skipIf(skip)("un JWT coupé par un invisible est refusé (prompt et sortie)", async () => {
    const pieces = FAKE_SHORT_JWT.split(".");
    const casse = [pieces[0], pieces[1] + ZWNJ, pieces[2]].join(".");
    const r = await ask("prompt", "mon jeton : " + casse);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("JWT");
    const out = await ask("output", "Voici ton jeton : " + casse);
    expect(out.ok).toBe(false);
    expect(out.kind).toBe("JWT");
  });

  test.skipIf(skip)("un invisible dans un texte anodin ne déclenche rien", async () => {
    const r = await ask("prompt", "Bonjour" + ZWSP + ", explique la photosynthèse.");
    expect(r.ok).toBe(true);
  });
});

describe("noms sensibles camelCase et kebab-case (I4)", () => {
  test.skipIf(skip)("un nom collé en camelCase est reconnu", async () => {
    for (const nom of ["dbPassword", "refreshToken", "clientSecret", "apiKey"]) {
      const r = await ask("prompt", nom + "=" + SECRET_VALUE);
      expect({ nom, kind: r.kind }).toEqual({ nom, kind: "ENV_ASSIGN" });
      expect(r.ok).toBe(false);
    }
  });

  test.skipIf(skip)("un nom kebab-case est reconnu", async () => {
    const r = await ask("prompt", "github-token=" + SECRET_VALUE);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("ENV_ASSIGN");
  });

  test.skipIf(skip)("les formes SNAKE_CASE restent refusées", async () => {
    for (const nom of ["GITHUB_TOKEN", "DB_PASSWORD"]) {
      const r = await ask("prompt", nom + "=" + SECRET_VALUE);
      expect({ nom, kind: r.kind }).toEqual({ nom, kind: "ENV_ASSIGN" });
    }
  });

  test.skipIf(skip)("un paramètre de URL reste un exemple de doc, pas une affectation", async () => {
    const r = await ask("prompt", "Voir https://api.exemple.fr/eleves?token=" + KEY_BODY);
    expect(r.ok).toBe(true);
  });
});

describe("secrets coupés par du blanc (I4)", () => {
  test.skipIf(skip)("une clé de préfixe connu coupée par des blancs est refusée", async () => {
    for (const sep of ["\n", " "]) {
      const coupee = [KEY_PREFIX, "a1B2c3D4e5F6g7H8", "i9J0k1L2m3N4o5P6"].join(sep);
      const r = await ask("prompt", "ma clé :" + sep + coupee);
      expect({ sep, kind: r.kind }).toEqual({ sep, kind: "API_KEY" });
    }
  });

  test.skipIf(skip)("une affectation sensible dont la valeur est à la ligne est refusée", async () => {
    const r = await ask("prompt", ["PRONOTE_", "PASSWORD=\n", SECRET_VALUE].join(""));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("ENV_ASSIGN");
  });

  test.skipIf(skip)("un JWT dont le premier segment est à la ligne est refusé", async () => {
    const segments = FAKE_SHORT_JWT.split(".");
    const tete = segments[0]!;
    const coupe = [tete.slice(0, 3), "\n" + tete.slice(3) + "." + segments.slice(1).join(".")].join("");
    const r = await ask("prompt", "mon jeton : " + coupe);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("JWT");
  });

  test.skipIf(skip)("un jeton Bearer coupé par un saut de ligne est refusé", async () => {
    // Premier morceau sous 16 caractères : le motif strict ne peut pas le
    // voir, seule la forme compactée est un jeton.
    const r = await ask(
      "prompt",
      ["Authorization: Bear", "er ", "A1b2C3d4E", "\n", "F5g6H7i8J9k0L1mN2o3P4q5R6"].join(""),
    );
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("AUTHORIZATION");
  });

  test.skipIf(skip)("une prose multiligne ne devient pas un run opaque", async () => {
    for (const texte of [
      "Le protocole HTTPS\nutilise le port 443\net TLS 1.3.",
      "Les clés OpenRouter commencent par sk-or-v1- puis un corps opaque.",
      "Le token\nde session reste\nsur le téléphone.",
      "L'en-tête Bearer OAuth2 Authentication tokens décrit un schéma.",
    ]) {
      const r = await ask("prompt", texte);
      expect({ texte, kind: r.kind }).toEqual({ texte, kind: undefined });
      expect(r.ok).toBe(true);
    }
  });
});

describe("marques invisibles non-Cf et écriture décomposée (I4)", () => {
  test.skipIf(skip)("un CGJ dans un schéma est retiré pour le scan", async () => {
    const r = await ask("prompt", "Authorization: Bear" + CGJ + "er " + SECRET_VALUE);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("AUTHORIZATION");
  });

  test.skipIf(skip)("un VS16 dans un préfixe de clé est retiré pour le scan", async () => {
    const prefixe = KEY_PREFIX.slice(0, -1) + VS16 + "-";
    const r = await ask("prompt", "ma clé " + prefixe + FAKE_KEY.slice(KEY_PREFIX.length));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("API_KEY");
  });

  test.skipIf(skip)("un VS16 dans un nom de variable est retiré pour le scan", async () => {
    const r = await ask("prompt", "PRONOTE_PASS" + VS16 + "WORD=" + KEY_BODY);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("ENV_ASSIGN");
  });

  test.skipIf(skip)("un é décomposé reste du texte légitime", async () => {
    // NFKC compose e + accent aigu : retirer les Mn ne doit pas produire un
    // faux positif sur un cours accentué.
    const r = await ask("prompt", "Le caf\u0065\u0301 et l'\u00e9l\u00e8ve : explique la photosynth\u0065\u0300se.");
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  test.skipIf(skip)("un VS16 dans une phrase anodine ne déclenche rien", async () => {
    const r = await ask("prompt", "Bonjour" + VS16 + ", explique la photosynthèse.");
    expect(r.ok).toBe(true);
  });
});

describe("homoglyphes cyrilliques/grecs (I4)", () => {
  test.skipIf(skip)("un schéma Bearer en cyrillique est replié puis refusé", async () => {
    const r = await ask("prompt", CYRILLIC_BEARER + " " + SECRET_VALUE);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("AUTHORIZATION");
  });

  test.skipIf(skip)("un préfixe de clé dont le s est cyrillique est replié puis refusé", async () => {
    const r = await ask(
      "prompt",
      "ma clé " + CYRILLIC_S + KEY_PREFIX.slice(1) + KEY_BODY,
    );
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("API_KEY");
  });

  test.skipIf(skip)("du texte cyrillique ordinaire reste accepté", async () => {
    const r = await ask("prompt", "Привет, объясни теорему Пифагора.");
    expect(r.ok).toBe(true);
  });
});

describe("du code légitime n'est pas une affectation de secret (I4)", () => {
  test.skipIf(skip)("un appel ou un attribut pointé n'est pas un littéral secret", async () => {
    for (const texte of [
      "token = secrets.token_hex(16)",
      "session = requests.Session()",
      "auth = OAuth2Session(client_id, redirect_uri=url)",
      "apiKey = config.apiKey",
    ]) {
      const r = await ask("prompt", texte);
      expect({ texte, kind: r.kind }).toEqual({ texte, kind: undefined });
      expect(r.ok).toBe(true);
    }
  });

  test.skipIf(skip)("un littéral affecté à un nom sensible reste refusé", async () => {
    for (const texte of [
      'password = "Xk9mQ2vB7nL4pR8s"',
      "API_KEY=Xk9mQ2vB7nL4pR8sT1uV2wX3",
      "GITHUB_TOKEN=" + SECRET_VALUE,
    ]) {
      const r = await ask("prompt", texte);
      expect({ texte, kind: r.kind }).toEqual({ texte, kind: "ENV_ASSIGN" });
    }
  });
});

describe("URI data: des formats de cours non-PNG (I4)", () => {
  const TAIL = SECRET_VALUE + "A7b9C1d3E"; // 40 caractères : forme opaque
  const uri = (mime: string, signature: string) =>
    '<img src="data:' + mime + ";base64," + signature + TAIL + '">';

  const SIGNATURES: { mime: string; sig: string }[] = [
    { mime: "image/avif", sig: "AAAAIGZ0eXBhdmlm" },
    { mime: "audio/ogg", sig: "T2dnUw" },
    { mime: "audio/mpeg", sig: "SUQz" },
    { mime: "audio/mpeg", sig: "//u" },
    { mime: "font/woff2", sig: "d09GMg" },
    { mime: "font/woff2", sig: "wOF2" },
    { mime: "video/mp4", sig: "AAAAIGZ0eXBpc29t" },
  ];

  test.skipIf(skip)("chaque signature connue est acceptée", async () => {
    for (const { mime, sig } of SIGNATURES) {
      const r = await ask("prompt", uri(mime, sig));
      expect({ mime, sig, kind: r.kind }).toEqual({ mime, sig, kind: undefined });
      expect(r.ok).toBe(true);
    }
  });

  test.skipIf(skip)("un data:text/plain;base64, lisible est accepté", async () => {
    const texte = "Le protocole HTTPS utilise le port 443 et TLS 1.3. Le réseau est en CIDR /24.";
    const b64 = Buffer.from(texte, "utf8").toString("base64");
    const r = await ask("prompt", '<a href="data:text/plain;base64,' + b64 + '">cours</a>');
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  test.skipIf(skip)("un opaque illisible après data:text/plain;base64, reste refusé", async () => {
    const r = await ask("prompt", '<a href="data:text/plain;base64,' + FAKE_OPAQUE + '">x</a>');
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("OPAQUE");
  });

  test.skipIf(skip)("une signature inconnue reste refusée", async () => {
    const r = await ask("prompt", uri("image/png", "ZWxsaW5r"));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("OPAQUE");
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
