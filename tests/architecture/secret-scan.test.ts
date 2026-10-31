// Le carve-out `.agents/` ne doit pas devenir une passoire : un vrai secret y
// échoue, les exemples de documentation des skills passent.
//
// Test des MOTIFS (source partagée avec `check-secrets.ts`) ; le scan du disque
// est fait par `make lint`. Les faux secrets sont assemblés par fragments : le
// scan passe aussi sur `tests/`, un littéral entier le ferait échouer lui-même.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchPatterns, PATTERNS, patternsFor, VENDORED_PATTERNS } from "../../agents/runtime/secret-patterns";

const ROOT = join(import.meta.dir, "..", "..");

const VENDORED = patternsFor(".agents/skills/code-review/SKILL.md");
const REPO = patternsFor("web/src/App.tsx");

const pemHeader = ["-----BEGIN ", "RSA PRIVATE KEY", "-----"].join("");
const pemHeaderBare = ["-----BEGIN ", "RSA PRIVATE KEY", "-----"].join("");
const pemDoc = ["-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?", "-----"].join("");
const pemInline = ['private_key = "', pemHeaderBare, '"'].join("");
const awsExample = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const stateDoc = ["storage", "State: '.auth/session.json'"].join("");
const stateEmpty = ["storage", "State: { cookies: [], origins: [] }"].join("");
const mockToken = ["const mock", "Token = 'test-verification-abc123';"].join("");

const realPEM = [pemHeader, "\nMIIEowIBAAKCAQEAy8Dbv8prpJ/0kKhlGeJYozo2t60EG8L0361N9W\n", "-----END RSA PRIVATE KEY-----"].join("");
const ghToken = ["gh", "p_abcdefghijklmnopqrstuvwxyz0123456789"].join("");
const slackToken = ["xo", "xb-123456789012-abcdefghijklmnop"].join("");
const awsKey = ["AK", "IA1234567890ABCDEF"].join("");
const realState = ['{"cookies":[{"name":"session","value":"abc"}]}'].join("");
const credLiteral = ['api', '_key = "aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY"'].join("");

describe("scan anti-secrets : carve-out .agents", () => {
  test("le dépôt propre garde le jeu strict", () => {
    expect(REPO).toBe(PATTERNS);
    // Dans le dépôt, un en-tête PEM seul suffit (jeu strict).
    expect(matchPatterns(pemHeader, REPO)).toContain("private-key");
  });

  test(".agents/ exige une preuve, pas un indice", () => {
    expect(VENDORED).toBe(VENDORED_PATTERNS);
    const docExamples = [pemDoc, pemInline, awsExample, stateDoc, stateEmpty, mockToken];
    for (const ex of docExamples) {
      expect(matchPatterns(ex, VENDORED)).toEqual([]);
    }
  });

  test("un vrai secret échoue DANS .agents/", () => {
    const realSecrets = [
      ["private-key", realPEM],
      ["github-token", ghToken],
      ["slack-token", slackToken],
      ["aws-key", awsKey],
      ["storageState", realState],
      ["credential-literal", credLiteral],
    ] as const;
    for (const [name, secret] of realSecrets) {
      expect(matchPatterns(secret, VENDORED)).toContain(name);
    }
  });

  test("le carve-out ne s'applique qu'à .agents/", () => {
    expect(matchPatterns(pemHeader, patternsFor("server/index.ts"))).toContain("private-key");
    expect(patternsFor(".agents")).toBe(VENDORED_PATTERNS);
    expect(patternsFor(".agents/skills/code-review/SKILL.md")).toBe(VENDORED_PATTERNS);
    // Un dossier qui COMMENCE PAR .agents n'est pas vendorisé.
    expect(patternsFor(".agentsfoo/x.md")).toBe(PATTERNS);
  });
});

describe("scan anti-secrets : le jeu vendorisé couvre le JWT et les identifiants d'URL", () => {
  const jwt = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    ".eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    ".dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  ].join("");
  const urlCred = ["https://user:s3cr3tP4", "ssword", "Long@host/x"].join("");

  test("le jeu vendorisé couvre TOUTES les formes du jeu du dépôt", () => {
    // Le carve-out peut être PLUS STRICT, jamais PLUS LARGE : un motif absent du
    // jeu vendorisé serait un secret tiers non signalé.
    const couverture = new Set(VENDORED_PATTERNS.map((p) => p.name));
    for (const { name } of PATTERNS) {
      expect({ name, couvert: couverture.has(name) }).toEqual({ name, couvert: true });
    }
  });

  test("un JWT VIVANT échoue dans .agents/", () => {
    // Un JWT est une PREUVE, pas un indice (I11) : trois segments de longueur
    // plausible suffisent.
    expect(matchPatterns(jwt, VENDORED)).toContain("jwt");
    expect(matchPatterns(jwt, PATTERNS)).toContain("jwt");
  });

  test("des identifiants dans une URL échouent dans .agents/", () => {
    expect(matchPatterns(urlCred, VENDORED)).toContain("url-credential");
    expect(matchPatterns(urlCred, PATTERNS)).toContain("url-credential");
  });

  test("la preuve exigée : un JWT tronqué ou une URL d'exemple passe", () => {
    expect(matchPatterns("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", VENDORED)).toEqual([]);
    // Mot de passe court (< 8) : `user:pass@` est un exemple, pas un credential.
    expect(matchPatterns(["https://user:pass", "@host/"].join(""), VENDORED)).toEqual([]);
    expect(matchPatterns(["https://user:pass", "word@host/"].join(""), VENDORED)).toEqual([]);
  });
});

