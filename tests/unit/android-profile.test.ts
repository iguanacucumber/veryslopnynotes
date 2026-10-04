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
// #143 : les dates sont des MILLIS (`java.time` côté Kotlin, `Date.parse` ici).
// Avant, ce miroir — et le Kotlin — triaient les chaînes ISO, ce qui ordonnait
// mal une date à fuseau (« 09:00+02:00 » = 07:00Z, donc AVANT « 08:30Z »).
// Le miroir complet des libellés et des états vit dans `android-home.test.ts`.
const tsMillisOf = (iso: string): number | null => {
  const value = iso.trim();
  if (value === "") return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
};

function tsUpcoming(payload: string, nowMillis: number, limit = 3): { subject: string; start: number; room: string }[] {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const entries = Array.isArray(root["entries"]) ? (root["entries"] as unknown[]) : [];
    const out: { subject: string; start: number; room: string }[] = [];
    for (const e of entries) {
      if (typeof e !== "object" || e === null) continue;
      const r = e as Record<string, unknown>;
      const subject = typeof r["subject"] === "string" ? r["subject"].trim() : "";
      const start = tsMillisOf(typeof r["start"] === "string" ? (r["start"] as string) : "");
      const end = tsMillisOf(typeof r["end"] === "string" ? (r["end"] as string) : "");
      if (subject === "" || start === null || end === null) continue;
      if (end < start) continue;
      if (end <= nowMillis) continue;
      if (r["status"] === "cancelled") continue;
      out.push({ subject, start, room: typeof r["room"] === "string" ? r["room"].trim() : "" });
    }
    out.sort((a, b) => a.start - b.start);
    return out.slice(0, limit > 0 ? limit : 5);
  } catch {
    return [];
  }
}

function tsPending(payload: string, nowMillis: number, limit = 3): { subject: string; title: string; dueDate: number }[] {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const arr = Array.isArray(root["assignments"]) ? (root["assignments"] as unknown[]) : [];
    const out: { subject: string; title: string; dueDate: number }[] = [];
    for (const a of arr) {
      if (typeof a !== "object" || a === null) continue;
      const r = a as Record<string, unknown>;
      const subject = typeof r["subject"] === "string" ? r["subject"].trim() : "";
      const title = typeof r["title"] === "string" ? r["title"].trim() : "";
      const due = tsMillisOf(typeof r["dueDate"] === "string" ? (r["dueDate"] as string) : "");
      if (subject === "" || title === "" || due === null) continue;
      if (r["done"] === true) continue;
      if (due <= nowMillis) continue;
      out.push({ subject, title, dueDate: due });
    }
    out.sort((a, b) => a.dueDate - b.dueDate);
    return out.slice(0, limit > 0 ? limit : 5);
  } catch {
    return [];
  }
}

