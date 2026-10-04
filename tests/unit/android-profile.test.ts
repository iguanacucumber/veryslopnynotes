// Miroir TS des helpers Kotlin #82 (profil + accueil). org.json = SDK Android,
// SharedPreferences = plateforme : aucune dépendance ajoutée (garde deps en bas).
// Rôle : figer le comportement que le Kotlin exécute (parse /v1/me, widgets
// d'accueil, déconnexion) + vérifier le câblage et l'absence d'URL Pronote.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PHOTO_REF_PREFIX, isOpaquePhotoRef, isUserInfo } from "../../shared/contracts/models";
import { CACHEABLE_RESOURCES } from "../../shared/contracts/cache";
import {
  syntheticAssignmentsPayload,
  syntheticGradesPayload,
  syntheticParentUserInfo,
  syntheticProfileClient,
  syntheticTimetablePayload,
  syntheticUserInfo,
} from "./fixtures/profile";

const ROOT = join(import.meta.dir, "..", "..");
const ANDROID = join(ROOT, "android");
const CORE = join(ANDROID, "core/src/main/java/fr/veryslopnynotes/core");
const DATA = join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui");
const read = (p: string) => readFileSync(p, "utf8");

// --- miroir de ProfileRepository.parse (android/data/ProfileRepository.kt) ---
type Child = { accountId: string; displayName: string; classLabel: string };
type Profile = {
  accountId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  classLabel: string;
  periodName: string;
  photoRef: string;
  hasKids: boolean;
  kids: Child[];
};

const MAX_NAME = 64;
const PHOTO_REF_RE = /^photo:[A-Za-z0-9._-]{1,150}$/;
function tsIsValid(p: Profile): boolean {
  if (p.accountId.trim() === "" || p.accountId.length > 64) return false;
  if (p.displayName.trim() === "" || p.displayName.length > MAX_NAME) return false;
  if (p.firstName.length > MAX_NAME || p.lastName.length > MAX_NAME) return false;
  if (p.classLabel.length > MAX_NAME || p.periodName.length > MAX_NAME) return false;
  if (p.photoRef !== "" && !(p.photoRef.length <= 200 && PHOTO_REF_RE.test(p.photoRef))) return false;
  if (p.kids.length > 8) return false;
  for (const k of p.kids) {
    if (k.accountId.trim() === "" || k.accountId.length > 64) return false;
    if (k.displayName.trim() === "" || k.displayName.length > MAX_NAME) return false;
  }
  return true;
}

function tsParse(body: string): Profile | null {
  try {
    const root = JSON.parse(body) as Record<string, unknown>;
    if (root["user"] === null || root["user"] === undefined) return null;
    const u = root["user"] as Record<string, unknown>;
    if (typeof u !== "object" || u === null) return null;
    const str = (k: string) => {
      const v = u[k];
      return typeof v === "string" ? v.trim() : "";
    };
    const kids: Child[] = [];
    if (Array.isArray(u["kids"])) {
      for (const k of u["kids"] as unknown[]) {
        if (typeof k !== "object" || k === null) continue;
        const r = k as Record<string, unknown>;
        kids.push({
          accountId: typeof r["accountId"] === "string" ? r["accountId"].trim() : "",
          displayName: typeof r["displayName"] === "string" ? r["displayName"].trim() : "",
          classLabel: typeof r["classLabel"] === "string" ? r["classLabel"].trim() : "",
        });
      }
    }
    const p: Profile = {
      accountId: str("accountId"),
      displayName: str("displayName"),
      firstName: str("firstName"),
      lastName: str("lastName"),
      classLabel: str("classLabel"),
      periodName: str("periodName"),
      photoRef: str("photoRef"),
      hasKids: u["hasKids"] === true,
      kids,
    };
    return tsIsValid(p) ? p : null;
  } catch {
    return null;
  }
}

