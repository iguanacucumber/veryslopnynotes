// Pont factice pour Chromium (`bun run dev:web`) et Playwright. Les formes
// imitent les payloads réels déjà lus par les écrans Compose. Aucun de ces
// objets n'est une donnée personnelle : tout est fictif.
import type {
  PairParams,
  PairResult,
  ResourceKey,
  ResourceParams,
  ResourceResult,
  SessionStatus,
  SettingsSnapshot,
  SubjectPref,
} from "./types";

const now = Date.now();
const iso = (day: number, hour: number, minute = 0): string => {
  const d = new Date(Date.UTC(2026, 9, day, hour, minute));
  return d.toISOString();
};

const subjects = {
  math: "MATHEMATIQUES",
  nsi: "NUMERIQUE SC.INFORM.",
  hg: "HISTOIRE-GEOGRAPHIE",
  ang: "DNL-ANG-LV9",
  philo: "PHILOSOPHIE",
};

const fixtures: Record<ResourceKey, unknown> = {
  capabilities: {
    __untrusted: true,
    items: {
      accountId: "demo",
      fetchedAt: "1970-01-01T00:00:00.000Z",
      tabs: ["grades", "homework", "timetable", "news", "menus", "attendance", "punishments", "profile"],
    },
  },
  periods: {
    __untrusted: true,
    items: [
      { id: "p1", name: "Trimestre 1", start: iso(17, 0), end: iso(8, 0) },
      { id: "p2", name: "Trimestre 2", start: iso(9, 0), end: iso(14, 0) },
    ],
  },
  grades: {
    __untrusted: true,
    items: [
      { id: "g1", subject: subjects.math, label: "DS — suites", value: 16.5, scale: 20, coefficient: 2, date: iso(12, 8), classAverage: 11.8, classMin: 4, classMax: 19, periodId: "p1" },
      { id: "g2", subject: subjects.math, label: "Interrogation — limites", value: 14, scale: 20, coefficient: 1, date: iso(8, 8), classAverage: 12.4, classMin: 3, classMax: 18, periodId: "p1" },
      { id: "g3", subject: subjects.nsi, label: "TP — requêtes SQL", value: 18, scale: 20, coefficient: 1, date: iso(14, 10), classAverage: 13.1, classMin: 6, classMax: 20, periodId: "p1" },
      { id: "g4", subject: subjects.hg, label: "Composition", value: 12.5, scale: 20, coefficient: 2, date: iso(10, 14), classAverage: 11.2, classMin: 5, classMax: 17, periodId: "p1" },
      { id: "g5", subject: subjects.ang, label: "Oral", value: 15, scale: 20, coefficient: 1, date: iso(6, 9), classAverage: 13.7, classMin: 8, classMax: 19, periodId: "p1" },
      { id: "g6", subject: subjects.philo, label: "Dissertation", value: 11, scale: 20, coefficient: 2, date: iso(15, 8), classAverage: 10.5, classMin: 4, classMax: 16, periodId: "p1" },
    ],
  },
  timetable: {
    __untrusted: true,
    items: [
      { id: "c1", subject: subjects.math, start: iso(19, 8), end: iso(19, 10), room: "B14" },
      { id: "c2", subject: subjects.nsi, start: iso(19, 10, 15), end: iso(19, 12, 10), room: "A13" },
      { id: "c3", subject: subjects.hg, start: iso(19, 14), end: iso(19, 16), room: "C13" },
      { id: "c4", subject: subjects.ang, start: iso(20, 8), end: iso(20, 10), room: "A20" },
      { id: "c5", subject: subjects.philo, start: iso(20, 10, 15), end: iso(20, 12, 10), room: "D2" },
      { id: "c6", subject: subjects.math, start: iso(21, 9), end: iso(21, 11), room: "B14", status: "moved" },
      { id: "c7", subject: subjects.nsi, start: iso(22, 8), end: iso(22, 10), room: "A13" },
      { id: "c8", subject: subjects.hg, start: iso(23, 10), end: iso(23, 12), room: "C13", status: "cancelled" },
    ],
  },
  assignments: {
    __untrusted: true,
    items: [
      {
        id: "a1",
        subject: subjects.hg,
        title: "Révision du chapitre sur les régimes totalitaires",
        description: "Relire le II du chapitre et préparer la réponse à une question problématisée.",
        dueDate: iso(25, 20),
        done: false,
      },
      {
        id: "a2",
        subject: subjects.math,
        title: "Exercices 12 à 18 p. 84",
        description: "Suites arithmétiques et géométriques. Justifier chaque réponse.",
        dueDate: iso(21, 20),
        done: true,
      },
      {
        id: "a3",
        subject: subjects.nsi,
        title: "TP — base de données",
        description: "Terminer les requêtes SQL et rendre le script.",
        dueDate: iso(23, 20),
        done: false,
        attachments: [{ id: "att1", label: "sujet-tp.pdf", ref: "homework:1:file:0:att1" }],
      },
    ],
  },
  discussions: {
    __untrusted: true,
    items: [
      { id: "d1", participants: ["M. LUX C.", "FAZZARI Sacha"], lastMessageAt: iso(18, 9) },
      { id: "d2", participants: ["Mme TOURON D.", "FAZZARI Sacha"], lastMessageAt: iso(15, 14) },
    ],
  },
  news: {
    __untrusted: true,
    items: [
      {
        id: "n1",
        title: "Semaine de l'orientation",
        author: "Mme TOURON D.",
        body: "Les ateliers d'orientation ont lieu mardi et jeudi au CDI. Inscription auprès de la vie scolaire.",
        date: iso(16, 8),
      },
      {
        id: "n2",
        title: "Menu du self",
        author: "Intendance",
        body: "Le self ferme exceptionnellement vendredi à 12 h 30.",
        date: iso(14, 8),
      },
    ],
  },
  canteen: {
    __untrusted: true,
    items: [],
  },
  attendance: {
    __untrusted: true,
    items: [
      { id: "at1", kind: "absence", date: iso(12, 8), dateEnd: iso(12, 12), durationMinutes: 240, justified: true, motif: "Maladie", periodId: "p1" },
      { id: "at2", kind: "delay", date: iso(15, 8), dateEnd: iso(15, 8, 20), durationMinutes: 20, justified: false, motif: "Transport", periodId: "p1" },
    ],
  },
  punishments: {
    __untrusted: true,
    items: [],
  },
  alerts: {
    __untrusted: true,
    items: [],
  },
  profile: {
    __untrusted: true,
    items: {
      accountId: "demo",
      displayName: "FAZZARI Sacha",
      firstName: "Sacha",
      lastName: "FAZZARI",
      classLabel: "TG2",
      periodName: "Trimestre 1",
      hasKids: false,
      kids: [],
    },
  },
};

