// Notif notes v0 — push sur delta phase 5 uniquement (issue #23, phase 7, I7).
// Données structurées uniquement : GradeCreated issu de runSync/diffAgainstPrints.
// Aucun appel LLM, aucune sortie libre ne déclenche d'envoi (garde jobs-guard).
// Premier sync silencieux : notifySyncResult ignore tout si firstRun.
// Interface d'envoi structurelle (compatible PushProvider sans import de lane).
// Logs = compteurs seuls, jamais de token en clair.

import { isAbsenceRecord, isGrade, isTokenHash } from "../../shared/contracts/models";
import { localDay } from "../../shared/contracts/api";
import type { ContractEvent } from "../../shared/contracts/events";
import type { AbsenceRecord, Device, Grade } from "../../shared/contracts/models";
import type { SyncResult } from "./sync";

export interface GradePushSender {
  send(deviceTokenHash: string, payload: { title: string; body: string }): Promise<void>;
  /**
   * `false` = ce sender ne transmet rien (provider noop, endpoint symbolique) :
   * le job ne compte alors AUCUNE livraison. Un « succès » qui n'a rien envoyé
   * est une notification perdue qui se croit notifiée.
   */
  readonly delivers?: boolean;
}

export interface NotifyResult {
  readonly sent: number;
  readonly failed: number;
  /** Causes d'échec, une par envoi non livré : le résultat du job porte donc
   *  la cause, pas seulement un compteur (rejeu/exploitation). */
  readonly errors: readonly string[];
  readonly events: number;
  readonly devices: number;
}

export type NotifyLogger = (message: string) => void;

/** Fuseau d'affichage des dates dans un corps de push (élève France).
 *  ponytail: un seul fuseau pour tous les élèves. Upgrade: fuseau par
 *  établissement (contrat UserInfo / Device) quand multi-écoles. */

const ELLIPSIS = "…";

function clean(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  // Troncature JAMAIS au milieu d'une paire de surrogates : un demi-surrogate
  // est du UTF-16 invalide (caractère de remplacement côté appareil). On retire
  // le surrogate haut isolé et on marque la coupe par « … ».
  let cut = t.slice(0, Math.max(0, max - ELLIPSIS.length));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut + ELLIPSIS;
}

/** Cause d'échec journalisable : nom + message, jamais l'empreinte complète. */
function errorCause(err: unknown): string {
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  return `${name}: ${message.replace(/[0-9a-f]{64}/gi, (h) => `${h.slice(0, 8)}…`)}`.slice(0, 200);
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
  const vus = new Set<string>();
  for (const e of events) {
    if (e?.type !== "GradeCreated") continue;
    if (!isGrade(e.data)) continue;
    // Dedup par identité stable (id de note) : le rejeu d'un même lot de sync
    // (crash entre saveSnapshot et notify, retry de job) ne notifie pas deux
    // fois la même note.
    if (vus.has(e.data.id)) continue;
    vus.add(e.data.id);
    grades.push(e.data);
  }
  const targets = validDevices(devices);
  if (sender.delivers === false) {
    // Provider inerte : rien n'est compté (ni envoyé, ni échec d'un envoi qui
    // n'a pas eu lieu) et le motif reste au log pour l'exploitation.
    logger(`notify grades skipped push=indisponible events=${grades.length} devices=${targets.length}`);
    return { sent: 0, failed: 0, errors: [], events: grades.length, devices: targets.length };
  }
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const g of grades) {
    const payload = formatGradePush(g);
    for (const d of targets) {
      try {
        await sender.send(d.tokenHash, payload);
        sent += 1;
      } catch (err) {
        failed += 1;
        // La cause reste visible (log ET résultat du job), jamais avalée.
        const cause = errorCause(err);
        errors.push(cause);
        logger(`notify push error ${cause}`);
      }
    }
  }
  logger(`notify grades events=${grades.length} devices=${targets.length} sent=${sent} failed=${failed}`);
  return { sent, failed, errors, events: grades.length, devices: targets.length };
}

export async function notifySyncResult(
  result: SyncResult,
  devices: Device[],
  sender: GradePushSender,
  logger: NotifyLogger = () => {},
): Promise<NotifyResult> {
  if (result.firstRun) {
    logger(`notify grades skipped firstRun devices=${devices.length}`);
    return { sent: 0, failed: 0, errors: [], events: 0, devices: devices.length };
  }
  return notifyGradeEvents(result.events, devices, sender, logger);
}

// --- #77 vie scolaire : détection de nouvelle absence sur DONNÉES STRUCTURÉES ---
// Comparaison d'EMPREINTES d'enregistrements (comme diffAgainstPrints pour
// les notes) : aucun LLM, aucune sortie libre sur le chemin d'un effet métier
// (I7). Le câblage dans l'ordonnanceur de sync reste hors de ce fichier.

/**
 * Empreinte stable d'une absence : TOUT son contenu publié + son id. Une
 * absence corrigée (justifiée, motif ou durée changés) a donc une empreinte
 * différente = nouvelle notification, alors qu'un rejeu du même lot ne
 * notifie rien. Comparer par id seul perdait les corrections silencieuses.
 */
export function absenceFingerprint(r: AbsenceRecord): string {
  return JSON.stringify([
    r.id,
    r.kind,
    r.date,
    r.dateEnd ?? null,
    r.subject ?? null,
    r.motif ?? null,
    r.periodId ?? null,
    r.durationMinutes ?? null,
    r.justified ?? null,
  ]);
}

/** Absences dont l'empreinte n'est pas dans le lot déjà notifié. */
export function newAbsences(
  previousFingerprints: readonly string[],
  records: readonly AbsenceRecord[],
): AbsenceRecord[] {
  const seen = new Set(previousFingerprints);
  return records.filter((r) => isAbsenceRecord(r) && !seen.has(absenceFingerprint(r)));
}

export function formatAbsencePush(record: AbsenceRecord): { title: string; body: string } {
  const title = clean(record.kind === "late" ? "Nouveau retard" : "Nouvelle absence", 120);
  const where = record.subject ? ` en ${record.subject}` : "";
  const motif = record.motif ? ` — ${record.motif}` : "";
  return { title, body: clean(`${localDay(record.date)}${where}${motif}`, 1000) };
}
