// test-output.ts — borne ce qu'un `bun test` ROUGE imprime, sans cacher la
// cause. Utilisé par `make unit` et `make web-test`.
//
// Bun n'a pas de reporter programmable (`junit` exige un fichier, `dots` masque
// la cause) et un `expect(toEqual)` sur 400 objets écrit 2 006 lignes.
//
// On GARDE : fichier:ligne, la première ligne d'erreur, Expected/Received
// (bornés), le PREMIER hunk. On JETTE : l'extrait numéroté, les frames
// internes, les hunks suivants, au-delà de 10 échecs. Le log complet reste sur
// disque, à chemin fixe.
//
// Le code de sortie de `bun test` est FORWARDÉ : ce filtre ne peut pas verdir
// un run rouge. Le succès imprime le résumé de bun plus les blocs SKIP/REPLI.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const LOG_DIR = join(ROOT, "node_modules", ".cache", "gate-logs");

const MAX_FAILS = 10;
const MAX_HUNK_LINES = 12;
const MAX_VALUE_LINES = 2;
const MAX_LINE = 200;
const MAX_TAIL_LINES = 40;

function short(line: string): string {
  return line.length <= MAX_LINE ? line : `${line.slice(0, MAX_LINE)}…`;
}

function hunkBody(line: string): boolean {
  if (line === "" || line.startsWith("@@")) return false;
  if (/^[-+] (Expected|Received)/.test(line)) return false;
  return line.startsWith(" ") || line.startsWith("-") || line.startsWith("+");
}

/** Frame de pile INTERNE : ne dit rien de la cause, contrairement au test. */
function internalFrame(line: string): boolean {
  return /(node_modules|bun:|\binternal\b|native)/.test(line);
}

/** Un bloc d'échec : tout ce qui précède un `(fail)`, inclus. */
function filterBlock(lines: string[]): string[] {
  const out: string[] = [];
  let excerpt = false;
  let hunks = 0;
  let skipping = false;
  let inHunk = false;
  let hunkLines = 0;
  let value: "Expected" | "Received" | null = null;
  let valueLines = 0;

  for (const line of lines) {
    // Extrait numéroté (`12 | code` + caret) : du bruit, jamais la cause.
    if (excerpt) {
      if (/^\s*\^+\s*$/.test(line)) excerpt = false;
      continue;
    }
    if (/^\s*\d+\s+\| /.test(line)) {
      excerpt = true;
      continue;
    }
    // Frame de test : c'est elle qui porte fichier:ligne.
    if (/^\s+at /.test(line)) {
      if (!internalFrame(line)) out.push(short(line));
      continue;
    }
    if (/^(Expected|Received):/.test(line)) {
      value = line.startsWith("Expected") ? "Expected" : "Received";
      valueLines = 0;
      out.push(short(line));
      continue;
    }
    if (value) {
      if (line.trim() === "" || line.startsWith("(fail)")) {
        value = null;
      } else {
        if (valueLines < MAX_VALUE_LINES) out.push(short(line));
        else if (valueLines === MAX_VALUE_LINES) out.push("…");
        valueLines++;
        continue;
      }
    }
    if (line.startsWith("@@")) {
      // UNIQUEMENT le premier hunk : `- Expected`/`+ Received` restent.
      hunks++;
      inHunk = true;
      skipping = hunks > 1;
      if (!skipping) {
        out.push(short(line));
        hunkLines = 0;
      }
      continue;
    }
    if (inHunk) {
      if (hunkBody(line)) {
        if (skipping) continue;
        if (hunkLines < MAX_HUNK_LINES) out.push(short(line));
        else if (hunkLines === MAX_HUNK_LINES) out.push("…");
        hunkLines++;
        continue;
      }
      inHunk = false;
      skipping = false;
    }
    out.push(short(line));
  }
  return out;
}

function tail(lines: string[]): string[] {
  const kept = filterBlock(lines);
  if (kept.length <= MAX_TAIL_LINES) return kept;
  const hidden = kept.length - MAX_TAIL_LINES + 1;
  const note = `… ${hidden} ligne(s) masquée(s)`;
  return [...kept.slice(0, MAX_TAIL_LINES - 1), note];
}

function collapse(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const clean = line.replace(/\s+$/, "");
    if (clean === "" && (out.length === 0 || out.at(-1) === "")) continue;
    out.push(clean);
  }
  while (out.at(-1) === "") out.pop();
  return out;
}

export function filterTestOutput(raw: string): string {
  const lines = raw.replace(/\s+$/, "").split("\n");
  // Bloc = ce qui précède un `(fail)` ; le reste est le résumé final.
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    current.push(line);
    if (line.startsWith("(fail)")) {
      blocks.push(current);
      current = [];
    }
  }
  const kept = blocks.slice(0, MAX_FAILS);
  const out: string[] = [];
  for (const block of kept) out.push(...filterBlock(block));
  const hidden = blocks.length - kept.length;
  if (hidden > 0) out.push(`… reste: ${hidden}`);
  out.push(...tail(current));
  return collapse(out).join("\n");
}

/** Run VERT : résumé de bun + blocs SKIP/REPLI (SKIP BRUYANT, jamais de faux vert). */
export function greenOutput(raw: string): string {
  const lines = raw.replace(/\s+$/, "").split("\n");
  const summary = [...lines].reverse().find((line) => line.trim() !== "") ?? "";
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/\b(SKIP|REPLI)\b/.test(line)) continue;
    out.push(...lines.slice(i, i + 3).filter((l) => l.trim() !== ""));
    i += 2;
  }
  if (summary && out.at(-1) !== summary) out.push(summary);
  return out.join("\n");
}

async function main(): Promise<void> {
  const [target, ...args] = process.argv.slice(2);
  if (!target || args.length === 0) {
    console.error(
      "test-output : usage — test-output.ts <cible> <args bun test>",
    );
    process.exitCode = 2;
    return;
  }
  mkdirSync(LOG_DIR, { recursive: true });
  const slug = target.replace(/[^\w.-]+/g, "_");
  const logPath = join(LOG_DIR, `${slug}.log`);

  const p = Bun.spawn([process.execPath, "test", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  // bun écrit l'en-tête sur stdout et les échecs sur stderr : même ordre que
  // le terminal, donc même concaténation que check.ts.
  const raw = stdout + stderr;
  writeFileSync(logPath, raw, { mode: 0o600 });

  const ok = code === 0;
  const text = ok ? greenOutput(raw) : filterTestOutput(raw);
  if (text) process.stdout.write(`${text}\n`);
  if (!ok) process.stdout.write(`log complet : ${relative(ROOT, logPath)}\n`);
  process.exitCode = ok ? 0 : (code ?? 1);
}

if (import.meta.main) await main();
