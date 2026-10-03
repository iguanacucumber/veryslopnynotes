// Revue adversariale push (push-config / push-provider / notify).
// Chaque test cible UN bug et doit être ROUGE sur le code actuel.
// Aucun réseau : fetch global stubbé puis restauré (afterEach).
// Données synthétiques uniquement, aucun secret réel (jetons "a"*64, clés factices).
import { afterEach, describe, expect, test } from "bun:test";
import { localDay } from "../../shared/contracts/api";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import type { AbsenceRecord, Device, Grade } from "../../shared/contracts/models";
import type { ContractEvent } from "../../shared/contracts/events";
import { HttpPushProvider, PushError, createPushProvider } from "../../server/infrastructure/push-provider";
import { formatAbsencePush, formatGradePush, newAbsences, notifyGradeEvents } from "../../server/jobs/notify";
import type { GradePushSender } from "../../server/jobs/notify";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const DEVICES: Device[] = [
  { id: "d1", tokenHash: HASH_A },
  { id: "d2", tokenHash: HASH_B },
];

// Horodatages figés : aucun Date.now(), aucun sommeil dans ces tests.
const GRADE_DATE = "2026-09-20T10:00:00.000Z";
const EVENT_AT = "2026-09-21T10:00:00.000Z";

const grade = (id: string, value = 14, subject = "Maths"): Grade => ({
  id,
  accountId: "acc-fake-1",
  subject,
  value,
  scale: 20,
  date: GRADE_DATE,
});

const gradeEvent = (g: Grade): ContractEvent => ({
  v: CONTRACTS_VERSION,
  type: "GradeCreated",
  at: EVENT_AT,
  data: g,
});

function recorder(failWith?: () => never): { calls: string[]; sender: GradePushSender } {
  const calls: string[] = [];
  const sender: GradePushSender = {
    send: async (hash) => {
      calls.push(hash);
      if (failWith) failWith();
    },
  };
  return { calls, sender };
}