// --- miroir de AccountStore (android/data/AccountStore.kt) ---
class TsAccountStore {
  ids: string[] = [];
  current: string | null = null;
  purged: string[] = [];
  tokenCleared = false;
  constructor(private readonly max = 8) {}
  add(id: string): boolean {
    const v = id.trim();
    if (v === "" || v.length > 64) return false;
    if (this.ids.includes(v)) return false;
    if (this.ids.length >= this.max) return false;
    this.ids.push(v);
    if (this.current === null) this.current = v;
    return true;
  }
  select(id: string): void {
    if (this.ids.includes(id.trim())) this.current = id.trim();
  }
  remove(id: string): void {
    this.ids = this.ids.filter((i) => i !== id.trim());
    if (this.current === id.trim()) this.current = null;
  }
  isAnonymous(): boolean {
    return this.ids.length === 0;
  }
  logout(resources: readonly string[]): void {
    this.tokenCleared = true;
    for (const r of resources) this.purged.push(r);
    this.ids = [];
    this.current = null;
  }
}

// --- miroir des widgets d'accueil (android/ui/HomeWidgets.kt) ---
function tsUpcoming(payload: string, nowIso: string, limit = 3): { subject: string; start: string; room: string }[] {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const entries = Array.isArray(root["entries"]) ? (root["entries"] as unknown[]) : [];
    const out: { subject: string; start: string; room: string }[] = [];
    for (const e of entries) {
      if (typeof e !== "object" || e === null) continue;
      const r = e as Record<string, unknown>;
      const subject = typeof r["subject"] === "string" ? r["subject"].trim() : "";
      const start = typeof r["start"] === "string" ? r["start"].trim() : "";
      const end = typeof r["end"] === "string" ? r["end"].trim() : "";
      if (subject === "" || start === "" || end === "") continue;
      if (end < nowIso) continue;
      out.push({ subject, start, room: typeof r["room"] === "string" ? r["room"].trim() : "" });
    }
    out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    return out.slice(0, limit > 0 ? limit : 5);
  } catch {
    return [];
  }
}

function tsPending(payload: string, nowIso: string, limit = 3): { subject: string; title: string; dueDate: string }[] {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const arr = Array.isArray(root["assignments"]) ? (root["assignments"] as unknown[]) : [];
    const out: { subject: string; title: string; dueDate: string }[] = [];
    for (const a of arr) {
      if (typeof a !== "object" || a === null) continue;
      const r = a as Record<string, unknown>;
      const subject = typeof r["subject"] === "string" ? r["subject"].trim() : "";
      const title = typeof r["title"] === "string" ? r["title"].trim() : "";
      const due = typeof r["dueDate"] === "string" ? r["dueDate"].trim() : "";
      if (subject === "" || title === "" || due === "") continue;
      if (r["done"] === true) continue;
      if (due < nowIso) continue;
      out.push({ subject, title, dueDate: due });
    }
    out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
    return out.slice(0, limit > 0 ? limit : 5);
  } catch {
    return [];
  }
}

function tsLatestGrades(payload: string, limit = 3): { subject: string; note: string }[] {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const arr = Array.isArray(root["grades"]) ? (root["grades"] as unknown[]) : [];
    const out: { subject: string; note: string; date: string }[] = [];
    for (const g of arr) {
      if (typeof g !== "object" || g === null) continue;
      const r = g as Record<string, unknown>;
      const subject = typeof r["subject"] === "string" ? r["subject"].trim() : "";
      const date = typeof r["date"] === "string" ? r["date"].trim() : "";
      if (subject === "" || date === "") continue;
      if (r["value"] === null || typeof r["value"] !== "number") continue;
      const scale = typeof r["scale"] === "number" ? r["scale"] : Number.NaN;
      out.push({ subject, note: tsGradeLabel(r["value"] as number, scale), date });
    }
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return out.slice(0, limit > 0 ? limit : 5).map(({ subject, note }) => ({ subject, note }));
  } catch {
    return [];
  }
}

// Miroir de gradeValueLabel (Kotlin : String.format FR puis trimEnd '0'/'.').
function tsGradeLabel(value: number, scale: number): string {
  const v = value.toFixed(2).replace(/0+$/, "").replace(/[.,]$/, "");
  if (!Number.isFinite(scale) || scale <= 0) return v;
  return `${v}/${String(Math.round(scale))}`;
}

