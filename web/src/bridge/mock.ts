// Pont factice pour Chromium (`bun run dev:web`) et Playwright. Les formes
// imitent les payloads réels déjà lus par les écrans Compose. Aucun de ces
// objets n'est une donnée personnelle : tout est fictif.
//
// DÉVELOPPEMENT SEULEMENT (#423) : `client.ts` ne l'importe que dans une
// branche `import.meta.env.DEV`, donc le build de production ne l'embarque
// pas (le bundle livré à l'APK ne contient aucune donnée scolaire fictice).
// Hors mode dev, un pont natif absent est un ÉCHEC bruyant, jamais ce mock.
import {
  ADD_PHOTO_REPLY,
  CLEARED_MANUAL,
  DEMO_QR,
  EXERCISES,
  FIXTURES as fixtures,
  HELP_ANSWER,
  HOMEWORK_REPLY,
  INITIAL_LESSONS,
  INITIAL_PREFS,
  INITIAL_REVISIONS as revisions,
  INITIAL_SETTINGS,
  LESSONS_LIMITS,
  LLM_CONTEXT,
  MANUAL_DEMO,
  MANUAL_SOURCE,
  NEWS_BODIES as newsBodies,
  PHOTO_REPLY,
  RECIPIENTS as recipients,
  SUBJECTS as subjects,
  TEACHER_ASK_FIRST,
  TEACHER_SOURCES,
  THREADS as threads,
  TIMETABLE_MONDAY,
  teacherAnswer,
} from "./mock-data";
import type {
  LessonNote,
  PairParams,
  PairResult,
  ResourceKey,
  ResourceParams,
  ResourceResult,
  SessionStatus,
  SettingsSnapshot,
  SubjectPref,
  TeacherThread,
} from "./types";

const now = Date.now();

let settings: SettingsSnapshot = INITIAL_SETTINGS;

const manualDisabled = new Set<string>();

let lessons: LessonNote[] = INITIAL_LESSONS;

let prefs: SubjectPref[] = INITIAL_PREFS;

/** Fil local de démonstration (#633) : vide au démarrage, rempli par les tours. */
let teacherThread: TeacherThread = { subject: "", messages: [] };

const sessions: SessionStatus = { state: "restored" };

/** Décalage en semaines entre `weekStart` et la semaine des fixtures. */
function timetableWeeks(query: string | undefined): number {
  const raw = query ? new URLSearchParams(query).get("weekStart") : null;
  if (!raw) return 0;
  const monday = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(monday)) return 0;
  return Math.round((monday - TIMETABLE_MONDAY) / (7 * 86_400_000));
}

/** Recale les cours de démonstration sur la semaine demandée (`weekStart`). */
function timetableFor(query: string | undefined): unknown {
  const weeks = timetableWeeks(query);
  const fixture = fixtures.timetable as { items: Array<Record<string, unknown>> };
  if (weeks === 0) return fixture;
  const delta = weeks * 7 * 86_400_000;
  return {
    ...fixture,
    items: fixture.items.map((item) => {
      const start = typeof item["start"] === "string" ? Date.parse(item["start"]) : NaN;
      const end = typeof item["end"] === "string" ? Date.parse(item["end"]) : NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return item;
      return {
        ...item,
        start: new Date(start + delta).toISOString(),
        end: new Date(end + delta).toISOString(),
      };
    }),
  };
}

