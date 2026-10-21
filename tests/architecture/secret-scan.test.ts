// Scan anti-secrets : le carve-out `.agents/` (contenu tiers) ne doit pas
// devenir une passoire. Invariant : un VRAI secret échoue DANS `.agents/`,
// tandis que les exemples de documentation des skills passent.
//
// Ce test porte sur les MOTIFS (source de vérité partagée avec
// `check-secrets.ts`), pas sur le disque : un scan réel du dépôt est déjà
// fait par `make lint`.
//
// Les faux secrets ci-dessous sont ASSEMBLÉS à partir de fragments : le scan
// anti-secrets passe aussi sur `tests/`, et un littéral complet le ferait
// échouer lui-même. Un littéral entier ne doit jamais être écrit en clair.
import { describe, expect, test } from "bun:test";
import { matchPatterns, PATTERNS, patternsFor, VENDORED_PATTERNS } from "../../agents/runtime/secret-patterns";

const VENDORED = patternsFor(".agents/skills/security-review/SKILL.md");
const REPO = patternsFor("web/src/App.tsx");

// Fragments : un secret entier écrit en clair se ferait flaguer par le scan.
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
    // Un en-tête PEM seul suffit dans le dépôt : c'est le comportement
    // historique, on ne l'affaiblit pas.
    expect(matchPatterns(pemHeader, REPO)).toContain("private-key");
  });

  test(".agents/ exige une preuve, pas un indice", () => {
    expect(VENDORED).toBe(VENDORED_PATTERNS);
    // Exemples de doc des skills : ils imitent un secret, ils n'en sont pas.
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
    // Un fichier du dépôt qui cite un en-tête PEM reste un FAIL.
    expect(matchPatterns(pemHeader, patternsFor("server/index.ts"))).toContain("private-key");
    // .agents/ à la racine exacte comme sous-chemin : les deux sont vendorisés.
    expect(patternsFor(".agents")).toBe(VENDORED_PATTERNS);
    expect(patternsFor(".agents/skills/code-review/SKILL.md")).toBe(VENDORED_PATTERNS);
    // Un dossier qui COMMENCE PAR .agents n'est pas vendorisé.
    expect(patternsFor(".agentsfoo/x.md")).toBe(PATTERNS);
  });
});

// #503 : le jeu du DÉPÔT n'avait que quatre formes, alors que le jeu
// VENDORED en avait huit : le dossier tiers, le moins contrôlé, était mieux
// surveillé que le dépôt lui-même. Et le test de placeholder n'était pas
// ancré : un mot de placeholder PRÉSENT dans la valeur excusait la ligne.
describe("scan anti-secrets : le dépôt surveille les mêmes formes que le jeu vendorisé", () => {
  // Fragments : un littéral complet written en clair se ferait flaguer par le
  // scan (qui passe aussi sur `tests/`).
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
    // Le mot « example » au milieu de la valeur ne suffit plus : seule une
    // valeur ENTIÈREMENT placeholder est excusée.
    expect(matchPatterns(envReal, PATTERNS)).toContain("env-assign");
    expect(matchPatterns(envFake, PATTERNS)).toContain("env-assign");
    // Un placeholder franc reste un placeholder.
    expect(matchPatterns(envPlaceholder, PATTERNS)).toEqual([]);
  });

  test("les exemples d'attaque des tests ne sont pas des secrets", () => {
    // « user:pass@ » et un port après un @ : des charges utiles de test, pas
    // des credentials (le mot de passe doit faire 8 caractères).
    expect(matchPatterns("https://user:pass@host/", PATTERNS)).toEqual([]);
    expect(matchPatterns("http://127.0.0.1:80@editeur.example/", PATTERNS)).toEqual([]);
  });
});

// #521 : le scan n'inspectait que le PREMIER match de chaque motif. Un
// placeholder en tête de fichier excusait le fichier ENTIER, secret compris :
// un exemple de documentation placé AVANT la valeur réelle neutralisait la
// détection sur tout le fichier. Le motif ne passe que si AUCUN match n'est
// un secret réel.
describe("scan anti-secrets : tous les matchs d'un motif sont inspectés", () => {
  const placeholder = ["api", '_key = "your_key_here_placeholder_value_xxxx"'].join("");
  const reel = ["api", '_key = "aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY"'].join("");

  test("un placeholder seul ne fait rien passer", () => {
    // Rien à signaler : le SEUL match est un placeholder.
    expect(matchPatterns(placeholder, PATTERNS)).toEqual([]);
    expect(matchPatterns(placeholder, VENDORED)).toEqual([]);
  });

  test("un placeholder AVANT un vrai secret ne l'excuse plus", () => {
    // Le défaut exact : le premier match est un placeholder, donc le fichier
    // passait — le vrai secret, en deuxième position, n'était jamais vu.
    expect(matchPatterns(`${placeholder}\n${reel}\n`, PATTERNS)).toContain("credential-literal");
    // Le carve-out vendorisé suffers du même défaut : même comportement.
    expect(matchPatterns(`${placeholder}\n${reel}\n`, VENDORED)).toContain("credential-literal");
  });

  test("un vrai secret AVANT un placeholder est signalé (ordre inverse)", () => {
    expect(matchPatterns(`${reel}\n${placeholder}\n`, PATTERNS)).toContain("credential-literal");
    expect(matchPatterns(`${reel}\n${placeholder}\n`, VENDORED)).toContain("credential-literal");
  });

  test("le même motif, plusieurs fois, ne signale qu'une fois", () => {
    // Le motif est le SIGNAL, pas le compte des occurrences : un fichier avec
    // trois secrets est un fichier à corriger, pas trois fautes distinctes.
    const hits = matchPatterns(`${reel}\n${reel}\n${reel}\n`, PATTERNS);
    expect(hits.filter((h) => h === "credential-literal")).toHaveLength(1);
  });
});