const threads: Record<string, unknown> = {
  d1: {
    __untrusted: true,
    items: [
      { id: "m1", discussionId: "d1", authorName: "M. LUX C.", body: "Le DS de rattrapage aura lieu vendredi en salle poly.", sentAt: iso(18, 9) },
    ],
  },
  d2: {
    __untrusted: true,
    items: [
      { id: "m2", discussionId: "d2", authorName: "Mme TOURON D.", body: "Pensez à rendre l'autorisation signée avant jeudi.", sentAt: iso(15, 14) },
    ],
  },
};

const recipients = {
  __untrusted: true,
  items: [{ id: "r1", name: "M. LUX C." }, { id: "r2", name: "Mme TOURON D." }],
};

let settings: SettingsSnapshot = {
  theme: "SYSTEM",
  serverHost: "10.0.2.2:3000",
  llmConfigured: false,
  accountCount: 1,
};

let prefs: SubjectPref[] = [
  { subject: subjects.math, color: "#3A56D0", emoji: "∑", label: "Maths" },
  { subject: subjects.nsi, color: "#26B290", emoji: "⌘", label: "NSI" },
];

const revisions: unknown[] = [
  {
    id: "rev1",
    title: "Régimes totalitaires — fiche de révision",
    subject: subjects.hg,
    date: iso(17, 18),
    sources: ["a1"],
    body: "1. Définir le totalitarisme.\n2. Comparer les régimes soviétique, fasciste et nazi.\n3. Préparer un plan en trois parties.",
  },
];

const sessions: SessionStatus = { state: "restored" };

function resource(key: ResourceKey): ResourceResult {
  const payload = JSON.stringify(fixtures[key]);
  return { payload, fetchedAt: now, stale: false, error: null };
}

