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
