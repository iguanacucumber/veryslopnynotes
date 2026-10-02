// Fiches révision v0 — déclenchement structuré DS/interro (issue #30,
// phase 10, I7). Données structurées uniquement : ExamCandidate issu de
// detectExams (server/jobs/exams). Aucun appel modèle ici, aucune sortie
// libre ne déclenche d'envoi (garde jobs-guard). `high` seul pousse en auto ;
// `needs_confirm` = confirmation app obligatoire, aucun effet auto.
// Contenu fiche assemblé depuis texte validé + sources citées, gabarit
// versionné REVISION_TEMPLATE_VERSION (stockée par fiche).
// Push = payload structuré (sujet/date), jamais texte modèle.
// Logs = compteurs seuls, jamais de token en clair.

import {
  REVISION_TEMPLATE_VERSION,
  isRevisionSheet,
  isTokenHash,
} from "../../shared/contracts/models";
import type { Device, RevisionSheet } from "../../shared/contracts/models";
import type { ExamCandidate } from "./exams";

export const REVISION_KIND = "fiche-v1" as const;

export interface RevisionPushSender {
  send(deviceTokenHash: string, payload: { title: string; body: string }): Promise<void>;
}

export interface RevisionNotifyResult {
  readonly sent: number;
  readonly failed: number;
  readonly sheets: number;
  readonly devices: number;
}

export type RevisionLogger = (message: string) => void;

// Stockage kv minimal (miroir StorageProvider sans import domaine,
// autres lanes actives dessus). Clés versionnées par gabarit.
export interface RevisionKv {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
}

const SHEET_PREFIX = "revision:sheet:";
const INDEX_KEY = "revision:index";

function clean(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max) : t;
}

function sheetKey(id: string): string {
  return `${SHEET_PREFIX}${id}`;
}

// Id déterministe par examen : rejouable, zéro doublon.
export function revisionIdForExam(examId: string): string {
  const safe = examId.trim().replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80) || "exam";
  return `fiche-${safe}`;
}

export function buildRevisionTitle(exam: ExamCandidate): string {
  const subject = exam.subject.trim() || "matière";
  return clean(`Fiche révision ${subject} — ${exam.matched} ${exam.date.slice(0, 10)}`, 120);
}

// Seule confiance haute pousse en auto (I7). Incertain = app confirme.
export function shouldPushForExam(exam: ExamCandidate): boolean {
  return exam.confidence === "high";
}

export function formatRevisionPush(exam: ExamCandidate): { title: string; body: string } {
  const subject = exam.subject.trim() || "matière";
  const title = clean(`Fiche révision dispo en ${subject}`, 120);
  const body = clean(`DS ${exam.matched} le ${exam.date.slice(0, 10)} en ${subject} : fiche prête`, 1000);
  return { title, body };
}

