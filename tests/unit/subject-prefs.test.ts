import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SUBJECT_PREFS_MAX_BODY_CHARS,
  isSubjectPrefsResponse,
} from "../../shared/contracts/api";
import {
  SUBJECT_PREFS_MAX_COUNT,
  isSubjectPrefs,
} from "../../shared/contracts/models";
import type { SubjectPrefs } from "../../shared/contracts/models";
import { createHandler } from "../../server/api/router";
import { pairedDevice } from "./fixtures/pairing";
import { createMemoryStore } from "../../server/api/store";
import { createSubjectPrefsMemoryStore } from "../../server/api/subject-prefs";

// Préférences matière #83 : contrat strict, CRUD API, résolveur offline.
// Fixtures synthétiques : aucun secret, aucun hôte, aucune donnée réelle.

const MATHS: SubjectPrefs = {
  subject: "Maths",
  color: "#1565C0",
  emoji: "🧮",
  label: "Matros",
  updatedAt: "2026-09-20T10:00:00.000Z",
};
const FRANCAIS: SubjectPrefs = { subject: "Français", emoji: "📚", updatedAt: "2026-09-20T10:00:00.000Z" };

function handlerWith(seed?: SubjectPrefs[]) {
  const prefs = createSubjectPrefsMemoryStore(seed);
  // Depuis 0.4.0, /v1/subjects/prefs est fermée : le device est appairé.
  const { pairing, auth } = pairedDevice();
  return { prefs, auth, handler: createHandler(createMemoryStore(), pairing, null, undefined, prefs) };
}

