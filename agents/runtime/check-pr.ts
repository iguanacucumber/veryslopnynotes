// Vérifie une PR locale (.agents/prs/<id>.md) : review sur SHA courant, check pass, zéro blocking.
// Défaut : 1 review suffit ; 2e exigée seulement si sensible (voir AGENTS.md § Review).
// Usage: bun run agents/runtime/check-pr.ts .agents/prs/0001.md <HEAD_SHA> (SHA complet ou abrégé >=7)
import { readFileSync } from "node:fs";

const [prsFile, headSha] = process.argv.slice(2);
if (!prsFile || !headSha) {
  console.error("usage: check-pr.ts <prs-file> <head-sha>");
  process.exit(2);
}

const content = readFileSync(prsFile, "utf8");

const reviews = [...content.matchAll(/head:\s*([0-9a-f]{7,40})/gi)].map((m) => m[1]);
const blocking = (content.match(/\[blocking\]/gi) ?? []).length;
const checkPass = /(make check|bun run check)\s*→\s*pass/i.test(content);

let errors: string[] = [];
const reviewHeads = reviews.slice(-2);
if (reviewHeads.length < 1) errors.push("il faut au moins une review locale (head: <SHA>, tests: bun run check → pass)");
const want = headSha.toLowerCase();
const last = reviewHeads[reviewHeads.length - 1]?.toLowerCase() ?? "";
if (!last || !(want.startsWith(last) || last.startsWith(want)))
  errors.push(`review périmée : SHA courant ${headSha}, dernière review sur ${reviewHeads.join(", ") || "aucune"}`);
if (!checkPass) errors.push("bun run check → pass manquant");
if (blocking > 0) errors.push(`${blocking} finding(s) blocking`);

if (errors.length) {
  console.error("check-pr FAIL:");
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log("check-pr OK");