// Un surrogate non apparié (haut ou bas) = UTF-16 invalide sur l'appareil.
function aSurrogateSeul(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

const fetchReel = globalThis.fetch;

afterEach(() => {
  // Restaure le vrai fetch : aucun stub ne doit fuir vers les autres tests.
  globalThis.fetch = fetchReel;
});

describe("bugs push", () => {
  // 1. CRITIQUE : un provider qui ne livre RIEN résout sans erreur -> `sent`
  //    incrémenté -> le job se croit notifié alors que la push est perdue.
  test("BUG: push comptée comme envoyée alors que le provider ne livre rien (noop / provider symbolique) — le job rapporte un succès alors que la notification est perdue", async () => {
    const sansConfig = createPushProvider({}); // pas de PUSH_* => NoopPushProvider
    const resNoop = await notifyGradeEvents([gradeEvent(grade("g1"))], DEVICES, sansConfig);
    expect(resNoop.sent).toBe(0);

    // Même défaut chez HttpPushProvider quand PUSH_PROVIDER n'est pas une URL :
    // il log « skip » et résout, donc l'appelant compte une livraison.
    const symbolique = createPushProvider({
      PUSH_PROVIDER: "webpush",
      PUSH_VAPID_PUBLIC_KEY: "PUB-FAKE",
      PUSH_VAPID_PRIVATE_KEY: "PRIV-FAKE",
    });
    const resSymbolique = await notifyGradeEvents([gradeEvent(grade("g1"))], DEVICES, symbolique);
    expect(resSymbolique.sent).toBe(0);
  });

  // 2. CRITIQUE : `catch {}` avale la cause ; le journal ne garde que des
  //    compteurs et le snapshot est DÉJÀ sauvé par runSync -> panne provider
  //    invisible, et la notification d'un delta n'est jamais rejouée.
  test("BUG: cause d'échec d'envoi avalée (compteurs seuls au log) — une panne du provider est indiscernable d'un succès et la notification perdue n'est jamais rejouée", async () => {
    const logs: string[] = [];
    const { calls, sender } = recorder(() => {
      throw new PushError("push http 503", 503);
    });
    const res = await notifyGradeEvents([gradeEvent(grade("g1"))], DEVICES, sender, (m) => logs.push(m));
    expect(calls.length).toBe(2);
    expect(res.failed).toBe(2);
    // La cause doit rester observable (503) pour l'exploitation et le rejeu.
    expect(logs.join("\n")).toContain("503");
  });

  // 3. SÉCURITÉ : un endpoint push distant en http:// est accepté -> note et
  //    empreinte de device en clair sur le réseau. Seul le loopback (test
  //    d'intégration local) a une raison d'être en clair.
  test("BUG: endpoint push distant en http:// accepté — note et hash de device transmis en clair (seul le loopback doit être toléré)", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const distant = new HttpPushProvider({
      provider: "http://push.example.invalid/send",
      vapidPublicKey: "PUB-FAKE",
      vapidPrivateKey: "PRIV-FAKE",
      subject: "mailto:push@example.invalid",
    });
    await distant.send(HASH_A, { title: "Nouvelle note", body: "15/20 en Maths" }).catch(() => {});
    expect(calls).toBe(0);

    // Garde-fou : le loopback http reste accepté (test d'intégration local).
    const loopback = new HttpPushProvider({
      provider: "http://127.0.0.1:9/send",
      vapidPublicKey: "PUB-FAKE",
      vapidPrivateKey: "PRIV-FAKE",
      subject: "mailto:push@example.invalid",
    });
    await loopback.send(HASH_A, { title: "Nouvelle note", body: "15/20 en Maths" }).catch(() => {});
    expect(calls).toBe(1);
  });

  // 4. FAUX AFFICHAGE : record.date est un ISO UTC ; `.slice(0, 10)` renvoie
  //    le jour UTC, pas le jour local de l'élève (ici +2h en Europe/Paris).
  test("BUG: date d'absence affichée en jour UTC et non en date locale — l'élève voit la veille pour un retard nocturne", () => {
    const record: AbsenceRecord = {
      id: "a1",
      accountId: "acc-fake-1",
      kind: "late",
      // 23h30 UTC = 01h30 le lendemain en Europe/Paris.
      date: "2026-10-01T23:30:00.000Z",
      subject: "Maths",
    };
    // Jour LOCAL attendu, source unique du dépôt (shared/contracts/api.ts).
    const attendu = localDay(record.date);
    expect(attendu).toBe("2026-10-02");
    const body = formatAbsencePush(record).body;
    expect(body).toContain(attendu);
    expect(body).not.toContain("2026-10-01 en");
  });

  // 5. DOUBLE ENVOI : aucun dedup par id de note ni clé d'idempotence ; le
  //    rejeu d'un même lot de sync notifie deux fois (crash entre
  //    saveSnapshot et notify, ou retry de job).
  test("BUG: aucun dedup par id dans le lot d'événements — le rejeu d'un même sync notifie la même note en double", async () => {
    const g = grade("g1", 15);
    const { calls, sender } = recorder();
    const res = await notifyGradeEvents([gradeEvent(g), gradeEvent(g)], DEVICES, sender);
    expect(res.events).toBe(1);
    // 1 note distincte × 2 devices = 2 envois (actuellement 4 : le doublon d'événement est re-notifié).
    expect(calls.length).toBe(2);
  });

  // 6. MANQUE : newAbsences compare par id seul (les notes comparent par
  //    empreinte) -> une absence corrigée/justifiée en silence n'est jamais
  //    notifiée.
  test("BUG: newAbsences compare par id seulement — une absence corrigée (justifiée) n'est jamais notifiée", () => {
    const avant: AbsenceRecord = {
      id: "a1",
      accountId: "acc-fake-1",
      kind: "absence",
      date: "2026-10-01T08:00:00.000Z",
      justified: false,
    };
    const corrigee: AbsenceRecord = { ...avant, justified: true };
    const nouveaux = newAbsences(["a1"], [corrigee]);
    expect(nouveaux.length).toBe(1);
  });

  // 7. PAYLOAD : clean() tronque en unités UTF-16 et coupe un surrogate
  //    pair -> caractère de remplacement côté appareil (payload invalide).
  test("BUG: clean() coupe une paire de surrogates — la coupure à 120 chars produit un caractère invalide dans la notification", () => {
    // 102 ASCII + emoji (2 unités UTF-16) : la coupe tombe sur le haut du surrogate.
    const subject = "a".repeat(102) + "\u{1F600}";
    const p = formatGradePush(grade("g1", 14, subject));
    expect(p.title.length).toBe(120);
    expect(aSurrogateSeul(p.title)).toBe(false);
    expect(aSurrogateSeul(p.body)).toBe(false);
  });
});