// Transport du fournisseur LLM : ce que `make check` doit tenir sans réseau.
//
// Trois défauts d'un même appel, tous invisibles tant que le fournisseur se
// comporte bien :
//   1. OkHttp SUIT les redirections par défaut : un 307/308 re-POSTERAIT le
//      prompt entier (cours, pièces jointes, nonce) vers une cible arbitraire,
//      éventuellement en clair — le prompt sort de son destinataire.
//   2. `body.string()` charge un corps 2xx SANS BORNE en mémoire : un
//      fournisseur (ou un intermédiaire) peut remplir le tas de l'appareil.
//   3. Un délai expirait en « Erreur réseau LLM » : l'élève ne savait pas s'il
//      fallait attendre ou vérifier sa connexion, et rien n'était rejoué.
//
// La BORNE de lecture et le CLASSEMENT d'une panne vivent dans une source PURE
// (`android/data/.../LlmTransport.kt`) : ce test la COMPILE et la pilote via
// `agents/runtime/kotlin-parity/LlmTransportParityMain.kt` — donc sur du code
// exécuté, sans réseau. Le CÂBLAGE OkHttp (redirections, reprise unique) n'est
// pas injectable sans serveur local : il reste un pin de source, explicite et
// court, en bas du fichier.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

// Le harnais compile la source Kotlin au premier appel ; sous le gate
// parallèle (16 workers) ce démarrage peut dépasser le délai par défaut.
setDefaultTimeout(30_000);

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "LlmTransportParityMain.kt");
const LLM = join(
  ROOT,
  "android",
  "data",
  "src",
  "main",
  "java",
  "fr",
  "veryslopnynotes",
  "data",
  "OpenRouterLlm.kt",
);

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface ReadResult {
  ok?: boolean;
  length?: number;
  pulled?: number;
  max?: number;
  error?: string;
}

interface FaultResult {
  ok?: boolean;
  fault?: string;
  message?: string;
}

async function constants(): Promise<{ maxResponseBytes: number }> {
  return JSON.parse(await link!.ask({ op: "constants" })) as { maxResponseBytes: number };
}

/** Lit un flux synthétique de `bytes` octets, avec plafond `max`. */
async function read(bytes: number, max?: number): Promise<ReadResult> {
  return JSON.parse(await link!.ask({ op: "read", bytes, max }, { allowError: true })) as ReadResult;
}

async function fault(kind: string): Promise<FaultResult> {
  return JSON.parse(await link!.ask({ op: "fault", error: kind }, { allowError: true })) as FaultResult;
}

async function tooLargeMessage(max: number): Promise<string> {
  const r = JSON.parse(await link!.ask({ op: "tooLargeMessage", max })) as { message: string };
  return r.message;
}

describe("corps d'une réponse LLM : lu BORNÉ", () => {
  test.skipIf(skip)("le plafond documenté laisse passer la sortie maximale", async () => {
    const cap = (await constants()).maxResponseBytes;
    // Au moins 256 Kio, et assez pour 12 000 caractères même au pire
    // échappement JSON (`\uXXXX` = 6 octets par caractère).
    expect(cap).toBeGreaterThanOrEqual(256 * 1024);
    expect(cap).toBeGreaterThan(12_000 * 6);
  });

  test.skipIf(skip)("un corps exactement au plafond est accepté, un octet de plus est refusé", async () => {
    const cap = (await constants()).maxResponseBytes;
    const pile = await read(cap);
    expect({ ok: pile.ok, length: pile.length }).toEqual({ ok: true, length: cap });
    // Le flux est lu en entier quand il tient : aucune coupe silencieuse.
    expect(pile.pulled).toBe(cap);

    const trop = await read(cap + 1);
    expect(trop.ok).toBe(false);
    expect(trop.error).toBe("ResponseTooLargeException");
    // Le refus NOMME la limite réelle.
    expect(trop.max).toBe(cap);
  });

  test.skipIf(skip)("un corps démesuré n'est pas vidé : la lecture s'arrête tôt", async () => {
    // 1 Mo annoncé, plafond de 1 000 octets : on ne tire que plafond + un
    // tampon, jamais le corps entier (mémoire de l'appareil bornée).
    const r = await read(1_000_000, 1_000);
    expect(r.ok).toBe(false);
    expect(r.pulled!).toBeLessThan(1_000_000);
    expect(r.pulled!).toBeLessThanOrEqual(1_000 + 8 * 1024);
  });

  test.skipIf(skip)("un petit corps passe intact", async () => {
    const r = await read(2048, 4096);
    expect({ ok: r.ok, length: r.length }).toEqual({ ok: true, length: 2048 });
  });
});