function tsLatestGrades(payload: string, limit = 3): { subject: string; note: string }[] {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const arr = Array.isArray(root["grades"]) ? (root["grades"] as unknown[]) : [];
    const out: { subject: string; note: string; date: number }[] = [];
    for (const g of arr) {
      if (typeof g !== "object" || g === null) continue;
      const r = g as Record<string, unknown>;
      const subject = typeof r["subject"] === "string" ? r["subject"].trim() : "";
      const date = tsMillisOf(typeof r["date"] === "string" ? (r["date"] as string) : "");
      if (subject === "" || date === null) continue;
      if (r["value"] === null || typeof r["value"] !== "number") continue;
      const scale = typeof r["scale"] === "number" ? (r["scale"] as number) : Number.NaN;
      out.push({ subject, note: tsGradeLabel(r["value"] as number, scale), date });
    }
    out.sort((a, b) => b.date - a.date);
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

// --- miroir du sélecteur de compte #140 (android/ui/ProfileAccountSwitcher.kt) ---
type Switchable = { accountId: string; displayName: string; classLabel: string };

/** `switchableAccounts` : le compte de session d'abord, puis les enfants, sans
 *  doublon d'`accountId` ni entrée sans nom, plafonné à MAX_KIDS + 1. */
function tsSwitchableAccounts(profile: Profile | null): Switchable[] {
  if (profile === null) return [];
  const out = new Map<string, Switchable>();
  const add = (id: string, name: string, klass: string) => {
    const key = id.trim();
    const label = name.trim();
    if (key === "" || key.length > 64 || label === "" || out.has(key)) return;
    out.set(key, { accountId: key, displayName: label, classLabel: klass.trim() });
  };
  add(profile.accountId, profile.displayName, profile.classLabel);
  for (const k of profile.kids) {
    if (out.size > 8) break;
    add(k.accountId, k.displayName, k.classLabel);
  }
  return [...out.values()];
}

/** `activeAccount` : le compte mémorisé, sinon le premier (le compte de session). */
function tsActiveAccount(accounts: Switchable[], currentId: string | null): Switchable | null {
  if (accounts.length === 0) return null;
  const id = (currentId ?? "").trim();
  return accounts.find((a) => a.accountId === id) ?? accounts[0]!;
}

// 2026-10-03 08:30 UTC : le cours du 03 (08:00-09:00) est EN COURS.
const NOW = Date.parse("2026-10-03T08:30:00.000Z");

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
    const pronoteHost = /pronote/i;
    const files = [
      join(CORE, "UserProfile.kt"),
      join(CORE, "ServerConfig.kt"),
      join(DATA, "ProfileRepository.kt"),
      join(DATA, "AccountStore.kt"),
      join(UI, "HomeWidgets.kt"),
      join(UI, "AppNav.kt"),
      // #135 : les écrans sortis d'AppNav.kt sont vérifiés au même endroit.
      join(UI, "ProfileScreen.kt"),
      join(UI, "IndexScreen.kt"),
      join(UI, "GradesScreen.kt"),
      join(UI, "SettingsScreen.kt"),
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
    // #139 a déplacé `gradeValueLabel` dans `Averages.kt` (avec `gradesFrom`,
    // seul lecteur du JSON des notes) : `HomeWidgets.kt` s'y appuie au lieu de
    // reparcourir le payload.
    for (const fn of ["fun upcomingLessonsFrom(", "fun pendingHomeworkFrom(", "fun latestGradesFrom(", "fun homeTimeLabel("]) {
      expect(widgets).toContain(fn);
    }
    expect(widgets).toContain("gradesFrom(payload)");
    expect(read(join(UI, "Averages.kt"))).toContain("fun gradeValueLabel(");
    // org.json = SDK : aucune lib de parsing ajoutée.
    expect(widgets).toContain("org.json.JSONObject");
    // Écran profil : données réelles, empty state, photo + déconnexion.
    // #135 : l'écran est sorti d'AppNav.kt (970 lignes) vers ProfileScreen.kt,
    // l'accueil vers IndexScreen.kt. Le BRANCHAGE reste dans AppNav.kt, les
    // COMPOSABLES dans leur fichier : on vérifie donc les deux séparément.
    const nav = read(join(UI, "AppNav.kt"));
    const profile = read(join(UI, "ProfileScreen.kt"));
    const index = read(join(UI, "IndexScreen.kt"));
    expect(nav).toContain("ProfileRoute(");
    for (const needle of [
      "fun ProfileRoute(",
      "fun ProfileScreen(",
      "repo.fetchMe",
      "repo.fetchPhoto(p)",
      "Aucune information publiée pour ce compte.",
      "profileInitials(profile)",
      'title = "Se déconnecter"',
    ]) {
      expect({ needle, inProfileScreen: profile.includes(needle) }).toEqual({ needle, inProfileScreen: true });
    }
    for (const needle of ["upcomingLessonsFrom(", "pendingHomeworkFrom(", "latestGradesFrom("]) {
      expect({ needle, inIndexScreen: index.includes(needle) }).toEqual({ needle, inIndexScreen: true });
    }
    // #135 : « Se déconnecter » doit être ATTEIGNABLE — donc une racine unique
    // défilable, pas un `Button` frère d'un `Column` en `fillMaxSize` (le
    // débordement d'environ 48 dp était sans retour possible).
    expect(profile).toMatch(/fun ProfileRoute\([\s\S]*verticalScroll\(rememberScrollState\(\)\)/);
    expect(index).toContain("fun IndexScreen(");
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

  test("sélecteur de compte (#140) : session d'abord, enfants ensuite, courant honnête", () => {
    const parent = tsParse(JSON.stringify({ user: syntheticParentUserInfo }))!;
    // Le compte de session vient EN PREMIER (c'est lui que l'en-tête affiche),
    // puis les enfants, sans doublon : un enfant qui porte l'accountId de la
    // session ne donne pas deux lignes pour un compte.
    const accounts = tsSwitchableAccounts(parent);
    expect(accounts.map((a) => a.accountId)).toEqual([parent.accountId, ...parent.kids.map((k) => k.accountId)]);
    expect(accounts[0]?.displayName).toBe(parent.displayName);
    expect(accounts[1]).toEqual({ accountId: parent.kids[0]!.accountId, displayName: "Camille Exemple", classLabel: parent.kids[0]!.classLabel });
    // Un enfant sans nom, ou dont l'id dépasse la borne, n'est pas sélectionnable.
    const troue: Profile = {
      ...parent,
      kids: [
        { accountId: "acc-kid-ok", displayName: "Noé Exemple", classLabel: "6E-Fake" },
        { accountId: "  ", displayName: "Sans id", classLabel: "" },
        { accountId: "acc".padEnd(65, "x"), displayName: "Id trop long", classLabel: "" },
        { accountId: "acc-kid-ok", displayName: "Doublon", classLabel: "" },
      ],
    };
    const troueIds = tsSwitchableAccounts(troue).map((a) => a.accountId);
    expect(troueIds).toEqual([troue.accountId, "acc-kid-ok"]);
    // Plafond MAX_KIDS + 1 : la liste ne peut pas déborder sur l'écran.
    const many: Profile = {
      ...parent,
      kids: Array.from({ length: 12 }, (_, i) => ({ accountId: `acc-kid-${i}`, displayName: `Enfant ${i}`, classLabel: "" })),
    };
    expect(tsSwitchableAccounts(many)).toHaveLength(9);
    // Aucun profil publié = aucun compte inventé pour le sélecteur.
    expect(tsSwitchableAccounts(null)).toEqual([]);
    // Courant : celui que l'app mémorise, sinon le premier (la session). Un id
    // inconnu ne désigne rien — il ne remplace jamais la session par du vide.
    expect(tsActiveAccount(accounts, parent.kids[0]!.accountId)?.displayName).toBe("Camille Exemple");
    expect(tsActiveAccount(accounts, null)?.accountId).toBe(parent.accountId);
    expect(tsActiveAccount(accounts, "acc-inconnu")?.accountId).toBe(parent.accountId);
    expect(tsActiveAccount([], parent.accountId)).toBeNull();
  });

  test("Kotlin : profil en sections, avatar borné et déconnexion confirmée (#140)", () => {
    const profile = read(join(UI, "ProfileScreen.kt"));
    const switcher = read(join(UI, "ProfileAccountSwitcher.kt"));
    // Avatar : la photo ne décide PLUS de la taille de l'écran (elle était
    // rendue à sa taille intrinsèque) et elle est rognée en cercle.
    expect(profile).toContain("ContentScale.Crop");
    expect(profile).toContain("modifier = Modifier.size(PROFILE_AVATAR).clip(CircleShape)");
    expect(profile).not.toMatch(/Image\(\s*\n?\s*bitmap = photo\.bitmap\.asImageBitmap\(\),[\s\S]{0,120}padding\(4\.dp\)/);
    // Hiérarchie : des SECTIONS (en-tête + icône) et des LIGNES, plus aucun
    // bouton pleine largeur — dont « Se déconnecter », hors d'atteinte avant.
    expect(profile).toContain("private fun ProfileSection(");
    for (const section of ["Compte", "Ressources", "Réglages", "Session"]) {
      expect(profile).toContain(`ProfileSection("${section}"`);
    }
    expect(profile.split("Button(onClick").length - 1).toBe(0);
    expect(profile).toContain("ConfirmDialog(");
    expect(profile).toContain("destructive = true");
    // Défilement : une seule racine, au plus haut (cf. #135).
    expect(profile).toMatch(/Modifier\.fillMaxSize\(\)\.verticalScroll\(rememberScrollState\(\)\)/);
    // Sélecteur de compte : la feuille, la bascule, et l'écriture dans le store.
    expect(switcher).toContain("fun switchableAccounts(profile: UserProfile?): List<SwitchableAccount>");
    expect(switcher).toContain("fun activeAccount(");
    expect(switcher).toContain("ModalBottomSheet(");
    expect(profile).toContain("ProfileAccountSheet(");
    expect(profile).toContain("accounts.select(id)");
    expect(profile).toContain("accounts.current()");
    // La relecture passe par la barre du haut (compteur partagé avec l'onglet
    // Notes) : le corps n'affiche plus de bouton « Charger le profil ».
    const nav = read(join(UI, "AppNav.kt"));
    const shell = read(join(UI, "AppShell.kt"));
    expect(profile).toContain("refreshTick: Int = 0");
    // Le BLOC `ProfileRoute( … )` de AppNav.kt, pas le fichier entier (l'onglet
    // Notes a le même compteur, mais c'est la route du profil qui doit le lire).
    const blocProfile = nav.slice(nav.indexOf("ProfileRoute("), nav.indexOf("composable(ROUTE_NEWS"));
    expect(blocProfile).toContain("refreshTick = readTick");
    expect(shell).toMatch(/ROUTE_PROFILE to listOf\(\s*TopAction\.Refresh,\s*\)/);
    // Aucune régression : le profil est lu, la photo passe par le proxy, les
    // capacités conditionnent toujours les trois entrées dynamiques.
    for (const needle of ["repo.fetchMe", "repo.fetchPhoto(p)", "Capabilities.visible(capabilities, Capabilities.NEWS)"]) {
      expect({ needle, present: profile.includes(needle) }).toEqual({ needle, present: true });
    }
  });

  test("fixtures synthétiques : aucune donnée réelle ni référence Pronote", () => {
    const fixtures = read(join(import.meta.dir, "fixtures/profile.ts"));
    expect(fixtures).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|PRONOTE_PASSWORD/);
    // Seule URL du fixture : un domaine .invalid réservé, jamais un hôte réel.
    expect([...fixtures.matchAll(/https?:\/\/([a-z.]+)/g)].map((m) => m[1])).toEqual(["photo.invalid"]);
    expect(isUserInfo(syntheticUserInfo)).toBe(true);
    expect(syntheticProfileClient().info?.profilePicture?.id ?? "").toBe("file-fake-1");
  });
});