// La preuve est VÉRIFIÉE sur le SCAN RÉEL, pas seulement sur les motifs : un
// JWT ou une URL à identifiants déposés dans `.agents/` font échouer
// `check-secrets`.
describe("scan anti-secrets : un secret dans .agents/ fait échouer le scan", () => {
  const jwt = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    ".eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    ".dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  ].join("");
  const urlCred = ["https://user:s3cr3tP4", "ssword", "Long@host/x"].join("");

  function fixture(contenu: string): string {
    const dir = mkdtempSync(join(tmpdir(), "secret-scan-"));
    const skill = join(dir, ".agents", "skills", "x");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), contenu);
    return dir;
  }

  function scan(dir: string): { code: number; out: string } {
    const p = Bun.spawnSync(["bun", join(ROOT, "agents", "runtime", "check-secrets.ts"), dir], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const dec = new TextDecoder();
    return { code: p.exitCode ?? -1, out: dec.decode(p.stdout) + dec.decode(p.stderr) };
  }

  test("un JWT déposé dans .agents/ fait échouer le scan", () => {
    const dir = fixture(`Un exemple de jeton : ${jwt}\n`);
    try {
      const r = scan(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("jwt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("des identifiants dans une URL déposés dans .agents/ font échouer le scan", () => {
    const dir = fixture(`Une URL : ${urlCred}\n`);
    try {
      const r = scan(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("url-credential");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un contenu tiers sans secret passe le scan", () => {
    const dir = fixture("Une skill qui parle de JWT et d'URL, sans en contenir.\nhttps://exemple.fr/page\n");
    try {
      const r = scan(dir);
      expect({ code: r.code, out: r.out }).toEqual({ code: 0, out: r.out });
      expect(r.out).toContain("check-secrets OK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scan anti-secrets : le dépôt surveille les mêmes formes que le jeu vendorisé", () => {
  const urlCred = ["https://user:s3cr3tP4", "ss@host/x"].join("");
  const jwt = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    ".eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    ".dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  ].join("");
  const envReal = ["MASTER_", "KEY=prod-9f3a2b8c7d6e5f4a3b2c1d0e9f8a7b6c"].join("");
  const envFake = ["MASTER_", "KEY=prod-example-key-9f3a2b"].join("");
  const envPlaceholder = ["MASTER_", "KEY=your-key-here"].join("");

  test("le dépôt couvre les mêmes formes que le jeu vendorisé", () => {
    for (const [name, secret] of [
      ["github-token", ghToken],
      ["slack-token", slackToken],
      ["aws-key", awsKey],
      ["jwt", jwt],
      ["url-credential", urlCred],
      ["credential-literal", credLiteral],
    ] as const) {
      expect(matchPatterns(secret, PATTERNS)).toContain(name);
    }
  });

  test("un placeholder dans la valeur n'excuse plus une vraie affectation", () => {
    // Seule une valeur ENTIÈREMENT placeholder est excusée.
    expect(matchPatterns(envReal, PATTERNS)).toContain("env-assign");
    expect(matchPatterns(envFake, PATTERNS)).toContain("env-assign");
    expect(matchPatterns(envPlaceholder, PATTERNS)).toEqual([]);
  });

  test("les exemples d'attaque des tests ne sont pas des secrets", () => {
    // « user:pass@ » et un port après un @ : charges utiles de test, pas des
    // credentials (le mot de passe doit faire 8 caractères).
    expect(matchPatterns("https://user:pass@host/", PATTERNS)).toEqual([]);
    expect(matchPatterns("http://127.0.0.1:80@editeur.example/", PATTERNS)).toEqual([]);
  });
});

// Tous les matchs d'un motif sont inspectés : un placeholder en tête de fichier
// n'excuse pas un secret réel plus bas.
describe("scan anti-secrets : tous les matchs d'un motif sont inspectés", () => {
  const placeholder = ["api", '_key = "your_key_here_placeholder_value_xxxx"'].join("");
  const reel = ["api", '_key = "aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY"'].join("");

  test("un placeholder seul ne fait rien passer", () => {
    expect(matchPatterns(placeholder, PATTERNS)).toEqual([]);
    expect(matchPatterns(placeholder, VENDORED)).toEqual([]);
  });

  test("un placeholder AVANT un vrai secret ne l'excuse plus", () => {
    expect(matchPatterns(`${placeholder}\n${reel}\n`, PATTERNS)).toContain("credential-literal");
    expect(matchPatterns(`${placeholder}\n${reel}\n`, VENDORED)).toContain("credential-literal");
  });

  test("un vrai secret AVANT un placeholder est signalé (ordre inverse)", () => {
    expect(matchPatterns(`${reel}\n${placeholder}\n`, PATTERNS)).toContain("credential-literal");
    expect(matchPatterns(`${reel}\n${placeholder}\n`, VENDORED)).toContain("credential-literal");
  });

  test("le même motif, plusieurs fois, ne signale qu'une fois", () => {
    // Le motif est le SIGNAL, pas le compte des occurrences.
    const hits = matchPatterns(`${reel}\n${reel}\n${reel}\n`, PATTERNS);
    expect(hits.filter((h) => h === "credential-literal")).toHaveLength(1);
  });
});