function resource(key: ResourceKey, query?: string): ResourceResult {
  const body = key === "timetable" ? timetableFor(query) : fixtures[key];
  const payload = JSON.stringify(body);
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
      return ok(DEMO_QR) as Promise<T>;
    case "pairing.pair": {
      const pair = p as unknown as PairParams;
      const result: PairResult = pair.pin
        ? { ok: true }
        : { ok: false, code: "bad_request", message: "PIN requis" };
      if (result.ok) sessions.state = "restored";
      return ok(result) as Promise<T>;
    }
    case "pairing.pairDemo": {
      // Le pont factice n'a pas d'établissement : la connexion de
      // démonstration ouvre la session factice (développement seulement).
      sessions.state = "restored";
      return ok({ ok: true }) as Promise<T>;
    }
    case "pairing.cancel":
      return ok({ ok: true }) as Promise<T>;
    case "resources.cached":
    case "resources.load": {
      const params = p as unknown as ResourceParams;
      return ok(resource(params.key, params.query)) as Promise<T>;
    }
    case "resources.sync":
      return ok({ ...resource("grades"), stale: false }) as Promise<T>;
    case "resources.invalidate":
      return ok({ ok: true }) as Promise<T>;
    case "capabilities.load":
    case "capabilities.refresh":
      return ok({ tabs: (fixtures.capabilities as { items: { tabs: string[] } }).items.tabs }) as Promise<T>;
    case "news.item":
      return ok({ body: newsBodies[String(p["id"])] ?? "" }) as Promise<T>;
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
    case "settings.saveManualUrl": {
      const url = String(p["url"] ?? "").trim();
      if (url === "") {
        settings = { ...settings, ...CLEARED_MANUAL };
        return ok({ ok: true, ready: false, auto: false }) as Promise<T>;
      }
      if (!/^https?:\/\/\S+$/i.test(url)) {
        return ok({ ok: false, message: "Adresse incomplète : le format attendu est https://…" }) as Promise<T>;
      }
      const auto = /\/manuels\/?$/i.test(url);
      settings = {
        ...settings,
        manualUrl: url,
        manualConfigured: true,
        manualAuto: auto,
        manualReady: !auto,
        manualLevel: MANUAL_DEMO.level,
        manualSpecialties: [...MANUAL_DEMO.specialties],
        manualPromptSeen: true,
      };
      return ok({
        ok: true,
        ready: !auto,
        auto,
        level: settings.manualLevel,
        specialties: settings.manualSpecialties,
      }) as Promise<T>;
    }
    case "settings.dismissManualPrompt":
      settings = { ...settings, manualPromptSeen: true };
      return ok({ ok: true }) as Promise<T>;
    case "settings.subjectPrefs":
      return ok({ prefs }) as Promise<T>;
    case "settings.saveSubject": {
      const pref = p as unknown as SubjectPref;
      prefs = [...prefs.filter((x) => x.subject !== pref.subject), pref];
      return ok({ ok: true, prefs }) as Promise<T>;
    }
    case "lessons.list": {
      const known = [...new Set([...Object.values(subjects), ...prefs.map((x) => x.subject), ...lessons.map((n) => n.subject)])];
      return ok({
        subjects: known.map((subject) => ({
          subject,
          manualEnabled: !manualDisabled.has(subject),
          manualAvailable: !manualDisabled.has(subject) && settings.manualConfigured,
          notes: lessons
            .filter((note) => note.subject === subject)
            .map((note) => ({ id: note.id, title: note.title, createdAt: note.createdAt, chars: note.text.length })),
        })),
        ...LESSONS_LIMITS,
      }) as Promise<T>;
    }
    case "lessons.load": {
      const note = lessons.find((item) => item.id === String(p["id"] ?? ""));
      return ok(note ? { ok: true, note } : { ok: false, message: "Cours introuvable." }) as Promise<T>;
    }
    case "lessons.save": {
      const id = String(p["id"] ?? "").trim();
      const subject = String(p["subject"] ?? "").trim();
      const title = String(p["title"] ?? "").trim();
      const text = String(p["text"] ?? "").trim();
      if (!subject || !title || !text || text.length > 4000 || title.length > 120) {
        return ok({ ok: false, message: "Cours invalide." }) as Promise<T>;
      }
      const existing = id ? lessons.find((item) => item.id === id) : null;
      if (id && !existing) return ok({ ok: false, message: "Cours introuvable." }) as Promise<T>;
      const note: LessonNote = {
        id: existing?.id ?? `l${lessons.length + 1}`,
        subject,
        title,
        text,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      lessons = existing ? lessons.map((item) => (item.id === note.id ? note : item)) : [note, ...lessons];
      settings = { ...settings, lessonSubjects: [...new Set(lessons.map((item) => item.subject))] };
      return ok({ ok: true }) as Promise<T>;
    }
    case "lessons.delete": {
      const id = String(p["id"] ?? "");
      if (!lessons.some((item) => item.id === id)) {
        return ok({ ok: false, message: "Cours introuvable." }) as Promise<T>;
      }
      lessons = lessons.filter((item) => item.id !== id);
      settings = { ...settings, lessonSubjects: [...new Set(lessons.map((item) => item.subject))] };
      return ok({ ok: true }) as Promise<T>;
    }
    case "lessons.setManual": {
      const subject = String(p["subject"] ?? "").trim();
      if (!subject) return ok({ ok: false, message: "Matière invalide." }) as Promise<T>;
      if (p["enabled"] === false) manualDisabled.add(subject);
      else manualDisabled.delete(subject);
      return ok({ ok: true, enabled: p["enabled"] !== false }) as Promise<T>;
    }
    case "lessons.addPhoto": {
      const subject = String(p["subject"] ?? "").trim();
      if (!subject) return ok({ ok: false, message: "Choisis une matière." }) as Promise<T>;
      return ok(ADD_PHOTO_REPLY) as Promise<T>;
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
      return ok(HOMEWORK_REPLY) as Promise<T>;
    case "llm.solvePhoto":
      return ok(PHOTO_REPLY) as Promise<T>;
    case "llm.generateRevision": {
      const id = String(p["assignmentId"] ?? "");
      const assignment = (
        fixtures.assignments as { items: Array<{ id: string; subject: string; title: string; dueDate: string }> }
      ).items.find((item) => item.id === id);
      if (!assignment) return ok({ ok: false, message: "Devoir introuvable." }) as Promise<T>;
      const sheetId = `rev-${assignment.id}`;
      if (!revisions.some((sheet) => (sheet as { id: string }).id === sheetId)) {
        revisions.unshift({
          id: sheetId,
          title: `Fiche révision — ${assignment.title}`,
          subject: assignment.subject,
          date: assignment.dueDate,
          sources: [assignment.id],
          body: `1. Relire la consigne : ${assignment.title}.\n2. Retenir les notions clés.\n3. S'entraîner sur un exercice.`,
        });
      }
      return ok({
        ok: true,
        context: LLM_CONTEXT,
        contextChars: 1380,
        contextOmitted: 0,
      }) as Promise<T>;
    }
    case "llm.teacherTurn": {
      const subject = String(p["subject"] ?? "").trim();
      const question = String(p["message"] ?? "").trim();
      const history = Array.isArray(p["history"]) ? p["history"] : [];
      const sources = TEACHER_SOURCES;
      return ok({
        ok: true,
        answer: subject && question ? teacherAnswer(question) : TEACHER_ASK_FIRST,
        sources: ["Cahier : Chapitre 1 — suites"],
        unsourced: false,
        context: sources,
        contextChars: sources.reduce((sum, source) => sum + source.chars, 0),
        contextOmitted: 0,
        historyCount: history.length,
        historyChars: history.reduce((sum, item) => {
          const text = typeof item === "object" && item !== null ? String((item as { text?: unknown }).text ?? "") : "";
          return sum + text.length;
        }, 0),
        summaryChars: 0,
      }) as Promise<T>;
    }
    case "teacher.load":
      return ok({ subject: teacherThread.subject, messages: teacherThread.messages }) as Promise<T>;
    case "teacher.save": {
      const subject = String(p["subject"] ?? "").trim();
      const messages = Array.isArray(p["messages"]) ? p["messages"] : [];
      teacherThread = { subject, messages: messages.slice(-40) as TeacherThread["messages"] };
      return ok({ ok: true, count: teacherThread.messages.length }) as Promise<T>;
    }
    case "teacher.delete":
      teacherThread = { subject: "", messages: [] };
      return ok({ ok: true }) as Promise<T>;
    case "exercises.propose": {
      const subject = String(p["subject"] ?? "").trim();
      const hint = String(p["hint"] ?? "").trim();
      const exercises = EXERCISES.filter(
        (item) => hint === "" || `${item.number} ${item.statement}`.toLowerCase().includes(hint.toLowerCase()),
      );
      return ok({
        ok: true,
        exercises: subject ? exercises : [],
        manual: Boolean(subject),
        manualReady: Boolean(subject),
        manualTitle: subject ? "Mathématiques 1re" : "",
        manualPage: 84,
        ...(subject && exercises.length === 0
          ? { message: `Aucun exercice ne correspond à « ${hint} ».`, actions: ["add_course"] }
          : {}),
      }) as Promise<T>;
    }
    case "exercises.help": {
      const subject = String(p["subject"] ?? "").trim();
      const number = String(p["number"] ?? "").trim();
      const mode = String(p["mode"] ?? "hint");
      const answer = (HELP_ANSWER[mode] ?? HELP_ANSWER["hint"]!)(number);
      return ok({
        ok: true,
        answer: subject ? answer : "Choisis une matière.",
        sources: ["Manuel : Mathématiques 1re"],
        unsourced: false,
        mode,
        context: [MANUAL_SOURCE],
        contextChars: 1200,
        contextOmitted: 0,
      }) as Promise<T>;
    }
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
    case "bridge.cancel":
      // Abandon : le pont factice n'a rien à faire, l'appel est déjà lâché.
      return ok({ ok: true }) as Promise<T>;
    default:
      return Promise.reject(new Error(`méthode factice inconnue: ${method}`));
  }
}