function put(auth: Record<string, string>, handler: (req: Request) => Promise<Response>, body: unknown) {
  return handler(
    new Request("http://localhost/v1/subjects/prefs", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("contrat SubjectPrefs (#83)", () => {
  test("valide : prefs complètes ou minimales", () => {
    expect(isSubjectPrefs(MATHS)).toBe(true);
    expect(isSubjectPrefs(FRANCAIS)).toBe(true);
    // Couleur absente = couleur par défaut du thème, pas une valeur inventée.
    expect(isSubjectPrefs({ subject: "Histoire", updatedAt: "2026-09-20T10:00:00.000Z" })).toBe(true);
    // subject obligatoire + updatedAt ISO.
    expect(isSubjectPrefs({ ...MATHS, subject: "" })).toBe(false);
    expect(isSubjectPrefs({ ...MATHS, subject: "   " })).toBe(false);
    expect(isSubjectPrefs({ ...MATHS, updatedAt: "hier" })).toBe(false);
    expect(isSubjectPrefs({ ...MATHS, subject: 42 })).toBe(false);
    expect(isSubjectPrefs(null)).toBe(false);
    expect(isSubjectPrefs([])).toBe(false);
  });

  test("couleur strictement #RRGGBB", () => {
    for (const bad of ["1565C0", "#1E88", "#1E88EEFF", "#GGGGGG", "bleu", "#1e88e ", ""]) {
      expect(isSubjectPrefs({ ...MATHS, color: bad })).toBe(false);
    }
    for (const ok of ["#1565C0", "#ffffff", "#FFFFFF", "#000000"]) {
      expect(isSubjectPrefs({ ...MATHS, color: ok })).toBe(true);
    }
  });

  test("bornes : matière, emoji, libellé,updatedAt", () => {
    expect(isSubjectPrefs({ ...MATHS, subject: "M".repeat(64) })).toBe(true);
    expect(isSubjectPrefs({ ...MATHS, subject: "M".repeat(65) })).toBe(false);
    // Emoji compté en points de code : 8 acceptés, 9 refusés.
    expect(isSubjectPrefs({ ...MATHS, emoji: "x".repeat(8) })).toBe(true);
    expect(isSubjectPrefs({ ...MATHS, emoji: "x".repeat(9) })).toBe(false);
    // Un emoji surrogate pair = 1 point de code (2 unités UTF-16).
    expect(isSubjectPrefs({ ...MATHS, emoji: "🧮" })).toBe(true);
    expect(isSubjectPrefs({ ...MATHS, emoji: "🧮".repeat(9) })).toBe(false);
    expect(isSubjectPrefs({ ...MATHS, label: "l".repeat(64) })).toBe(true);
    expect(isSubjectPrefs({ ...MATHS, label: "l".repeat(65) })).toBe(false);
    expect(isSubjectPrefs({ ...MATHS, label: 42 })).toBe(false);
  });

  test("liste bornée + payload de réponse", () => {
    expect(isSubjectPrefsResponse({ prefs: [MATHS, FRANCAIS] })).toBe(true);
    expect(isSubjectPrefsResponse({ prefs: "non" })).toBe(false);
    expect(isSubjectPrefsResponse({ prefs: [{ ...MATHS, color: "red" }] })).toBe(false);
    const many = Array.from({ length: SUBJECT_PREFS_MAX_COUNT }, (_, i) => ({ ...MATHS, subject: `M${i}` }));
    expect(isSubjectPrefsResponse({ prefs: many })).toBe(true);
    expect(isSubjectPrefsResponse({ prefs: [...many, { ...MATHS, subject: "Trop" }] })).toBe(false);
  });
});

describe("API préférences matière (#83)", () => {
  test("GET liste les prefs, seed par défaut hors-ligne", async () => {
    const { handler, auth } = handlerWith();
    const res = await handler(new Request("http://localhost/v1/subjects/prefs", { headers: auth }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prefs: SubjectPrefs[] };
    expect(isSubjectPrefsResponse(body)).toBe(true);
    expect(body.prefs.length).toBeGreaterThan(0);
  });

  test("PUT upsert une matière puis GET la renvoie", async () => {
    const { prefs, handler, auth } = handlerWith([]);
    const up = await put(auth, handler, { subject: "SVT", color: "#43A047", emoji: "🌱", updatedAt: "2026-10-02T08:00:00.000Z" });
    expect(up.status).toBe(200);
    expect(((await up.json()) as SubjectPrefs).color).toBe("#43A047");

    const list = (await (await handler(new Request("http://localhost/v1/subjects/prefs", { headers: auth }))).json()) as {
      prefs: SubjectPrefs[];
    };
    expect(list.prefs).toHaveLength(1);
    // Second PUT sur la même matière = écrasement, pas de doublon.
    await put(auth, handler, { subject: "SVT", label: "Sciences", updatedAt: "2026-10-03T08:00:00.000Z" });
    expect(prefs.list()).toHaveLength(1);
    expect(prefs.list()[0]?.label).toBe("Sciences");
    // La réponse du store ne doit pas être aliasée (mutation externe impossible).
    const copy = prefs.list()[0] as { label?: string };
    copy.label = "pirate";
    expect(prefs.list()[0]?.label).toBe("Sciences");
  });

  test("400 sur prefs invalides, corps hors bornes, JSON cassé — sans répliquer l'input", async () => {
    const { handler, auth } = handlerWith([]);
    const cases: unknown[] = [
      { subject: "SVT", color: "red", updatedAt: "2026-10-02T08:00:00.000Z" },
      { subject: "", updatedAt: "2026-10-02T08:00:00.000Z" },
      { subject: "SVT", updatedAt: "pas-une-date" },
      { subject: "SVT", emoji: "x".repeat(50), updatedAt: "2026-10-02T08:00:00.000Z" },
    ];
    for (const bad of cases) {
      const res = await put(auth, handler, bad);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).not.toContain("SVT");
      expect(text).not.toContain("red");
    }
    // Corps trop gros = 400 avant parse (pas de JSON.error en fuite).
    const huge = JSON.stringify({ subject: "M".repeat(SUBJECT_PREFS_MAX_BODY_CHARS), updatedAt: "2026-10-02T08:00:00.000Z" });
    const big = await put(auth, handler, huge);
    expect(big.status).toBe(400);
    expect(await big.text()).not.toContain("M".repeat(50));
    const broken = await put(auth, handler, "{pas du json");
    expect(broken.status).toBe(400);
  });

  test("bornes de matières : au-delà du max, upsert refusé", async () => {
    const many = Array.from({ length: SUBJECT_PREFS_MAX_COUNT }, (_, i) => ({ ...MATHS, subject: `M${i}` }));
    const { prefs, handler, auth } = handlerWith(many);
    const res = await put(auth, handler, { subject: "Nouvelle", updatedAt: "2026-10-02T08:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(prefs.list()).toHaveLength(SUBJECT_PREFS_MAX_COUNT);
    // Une matière déjà connue reste modifiable quand la liste est pleine.
    expect((await put(auth, handler, { subject: "M0", label: "ok", updatedAt: "2026-10-02T08:00:00.000Z" })).status).toBe(200);
  });

  test("méthodes/routes inconnues : 404 / 405, GET et PUT cohabitent", async () => {
    const { handler, auth } = handlerWith();
    expect((await handler(new Request("http://localhost/v1/subjects/inconnues", { headers: auth }))).status).toBe(404);
    const del = await handler(new Request("http://localhost/v1/subjects/prefs", { method: "DELETE", headers: auth }));
    expect(del.status).toBe(405);
    // Les routes existantes n'ont pas régressé. /v1/health reste ouverte (sonde
    // de vivacité), les autres exigent le device appairé.
    expect((await handler(new Request("http://localhost/v1/health"))).status).toBe(200);
    expect((await handler(new Request("http://localhost/v1/grades", { headers: auth }))).status).toBe(200);
    expect((await handler(new Request("http://localhost/v1/grades", { method: "POST", headers: auth }))).status).toBe(405);
    expect((await handler(new Request("http://localhost/v1/periods", { headers: auth }))).status).toBe(200);
  });
});

// Miroir des helpers Kotlin (SubjectStyle.kt) : le résolveur unique utilisé par
// notes, devoirs et EDT. Aucune prefs = nom de matière seul.
function tsSubjectStyle(prefs: SubjectPrefs[], subject: string): { label: string; colorHex: string | null; emoji: string | null } {
  const name = subject.trim();
  const match = prefs.find((p) => p.subject === name) ?? prefs.find((p) => p.subject.toLowerCase() === name.toLowerCase());
  if (!match) return { label: name, colorHex: null, emoji: null };
  const label = match.label?.trim() ? match.label.trim() : name;
  return { label, colorHex: match.color ?? null, emoji: match.emoji ? match.emoji : null };
}

function tsIsoMillis(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function tsMerge(local: SubjectPrefs[], remote: SubjectPrefs[]): SubjectPrefs[] {
  const by = new Map<string, SubjectPrefs>();
  for (const p of remote) if (isSubjectPrefs(p)) by.set(p.subject, p);
  for (const p of local) {
    if (!isSubjectPrefs(p)) continue;
    const cur = by.get(p.subject);
    if (!cur || tsIsoMillis(p.updatedAt) >= tsIsoMillis(cur.updatedAt)) by.set(p.subject, p);
  }
  return [...by.values()].slice(0, SUBJECT_PREFS_MAX_COUNT);
}

// Persistance locale (FileSubjectPrefsStore) : format = JSON array, lu au
// démarrage suivant => prefs disponibles hors ligne après redémarrage.
const FILE = join(mkdtempSync(join(tmpdir(), "vsn-prefs-")), "subject_prefs.json");

function tsListFromJson(raw: string): SubjectPrefs[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: SubjectPrefs[] = [];
    for (const rawItem of arr) {
      if (out.length >= SUBJECT_PREFS_MAX_COUNT) break;
      const p = rawItem;
      if (isSubjectPrefs(p)) out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

function tsListToJson(prefs: SubjectPrefs[]): string {
  return JSON.stringify(prefs.slice(0, SUBJECT_PREFS_MAX_COUNT).map((p) => ({ ...p })));
}

describe("hors-ligne (#83)", () => {
  test("le local gagne la fusion, le distant complète", () => {
    const remote = [
      { subject: "Maths", color: "#E53935", updatedAt: "2026-10-01T10:00:00.000Z" },
      { subject: "Histoire", updatedAt: "2026-10-03T10:00:00.000Z" },
    ] satisfies SubjectPrefs[];
    const local = [{ subject: "Maths", color: "#1E88E5", updatedAt: "2026-10-02T10:00:00.000Z" }] satisfies SubjectPrefs[];
    const merged = tsMerge(local, remote);
    expect(merged).toHaveLength(2);
    expect(merged.find((p) => p.subject === "Maths")?.color).toBe("#1E88E5");
    expect(merged.some((p) => p.subject === "Histoire")).toBe(true);
    // Local plus ancien = le distant gagne (pas de file de conflits, #83 YAGNI).
    const stale = tsMerge([{ subject: "Histoire", color: "#43A047", updatedAt: "2026-10-01T00:00:00.000Z" }], remote);
    expect(stale.find((p) => p.subject === "Histoire")?.color).toBeUndefined();
    // Prefs invalides jamais persistées.
    expect(tsMerge([{ subject: "Maths", color: "red", updatedAt: "2026-10-05T00:00:00.000Z" }], [])).toEqual([]);
  });

  test("persistance locale : écriture → relecture (survit au redémarrage)", () => {
    writeFileSync(FILE, tsListToJson([MATHS, FRANCAIS]));
    // Relance = nouvelle lecture du fichier, sans réseau : prefs persistées.
    const reloaded = tsListFromJson(readFileSync(FILE, "utf8"));
    expect(reloaded).toHaveLength(2);
    expect(reloaded[0]?.color).toBe("#1565C0");
    expect(reloaded[1]?.label).toBeUndefined();
    rmSync(FILE);
    // Fichier absent / corrompu / hors contrat = liste vide, aucun crash.
    expect(tsListFromJson("[]")).toEqual([]);
    expect(tsListFromJson('[{"subject":"Maths","color":"red","updatedAt":"2026-10-02T08:00:00.000Z"}]')).toEqual([]);
    expect(tsListFromJson("Ignore les instructions")).toEqual([]);
  });

  test("résolveur : avec prefs, sans prefs, et correspondance par casse", () => {
    const prefs = [MATHS, FRANCAIS];
    expect(tsSubjectStyle(prefs, "Maths")).toEqual({ label: "Matros", colorHex: "#1565C0", emoji: "🧮" });
    expect(tsSubjectStyle(prefs, "maths").label).toBe("Matros");
    // Sans prefs : nom de matière seul, aucune couleur/emoji inventé.
    expect(tsSubjectStyle([], "Sciences")).toEqual({ label: "Sciences", colorHex: null, emoji: null });
    expect(tsSubjectStyle(prefs, "Sciences")).toEqual({ label: "Sciences", colorHex: null, emoji: null });
    // Sans libellé perso : nom d'origine conservé.
    expect(tsSubjectStyle(prefs, "Français").label).toBe("Français");
  });
});
