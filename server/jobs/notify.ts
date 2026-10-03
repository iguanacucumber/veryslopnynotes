// Notif notes v0 — push sur delta phase 5 uniquement (issue #23, phase 7, I7).
// Données structurées uniquement : GradeCreated issu de runSync/diffAgainstPrints.
// Aucun appel LLM, aucune sortie libre ne déclenche d'envoi (garde jobs-guard).
// Premier sync silencieux : notifySyncResult ignore tout si firstRun.
// Interface d'envoi structurelle (compatible PushProvider sans import de lane).
// Logs = compteurs seuls, jamais de token en clair.

import { isAbsenceRecord, isGrade, isTokenHash } from "../../shared/contracts/models";
import type { ContractEvent } from "../../shared/contracts/events";
import type { AbsenceRecord, Device, Grade } from "../../shared/contracts/models";
import type { SyncResult } from "./sync";

export interface GradePushSender {
  send(deviceTokenHash: string, payload: { title: string; body: string }): Promise<void>;
}

export interface NotifyResult {
  readonly sent: number;
  readonly failed: number;
  readonly events: number;
  readonly devices: number;
}

export type NotifyLogger = (message: string) => void;

function clean(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max) : t;
}

export function formatGradePush(grade: Grade): { title: string; body: string } {
  const subject = grade.subject.trim() || "note";
  const title = clean(`Nouvelle note en ${subject}`, 120);
  const coeff = grade.coefficient ? ` (coeff ${grade.coefficient})` : "";
  const body = clean(`${grade.value}/${grade.scale} en ${subject}${coeff}`, 1000);
  return { title, body };
}

function validDevices(devices: Device[]): Device[] {
  return devices.filter((d) => isTokenHash(d?.tokenHash));
}

export async function notifyGradeEvents(
  events: ContractEvent[],
  devices: Device[],
  sender: GradePushSender,
  logger: NotifyLogger = () => {},
): Promise<NotifyResult> {
  const grades: Grade[] = [];
  for (const e of events) {
    if (e?.type !== "GradeCreated") continue;
    if (isGrade(e.data)) grades.push(e.data);
  }
  const targets = validDevices(devices);
  let sent = 0;
  let failed = 0;
  for (const g of grades) {
    const payload = formatGradePush(g);
    for (const d of targets) {
      try {
        await sender.send(d.tokenHash, payload);
        sent += 1;
      } catch {
        failed += 1;
      }
    }
  }
  logger(`notify grades events=${grades.length} devices=${targets.length} sent=${sent} failed=${failed}`);
  return { sent, failed, events: grades.length, devices: targets.length };
}

export async function notifySyncResult(
  result: SyncResult,
  devices: Device[],
  sender: GradePushSender,
  logger: NotifyLogger = () => {},
): Promise<NotifyResult> {
  if (result.firstRun) {
    logger(`notify grades skipped firstRun devices=${devices.length}`);
    return { sent: 0, failed: 0, events: 0, devices: devices.length };
  }
  return notifyGradeEvents(result.events, devices, sender, logger);
}

// --- #77 vie scolaire : détection de nouvelle absence sur DONNÉES STRUCTURÉES ---
// Comparaison d'identifiants d'enregistrements (comme diffAgainstPrints pour
// les notes) : aucun LLM, aucune sortie libre sur le chemin d'un effet métier
// (I7). Le câblage dans l'ordonnanceur de sync reste hors de ce fichier.
export function newAbsences(previousIds: readonly string[], records: readonly AbsenceRecord[]): AbsenceRecord[] {
  const seen = new Set(previousIds);
  return records.filter((r) => isAbsenceRecord(r) && !seen.has(r.id));
}

export function formatAbsencePush(record: AbsenceRecord): { title: string; body: string } {
  const title = clean(record.kind === "late" ? "Nouveau retard" : "Nouvelle absence", 120);
  const where = record.subject ? ` en ${record.subject}` : "";
  const motif = record.motif ? ` — ${record.motif}` : "";
  return { title, body: clean(`${record.date.slice(0, 10)}${where}${motif}`, 1000) };
}
