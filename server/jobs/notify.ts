// Notif notes v0 — push sur delta phase 5 uniquement (issue #23, phase 7, I7).
// Données structurées uniquement : GradeCreated issu de runSync/diffAgainstPrints.
// Aucun appel LLM, aucune sortie libre ne déclenche d'envoi (garde jobs-guard).
// Premier sync silencieux : notifySyncResult ignore tout si firstRun.
// Interface d'envoi structurelle (compatible PushProvider sans import de lane).
// Logs = compteurs seuls, jamais de token en clair.

import { isGrade } from "../../shared/contracts/models";
import type { ContractEvent } from "../../shared/contracts/events";
import type { Device, Grade } from "../../shared/contracts/models";
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

const HASH_RE = /^[0-9a-f]{64}$/i;

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
  return devices.filter((d) => typeof d?.tokenHash === "string" && HASH_RE.test(d.tokenHash));
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
