// Vérifie le circuit agentique d'une PR locale (.agents/prs/<id>.md) :
// deux reviews sur le SHA courant, make check pass, zéro blocking.
// Usage: bun run agents/runtime/check-pr.ts .agents/prs/0001.md <HEAD_SHA>
import { readFileSync } from "node:fs";

const [prsFile, headSha] = process.argv.slice(2);
if (!prsFile || !headSha) {
  console.error("usage: check-pr.ts <prs-file> <head-sha>");
  process.exit(2);
}

const content = readFileSync(prsFile, "utf8");

const reviews = [...content.matchAll(/head:\s*([0-9a-f]{40})/gi)].map((m) => m[1]);
const blocking = (content.match(/\[blocking\]/gi) ?? []).length;
const checkPass = /make check\s*→\s*pass/i.test(content);

let errors: string[] = [];
const reviewHeads = reviews.slice(-2);
if (reviewHeads.length < 2) errors.push("il faut deux reviews locales (REVIEW 1 + REVIEW 2)");
if (reviewHeads.some((h) => h.toLowerCase() !== headSha.toLowerCase()))
  errors.push(`reviews invalides : SHA courant ${headSha}, reviews sur ${reviewHeads.join(", ")}`);
if (!checkPass) errors.push("make check → pass manquant");
if (blocking > 0) errors.push(`${blocking} finding(s) blocking`);

if (errors.length) {
  console.error("check-pr FAIL:");
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log("check-pr OK");