describe("panne du transport : le délai n'est pas le réseau", () => {
  test.skipIf(skip)("connect, read et call timeout sont des DÉLAIS", async () => {
    // `callTimeout` d'OkHttp lève InterruptedIOException, pas un
    // SocketTimeoutException : même cause, même message.
    for (const kind of ["socket_timeout", "read_timeout", "call_timeout", "wrapped_timeout"]) {
      expect({ kind, fault: (await fault(kind)).fault }).toEqual({ kind, fault: "TIMEOUT" });
    }
  });

  test.skipIf(skip)("TLS, I/O et cause inconnue restent des pannes réseau", async () => {
    for (const kind of ["ssl", "io", "generic"]) {
      expect({ kind, fault: (await fault(kind)).fault }).toEqual({ kind, fault: "NETWORK" });
    }
  });

  test.skipIf(skip)("les messages sont français, bornés, sans URL ni clé", async () => {
    // Même plafond que `LlmError.MAX_ERROR_CHARS` : le message part à l'UI.
    const MAX_ERROR_CHARS = 120;
    // Le lien de parité est SÉRIEL (un seul stdout) : deux `ask` en vol
    // croisent les réponses et l'un attend indéfiniment.
    const messages: string[] = [];
    for (const kind of ["socket_timeout", "ssl"]) messages.push((await fault(kind)).message!);
    messages.push(await tooLargeMessage((await constants()).maxResponseBytes));
    for (const msg of messages) {
      expect(msg.length).toBeGreaterThan(0);
      expect(msg.length).toBeLessThanOrEqual(MAX_ERROR_CHARS);
      expect(msg).toMatch(/[éèêà]/);
      expect(msg).not.toMatch(/https?:\/\//i);
      expect(msg).not.toMatch(/Bearer|Authorization|sk-or/i);
    }
    // Le refus d'un corps trop gros nomme la limite (I4), pas un code nu.
    expect(messages[2]).toContain("512");
  });
});

describe("câblage de l'appel : redirections coupées, une seule reprise", () => {
  // Pin de source : le comportement d'OkHttp n'est pas pilotable sans réseau.
  // Chaque assertion vise une ligne de plus que ce que le test Kotlin ci-dessus
  // prouve déjà (la borne et le classement, eux, sont EXÉCUTÉS).
  const src = codeOnly(readFileSync(LLM, "utf8"));
  const send = src.slice(src.indexOf("private fun send"), src.indexOf("private fun parseCompletion"));

  test("aucune redirection suivie : un 307/308 ne re-POSTe pas le prompt", () => {
    expect(src).toContain(".followRedirects(false)");
    expect(src).toContain(".followSslRedirects(false)");
  });

  test("le corps passe par la lecture bornée, plus par string()", () => {
    expect(src).not.toMatch(/body\??\.string\(\)/);
    expect(src).toMatch(/readBounded\(body\.byteStream\(\), MAX_RESPONSE_BYTES\)/);
    expect(src).toContain("responseTooLargeMessage(e.maxBytes)");
  });

  test("deux tentatives au plus, budget TOTAL coupé par tentative", () => {
    expect(src).toMatch(/const val MAX_ATTEMPTS = 2\b/);
    expect(src).toMatch(/perAttemptMs = \(timeout \/ MAX_ATTEMPTS\)\.coerceAtLeast\(1L\)/);
    // Le budget par tentative est bien celui posé sur le client : la reprise
    // ne peut pas dépasser `timeoutMs` au total.
    for (const champ of ["connectTimeout", "readTimeout", "callTimeout"]) {
      expect(src).toMatch(new RegExp(`${champ}\\(perAttemptMs, TimeUnit\\.MILLISECONDS\\)`));
    }
    // La sémantique du délai d'appel est INCHANGÉE (hors bornes = défaut).
    expect(src).toMatch(
      /fun normalizeTimeoutMs\(value: Long\): Long =[\s\S]{0,80}?if \(value <= 0 \|\| value > MAX_TIMEOUT_MS\) DEFAULT_TIMEOUT_MS else value/,
    );
  });

  test("seule une panne de transport est rejouée", () => {
    // Un statut HTTP (LlmError) sort AVANT la branche de reprise.
    expect(send.indexOf("catch (e: LlmError)")).toBeGreaterThan(-1);
    expect(send.indexOf("catch (e: LlmError)")).toBeLessThan(send.indexOf("catch (e: Exception)"));
    expect(send).toMatch(/if \(attempt >= MAX_ATTEMPTS\) throw transportError\(e\)/);
    // L'analyse de la réponse (garde de format) est HORS de la boucle : une
    // réponse illisible n'est jamais redemandée au fournisseur.
    expect(send).not.toContain("parseCompletion");
    expect(send).not.toContain("assertNoSecretsInPrompt");
  });

  test("ni clé ni prompt dans une trace", () => {
    expect(src).not.toMatch(/Log\.|println|printStackTrace/);
    // Seule interpolation de la clé : l'en-tête Bearer.
    expect(src.match(/\$key/g)?.length ?? 0).toBe(1);
  });
});