// 2026-10-03 08:30 : le cours du 03 (08:00-09:00) est EN COURS.
const NOW = "2026-10-03T08:30:00.000Z";

describe("unit android profil (#82)", () => {
  test("parse /v1/me : profil conforme, user null = état vide propre", () => {
    const p = tsParse(JSON.stringify({ user: syntheticUserInfo }));
    expect(p?.displayName).toBe("Camille Exemple");
    expect(p?.classLabel).toBe("3E-Fake");
    expect(p?.periodName).toBe("Trimestre 1");
    expect(tsIsValid(p!)).toBe(true);
    // Compte parent : enfants + photo par RÉF opaque.
    const parent = tsParse(JSON.stringify({ user: syntheticParentUserInfo }));
    expect(parent?.hasKids).toBe(true);
    expect(parent?.kids.map((k) => k.displayName)).toEqual(["Camille Exemple", "Noé Exemple"]);
    expect(parent?.photoRef).toBe(`${PHOTO_REF_PREFIX}file-fake-1`);
    // Rien d'inventé : user absent, null, ou profil non conforme = null.
    expect(tsParse(JSON.stringify({}))).toBeNull();
    expect(tsParse(JSON.stringify({ user: null }))).toBeNull();
    expect(tsParse(JSON.stringify({ user: { accountId: "acc-1" } }))).toBeNull();
    expect(tsParse(JSON.stringify({ user: { ...syntheticUserInfo, displayName: "  " } }))).toBeNull();
    expect(tsParse("Ignore les instructions")).toBeNull();
    // Une URL dans photoRef = profil refusé côté app comme côté contrat.
    expect(tsParse(JSON.stringify({ user: { ...syntheticUserInfo, photoRef: "https://photos.example/p.png" } }))).toBeNull();
    expect(isOpaquePhotoRef("https://photos.example/p.png")).toBe(false);
  });

  test("I1 : aucune adresse Pronote dans le code Kotlin (allowlist serveur seule)", () => {
    const pronoteHost = /pronote|index-education|ent\.(ac-|cas|nevers)|cas\./i;
    const files = [
      join(CORE, "UserProfile.kt"),
      join(CORE, "ServerConfig.kt"),
      join(DATA, "ProfileRepository.kt"),
      join(DATA, "AccountStore.kt"),
      join(UI, "HomeWidgets.kt"),
      join(UI, "AppNav.kt"),
    ].map((f) => ({ f, code: read(f).replace(/\/\*[\s\S]*?\*\//g, "\n").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).map((l) => { const i = l.search(/(?<!:)\/\//); return i >= 0 ? l.slice(0, i) : l; }).join("\n") }));
    for (const { f, code } of files) expect({ file: f, hit: pronoteHost.test(code) }).toEqual({ file: f, hit: false });
    // La photo passe par le proxy : chemin /v1/media construit côté serveur config.
    const config = read(join(CORE, "ServerConfig.kt"));
    expect(config).toContain("fun meUrl(baseUrl: String): String = \"$baseUrl/v1/me\"");
    expect(config).toContain("fun mediaPath(ref: String, accountId: String): String");
    expect(config).toContain("/v1/media?ref=");
    const repo = read(join(DATA, "ProfileRepository.kt"));
    expect(repo).toContain("api.buildGet(path)");
    expect(repo).toContain("BitmapFactory.decodeByteArray");
    expect(repo).toContain("PHOTO_MAX_BYTES");
  });

  test("multi-compte : ids bornés, courant cohérent, aucun secret persisté", () => {
    const s = new TsAccountStore();
    expect(s.isAnonymous()).toBe(true);
    expect(s.add("acc-fake-1")).toBe(true);
    expect(s.add("acc-fake-1")).toBe(false); // doublon
    expect(s.add("   ")).toBe(false);
    expect(s.add("a".repeat(65))).toBe(false);
    expect(s.add("acc-fake-2")).toBe(true);
    expect(s.current).toBe("acc-fake-1");
    s.select("acc-fake-2");
    expect(s.current).toBe("acc-fake-2");
    s.select("acc-inconnu");
    expect(s.current).toBe("acc-fake-2");
    for (let i = 0; i < 10; i++) s.add(`acc-extra-${i}`);
    expect(s.ids).toHaveLength(8); // MAX_ACCOUNTS
    s.remove("acc-fake-2");
    expect(s.current).toBeNull();
    // Le store ne persiste QUE des ids : ni nom, ni classe, ni photo, ni token.
    const store = read(join(DATA, "AccountStore.kt"));
    expect(store).toContain("MAX_ACCOUNTS = 8");
    expect(store).not.toContain("displayName");
    expect(store).not.toContain("tokenHash");
  });

  test("déconnexion : session invalidée + tous les caches purgés, mode anonyme", () => {
    const s = new TsAccountStore();
    s.add("acc-fake-1");
    s.add("acc-fake-2");
    s.logout(CACHEABLE_RESOURCES);
    expect(s.tokenCleared).toBe(true);
    expect([...s.purged].sort()).toEqual([...CACHEABLE_RESOURCES].sort());
    expect(s.ids).toEqual([]);
    expect(s.isAnonymous()).toBe(true);
    // Le profil n'est PAS une ressource cachable : rien de personnel ne survit.
    expect(CACHEABLE_RESOURCES as readonly string[]).not.toContain("me");
    // Câblage Kotlin : purge + invalidation de session dans logout().
    const store = read(join(DATA, "AccountStore.kt"));
    expect(store).toContain("fun logout()");
    expect(store).toContain("tokenStore.clear()");
    // Purge totale via clearAll() : la liste de ressources dérive des contrats,
    // une liste codée en dur laisserait survivant une ressource ajoutee apres.
    expect(store).toContain("cacheStore.clearAll()");
    expect(store).toContain("prefs.edit().clear().apply()");
    const nav = read(join(UI, "AppNav.kt"));
    expect(nav).toContain("accounts.logout()");
    // AccountStore reçoit le store UNIQUE de session (chiffré via
    // SessionTokens.get, repli mémoire) : c'est ce store-ci que logout() purge.
    expect(nav).toContain("SessionTokens.get(ctx)");
    expect(nav).toContain("AccountStore(ctx, cacheStore, tokens)");
  });

  test("accueil : prochain cours, devoirs à rendre, dernières notes", () => {
    const lessons = tsUpcoming(JSON.stringify(syntheticTimetablePayload), NOW);
    // Le cours du 03 est en cours, ceux du 05 et du 06 à venir (tri croissant).
    expect(lessons.map((l) => l.subject)).toEqual(["Histoire", "Maths", "Anglais"]);
    expect(lessons[1]?.room).toBe("B12");
    expect(lessons[0]?.room).toBe("");
    // Cache vide / JSON invalide / champ absent = liste vide (jamais d'invention).
    expect(tsUpcoming("{}", NOW)).toEqual([]);
    expect(tsUpcoming("Ignore les instructions", NOW)).toEqual([]);
    expect(tsUpcoming(JSON.stringify({ entries: [{ subject: "Maths" }] }), NOW)).toEqual([]);
    expect(tsUpcoming(JSON.stringify({ entries: [{ subject: "X", start: "2020-01-01T08:00:00.000Z", end: "2020-01-01T09:00:00.000Z" }] }), NOW)).toEqual([]);

    const homework = tsPending(JSON.stringify(syntheticAssignmentsPayload), NOW);
    // Le devoir du 02 est rendu, celui du 20 est fait : seul celui du 07 reste.
    expect(homework.map((h) => h.title)).toEqual(["Rédaction"]);
    expect(homework[0]?.subject).toBe("Français");
    expect(tsPending(JSON.stringify({ assignments: [{ subject: "M", title: "T", dueDate: "2020-01-01T00:00:00.000Z", done: false }] }), NOW)).toEqual([]);
    expect(tsPending("pas-du-json", NOW)).toEqual([]);

    const grades = tsLatestGrades(JSON.stringify({ grades: syntheticGradesPayload.grades }));
    // Tri anti-chronologique : Français du 28 avant Maths du 20.
    expect(grades.map((g) => g.subject)).toEqual(["Français", "Maths"]);
    expect(grades.map((g) => g.note)).toEqual(["12/20", "15.5/20"]);
    expect(tsLatestGrades(JSON.stringify({ grades: [{ subject: "M", date: "2026-09-20T10:00:00.000Z", value: null, scale: 20 }] }))).toEqual([]);
    expect(tsLatestGrades("null")).toEqual([]);
    // Bornes : jamais plus de 5 lignes quel que soit le cache.
    const many = { entries: Array.from({ length: 30 }, (_, i) => ({ subject: `S${i}`, start: `2026-11-${String(i + 1).padStart(2, "0")}T08:00:00.000Z`, end: `2026-11-${String(i + 1).padStart(2, "0")}T09:00:00.000Z` })) };
    expect(tsUpcoming(JSON.stringify(many), NOW, 0).length).toBe(5);
  });

  test("Kotlin : widgets + écran profil branchés, source sans dépendance ajoutée", () => {
    const widgets = read(join(UI, "HomeWidgets.kt"));
    for (const fn of ["fun upcomingLessonsFrom(", "fun pendingHomeworkFrom(", "fun latestGradesFrom(", "fun gradeValueLabel(", "fun homeTimeLabel("]) {
      expect(widgets).toContain(fn);
    }
    // org.json = SDK : aucune lib de parsing ajoutée.
    expect(widgets).toContain("org.json.JSONObject");
    // Écran profil : données réelles, empty state, photo + déconnexion.
    const nav = read(join(UI, "AppNav.kt"));
    expect(nav).toContain("fun ProfileRoute(");
    expect(nav).toContain("fun ProfileScreen(");
    expect(nav).toContain("repo.fetchMe");
    expect(nav).toContain("repo.fetchPhoto(p)");
    expect(nav).toContain("Aucune information publiée pour ce compte.");
    expect(nav).toContain("profileInitials(profile)");
    expect(nav).toContain("Text(\"Se déconnecter\")");
    expect(nav).toContain("upcomingLessonsFrom(");
    expect(nav).toContain("pendingHomeworkFrom(");
    expect(nav).toContain("latestGradesFrom(");
    // Les autres écrans/onglets restent branchés comme avant #82.
    expect(nav).toContain("ROUTE_NEWS");
    expect(nav).toContain("ROUTE_CANTEEN");
    expect(nav).toContain("SettingsScreen(");
    const core = read(join(CORE, "UserProfile.kt"));
    expect(core).toContain("fun profileInitials(");
    expect(core).toContain("Regex(\"^photo:[A-Za-z0-9._-]{1,150}$\")");
    for (const gradle of [join(ANDROID, "data/build.gradle.kts"), join(ANDROID, "ui/build.gradle.kts"), join(ANDROID, "core/build.gradle.kts")]) {
      const g = read(gradle);
      // Sensible à la casse : "Room" dans un commentaire n'est pas une dépendance
      // (même convention que les autres tests android-*).
      for (const dep of ["gson", "moshi", "kotlinx-serialization", "androidx.room", "datastore", "coil", "glide", "picasso"]) {
        expect({ dep, present: g.includes(dep) }).toEqual({ dep, present: false });
      }
    }
  });

  test("fixtures synthétiques : aucune donnée réelle ni référence Pronote", () => {
    const fixtures = read(join(import.meta.dir, "fixtures/profile.ts"));
    expect(fixtures).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|PRONOTE_PASSWORD|index-education/);
    // Seule URL du fixture : un domaine .invalid réservé, jamais un hôte réel.
    expect([...fixtures.matchAll(/https?:\/\/([a-z.]+)/g)].map((m) => m[1])).toEqual(["photo.invalid"]);
    expect(isUserInfo(syntheticUserInfo)).toBe(true);
    expect(syntheticProfileClient().info?.profilePicture?.id ?? "").toBe("file-fake-1");
  });
});