function dedupeSources(sources: string[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    const t = s.trim();
    if (!t || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

// Assemble fiche depuis texte validé + sources. Exige sources non-vides
// (refus propre si corpus insuffisant, phase 9). Corps cite toujours.
export function assembleRevisionSheet(
  exam: ExamCandidate,
  ficheText: string,
  sources: string[],
  now = new Date().toISOString(),
): RevisionSheet {
  const text = ficheText.trim();
  if (!text) throw new Error("fiche vide (refus)");
  const deduped = dedupeSources(sources);
  if (!deduped.length) throw new Error("sources insuffisantes (refus)");
  const cited = text.includes("Sources :")
    ? text
    : `${text}\n\nSources :\n${deduped.map((s) => `- ${s}`).join("\n")}`;
  const sheet: RevisionSheet = {
    id: revisionIdForExam(exam.id),
    examId: exam.id,
    subject: exam.subject,
    date: exam.date,
    title: buildRevisionTitle(exam),
    body: cited,
    sources: deduped,
    templateVersion: REVISION_TEMPLATE_VERSION,
    createdAt: now,
  };
  if (!isRevisionSheet(sheet)) throw new Error("fiche invalide (contrat)");
  return sheet;
}

function validDevices(devices: Device[]): Device[] {
  return devices.filter((d) => isTokenHash(d?.tokenHash));
}

// Envoi structuré : décidé par ExamCandidate high, pas par texte modèle.
export async function notifyRevisionSheets(
  sheets: RevisionSheet[],
  examsById: ReadonlyMap<string, ExamCandidate> | Record<string, ExamCandidate>,
  devices: Device[],
  sender: RevisionPushSender,
  logger: RevisionLogger = () => {},
): Promise<RevisionNotifyResult> {
  const lookup = (id: string): ExamCandidate | undefined =>
    examsById instanceof Map
      ? examsById.get(id)
      : (examsById as Record<string, ExamCandidate>)[id];
  const targets = validDevices(devices);
  let sent = 0;
  let failed = 0;
  let pushed = 0;
  for (const sheet of sheets) {
    if (!isRevisionSheet(sheet)) continue;
    const exam = lookup(sheet.examId);
    if (!exam || !shouldPushForExam(exam)) continue;
    const payload = formatRevisionPush(exam);
    pushed += 1;
    for (const d of targets) {
      try {
        await sender.send(d.tokenHash, payload);
        sent += 1;
      } catch {
        failed += 1;
      }
    }
  }
  logger(`notify revision sheets=${pushed} devices=${targets.length} sent=${sent} failed=${failed}`);
  return { sent, failed, sheets: pushed, devices: targets.length };
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function saveRevisionSheet(store: RevisionKv, sheet: RevisionSheet): Promise<void> {
  if (!isRevisionSheet(sheet)) throw new Error("fiche invalide (contrat)");
  await store.set(sheetKey(sheet.id), enc.encode(JSON.stringify(sheet)));
  const raw = await store.get(INDEX_KEY);
  let ids: string[] = [];
  try {
    if (raw) {
      const v = JSON.parse(dec.decode(raw)) as unknown;
      if (Array.isArray(v)) ids = v.filter((x): x is string => typeof x === "string");
    }
  } catch {
    ids = [];
  }
  if (!ids.includes(sheet.id)) {
    ids.push(sheet.id);
    ids.sort();
    await store.set(INDEX_KEY, enc.encode(JSON.stringify(ids)));
  }
}

export async function loadRevisionSheet(store: RevisionKv, id: string): Promise<RevisionSheet | null> {
  const raw = await store.get(sheetKey(id));
  if (!raw) return null;
  try {
    const v = JSON.parse(dec.decode(raw)) as unknown;
    return isRevisionSheet(v) ? v : null;
  } catch {
    return null;
  }
}

export async function listRevisionSheets(store: RevisionKv): Promise<RevisionSheet[]> {
  const raw = await store.get(INDEX_KEY);
  if (!raw) return [];
  let ids: string[] = [];
  try {
    const v = JSON.parse(dec.decode(raw)) as unknown;
    if (!Array.isArray(v)) return [];
    ids = v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
  const out: RevisionSheet[] = [];
  for (const id of ids) {
    const s = await loadRevisionSheet(store, id);
    if (s) out.push(s);
  }
  return out;
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").slice(0, 200);
}

// ponytail: PDF une page Helvetica stdlib, pas de lib. Upgrade: lib épinglée si mise en page riche.
export function renderRevisionPdf(sheet: RevisionSheet): Uint8Array {
  if (!isRevisionSheet(sheet)) throw new Error("fiche invalide (contrat)");
  const lines = [sheet.title, `${sheet.subject} — ${sheet.date.slice(0, 10)}`, "", ...sheet.body.split("\n"), "", `Gabarit ${sheet.templateVersion}`]
    .flatMap((l) => {
      const t = l.trim() === "" ? [" "] : splitLine(l, 90);
      return t;
    })
    .slice(0, 60);
  let y = 800;
  const ops: string[] = ["BT /F1 12 Tf 50 800 Td 14 TL"];
  for (const l of lines) {
    ops.push(`(${pdfEscape(l)}) Tj T*`);
    y -= 14;
    if (y < 40) break;
  }
  ops.push("ET");
  const stream = ops.join("\n");
  const streamBytes = enc.encode(stream);
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const header = "%PDF-1.4\n";
  let pdf = header;
  const offsets: number[] = [0];
  for (let n = 1; n <= 5; n++) {
    if (n === 4) {
      const head = `${n} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`;
      const tail = "\nendstream\nendobj\n";
      offsets[n] = pdf.length;
      pdf += head + stream + tail;
    } else {
      const body = `${n} 0 obj\n${objects[n]}\nendobj\n`;
      offsets[n] = pdf.length;
      pdf += body;
    }
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let n = 1; n <= 5; n++) pdf += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return enc.encode(pdf);
}

function splitLine(line: string, max: number): string[] {
  if (line.length <= max) return [line || " "];
  const words = line.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const add = (cur ? 1 : 0) + w.length;
    if (cur.length + add > max && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [" "];
}