export async function mockCall<T>(method: string, params: unknown): Promise<T> {
  const p = (params ?? {}) as Record<string, unknown>;
  await new Promise((r) => setTimeout(r, 40));
  const ok = <V>(value: V): Promise<V> => Promise.resolve(value as V);
  switch (method) {
    case "app.ready":
      return ok({ ok: true }) as Promise<T>;
    case "app.theme":
      return ok({ theme: settings.theme }) as Promise<T>;
    case "app.setTheme":
      settings = { ...settings, theme: p["theme"] as SettingsSnapshot["theme"] };
      return ok({ ok: true }) as Promise<T>;
    case "app.back":
      return ok({ handled: false }) as Promise<T>;
    case "session.status":
    case "session.restore":
      return ok(sessions) as Promise<T>;
    case "session.logout":
      sessions.state = "no_session";
      return ok({ ok: true }) as Promise<T>;
    case "session.accounts":
      return ok({ count: settings.accountCount }) as Promise<T>;
    case "pairing.scanQr":
      return ok({
        qr: { login: "demo", jeton: "demo", url: "https://demo.school.invalid" },
        cancelled: false,
      }) as Promise<T>;
    case "pairing.pair": {
      const pair = p as unknown as PairParams;
      const result: PairResult = pair.pin
        ? { ok: true }
        : { ok: false, code: "bad_request", message: "PIN requis" };
      if (result.ok) sessions.state = "restored";
      return ok(result) as Promise<T>;
    }
    case "pairing.cancel":
      return ok({ ok: true }) as Promise<T>;
    case "resources.cached":
    case "resources.load":
      return ok(resource((p as unknown as ResourceParams).key)) as Promise<T>;
    case "resources.sync":
      return ok({ ...resource("grades"), stale: false }) as Promise<T>;
    case "resources.invalidate":
      return ok({ ok: true }) as Promise<T>;
    case "capabilities.load":
    case "capabilities.refresh":
      return ok({ tabs: (fixtures.capabilities as { items: { tabs: string[] } }).items.tabs }) as Promise<T>;
    case "assignments.toggle": {
      const items = (fixtures.assignments as { items: Array<{ id: string; done: boolean }> }).items;
      const found = items.find((a) => a.id === p["id"]);
      if (found) found.done = Boolean(p["done"]);
      return ok({ ok: Boolean(found) }) as Promise<T>;
    }
    case "assignments.attachment":
      return ok({ ok: true }) as Promise<T>;
    case "messages.list":
      return ok({ payload: JSON.stringify(fixtures.discussions) }) as Promise<T>;
    case "messages.thread":
      return ok({ payload: JSON.stringify(threads[String(p["id"])] ?? { items: [] }) }) as Promise<T>;
    case "messages.reply":
    case "messages.create":
    case "messages.setRead":
    case "messages.delete":
      return ok({ ok: true }) as Promise<T>;
    case "messages.recipients":
      return ok({ payload: JSON.stringify(recipients) }) as Promise<T>;
    case "settings.get":
      return ok(settings) as Promise<T>;
    case "settings.saveServer":
      settings = { ...settings, serverHost: String(p["host"] ?? "") };
      return ok({ ok: true }) as Promise<T>;
    case "settings.subjectPrefs":
      return ok({ prefs }) as Promise<T>;
    case "settings.saveSubject": {
      const pref = p as unknown as SubjectPref;
      prefs = [...prefs.filter((x) => x.subject !== pref.subject), pref];
      return ok({ ok: true, prefs }) as Promise<T>;
    }
    case "llm.status":
      return ok({ configured: settings.llmConfigured }) as Promise<T>;
    case "llm.saveKey":
      settings = { ...settings, llmConfigured: Boolean(p["key"]) };
      return ok({ ok: Boolean(p["key"]), message: p["key"] ? undefined : "clé vide" }) as Promise<T>;
    case "llm.forgetKey":
      settings = { ...settings, llmConfigured: false };
      return ok({ ok: true }) as Promise<T>;
    case "llm.askHomework":
      return ok({
        ok: true,
        body: "Le corrigé attendu : relier chaque régime à ses caractéristiques (parti unique, terreur, propagande) puis comparer deux régimes.",
      }) as Promise<T>;
    case "llm.generateRevision":
      return ok({ ok: true }) as Promise<T>;
    case "revision.list":
      return ok({ sheets: revisions }) as Promise<T>;
    case "revision.load":
      return ok({ sheet: revisions.find((s) => (s as { id: string }).id === p["id"]) ?? null }) as Promise<T>;
    case "revision.exportPdf":
      return ok({ ok: true }) as Promise<T>;
    case "profile.me":
      return ok({ payload: JSON.stringify({ user: (fixtures.profile as { items: unknown }).items }) }) as Promise<T>;
    case "profile.photo":
      return ok({ dataUrl: null }) as Promise<T>;
    default:
      return Promise.reject(new Error(`méthode factice inconnue: ${method}`));
  }
}
