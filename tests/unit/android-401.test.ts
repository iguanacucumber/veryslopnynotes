// #113 repointé #206 : session Pronote LOCALE morte (jeton tourné, session
// refermée — le client ne distingue pas). Plus de 401 serveur : l'app n'a plus
// de bearer ni d'`ApiClient`, ce sont les dépôts locaux qui lèvent le signal
// sur `isSessionFailure`. Le build Gradle ne tourne pas ici : on rejoue la
// logique en TS ET on garde statiquement le câblage.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHEABLE_RESOURCES } from "../../shared/contracts/cache";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

function codeOnly(content: string): string {
  const noBlock = content.replace(/\/\*[\s\S]*?\*\//g, "\n");
  return noBlock
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");
}

const kt = {
  auth: join(DATA, "DeviceAuth.kt"),
  sessions: join(DATA, "SessionStore.kt"),
  synced: join(DATA, "SyncedRepository.kt"),
  accounts: join(DATA, "AccountStore.kt"),
  nav: join(UI, "AppNav.kt"),
  pairing: join(UI, "PairingScreen.kt"),
};

// Miroir de DeviceAuth.REJECTED_MESSAGE (lu plus bas dans le Kotlin).
const REJECTED_MESSAGE = "Session refusée par l'établissement : ré-appairez l'appareil (QR + PIN).";

/**
 * App + garde-fou en miniature : l'app n'a QU'un traitement du signal
 * (AppNav : accounts.logout() puis navigation), et la session vidée après le
 * logout est exactement ce qui empêche la boucle (plus rien à invalider).
 */
class TsAppDeadSession {
  session: string | null = "jeton-synthetique-android-1";
  raises = 0;
  logouts = 0;
  purged: string[] = [];
  navigations: string[] = [];
  notice: string | null = null;
  route = "grades";

  constructor() {
    // DeviceAuth.setOnRejected { … } (AppNav) : réparation + navigation.
    DeviceAuthMirror.onRejected = () => {
      this.raises += 1;
      this.notice = REJECTED_MESSAGE;
      this.logouts += 1; // accounts.logout()
      this.purged.push(...CACHEABLE_RESOURCES); // cacheStore.clearAll()
      this.session = null; // sessions.clear() + PronoteSession.clear()
      if (this.route !== "pairing") {
        this.route = "pairing";
        this.navigations.push("pairing");
      }
    };
  }

  /** Un dépôt local dont le client lève en `isSessionFailure`. */
  depotEchecSession(): void {
    if (this.session !== null) DeviceAuthMirror.reject();
  }
}

const DeviceAuthMirror = {
  onRejected: null as null | (() => void),
  reject(): void {
    this.onRejected?.();
  },
};

describe("unit android session morte -> appairage (#113, #206 device-only)", () => {
  test("plus de client HTTP métier côté app : ni ApiClient, ni bearer serveur", () => {
    // L'appairage et les lectures sont device-only : aucun fichier ne doit
    // ressusciter le bearer serveur.
    for (const f of [join(DATA, "ApiClient.kt"), join(DATA, "TokenStore.kt"), join(DATA, "SetupRepository.kt"), join(DATA, "QrPayload.kt")]) {
      expect(existsSync(f), `ressuscité: ${f}`).toBe(false);
    }
    const files = [...readdirSync(DATA).map((f) => join(DATA, f)), ...readdirSync(UI).map((f) => join(UI, f))];
    // Seul l'appel direct au fournisseur LLM fait du HTTP (exemption #204) :
    // aucun dépôt ne fabrique de client gardé, aucun n'émet d'appel réseau.
    const clients = files.filter((f) => codeOnly(read(f)).includes("OkHttpClient("));
    expect(clients.map((f) => f.split("/").pop()).sort()).toEqual(["OpenRouterLlm.kt"]);
    const calls = files.filter((f) => codeOnly(read(f)).includes("newCall("));
    expect(calls.map((f) => f.split("/").pop()).sort()).toEqual(["OpenRouterLlm.kt"]);
    // Aucune trace du bearer serveur dans le code Kotlin (commentaires exclus).
    for (const f of files) {
      expect({ file: f.split("/").pop(), bearer: /Bearer \$token|tokenHash|SessionTokens/.test(codeOnly(read(f))) }).toEqual({
        file: f.split("/").pop(),
        bearer: false,
      });
    }
  });

  test("garde-fou : les dépôts locaux lèvent sur isSessionFailure, un seul s'abonne", () => {
    const files = [...readdirSync(DATA).map((f) => join(DATA, f)), ...readdirSync(UI).map((f) => join(UI, f))];
    const raises = files.filter((f) => codeOnly(read(f)).includes("DeviceAuth.reject()"));
    expect(raises.map((f) => f.split("/").pop()).sort()).toEqual(
      ["AssignmentsRepository.kt", "DiscussionsRepository.kt", "PeriodicSyncWorker.kt", "ProfileRepository.kt", "SyncedRepository.kt"].sort(),
    );
    // Les dépôts lèvent sur une EXCEPTION de session, jamais sur un code HTTP.
    for (const f of ["SyncedRepository.kt", "AssignmentsRepository.kt", "DiscussionsRepository.kt", "ProfileRepository.kt"]) {
      expect(codeOnly(read(join(DATA, f)))).toContain("isSessionFailure(e)");
    }
    const subs = files.filter((f) => codeOnly(read(f)).includes("DeviceAuth.setOnRejected"));
    expect(subs.map((f) => f.split("/").pop())).toEqual(["SessionGate.kt"]);
  });

  test("anti-boucle : le refus est réparé UNE fois, pas rejoué en boucle", () => {
    const app = new TsAppDeadSession();
    // 5 dépôts qui échouent en session morte : UN seul signal, donc une seule
    // réparation (le premier logout vide la session, les suivants n'ont rien).
    for (let i = 0; i < 5; i++) app.depotEchecSession();
    expect(app.raises).toBe(1);
    expect(app.logouts).toBe(1);
    expect([...app.purged].sort()).toEqual([...CACHEABLE_RESOURCES].sort());
    expect(app.navigations).toEqual(["pairing"]);
    expect(app.route).toBe("pairing");
    expect(app.notice).toBe(REJECTED_MESSAGE);
    // Après réparation, plus de session : les échecs suivants NE relancent
    // rien. C'est la garantie qu'on ne retombe pas sur l'écran d'appairage.
    expect(app.session).toBeNull();
    for (let i = 0; i < 3; i++) app.depotEchecSession();
    expect(app.raises).toBe(1);
    expect(app.navigations).toEqual(["pairing"]);
  });

  test("Kotlin : signal unique, message neutre, réparation par logout()", () => {
    const auth = read(kt.auth);
    // UN objet, un message, un listener : pas de bus d'événements.
    expect(auth).toContain("object DeviceAuth");
    expect(auth).toContain("fun setOnRejected(listener: (() -> Unit)?)");
    expect(auth).toContain("internal fun reject()");
    // Message unique, sans cause devinée (le client ne distingue rien).
    const message = /const val REJECTED_MESSAGE = "([^"]+)"/.exec(auth)?.[1];
    expect(message).toBe(REJECTED_MESSAGE);
    expect(message).not.toMatch(/expir|révoqu|inconnu/i);

    // Le chemin de purge est bien celui du AccountStore existant.
    const accounts = read(kt.accounts);
    expect(accounts).toContain("fun logout()");
    expect(accounts).toContain("sessions.clear()");
    expect(accounts).toContain("PronoteSession.clear()");
    expect(accounts).toContain("cacheStore.clearAll()");
    // Le jeton reste chiffré et effacé par le store, jamais recopié ailleurs.
    const sessions = read(kt.sessions);
    expect(sessions).toContain("EncryptedSharedPreferences");
    expect(sessions).toContain("fun clear()");
    // #206 : plus de repli en clair — un Keystore KO jette, il n'écrit pas.
    expect(codeOnly(sessions)).not.toContain("MODE_PRIVATE");
    expect(codeOnly(sessions)).not.toContain("getSharedPreferences(");

    // Traitement unique côté UI : le portier de session (`SessionGate`,
    // extrait d'AppNav en #206 pour garder le graphe sous ~450 lignes, #135)
    // répare par le chemin EXISTANT puis navigue vers l'appairage (pile vidée :
    // plus d'onglet protégé derrière).
    const gate = read(join(UI, "SessionGate.kt"));
    expect(gate).toContain("fun SessionGate(");
    expect(gate).toContain("DeviceAuth.setOnRejected");
    expect(gate).toContain("accounts.logout()");
    expect(gate).toContain("onNotice(DeviceAuth.REJECTED_MESSAGE)");
    expect(gate).toContain("if (nav.currentDestination?.route != ROUTE_PAIRING) {");
    expect(gate).toContain("nav.navigate(ROUTE_PAIRING) {");
    expect(gate).toContain("popUpTo(nav.graph.findStartDestination().id) { inclusive = true }");
    expect(gate).toContain("onDispose { DeviceAuth.setOnRejected(null) }");
    // Restauration au démarrage : jeton mort = store vidé (cap appairage),
    // réseau KO = store gardé (caches intacts).
    expect(gate).toContain("pairing.restoreBlocking()");
    expect(gate).toContain("is RestoreResult.Dead");
    expect(gate).toContain("RestoreResult.Offline");
    const nav = read(kt.nav);
    expect(nav).toContain('const val ROUTE_PAIRING = "pairing"');
    expect(nav).toContain("SessionGate(sessions = sessions, accounts = accounts, nav = nav, onNotice = { authNotice = it })");
    expect(nav).toContain("notice = authNotice,");
    const navCode = codeOnly(nav);
    // Pas de purge parallèle : tout passe par AccountStore.logout().
    expect(navCode).not.toContain("clearAll(");
    expect(navCode).not.toContain("sessions.clear(");
    // Jamais de secret journalisé.
    expect(navCode).not.toMatch(/Log\.[vdiew]\(|println\(/);

    // L'écran d'appairage affiche la raison factuelle, sans chrono ni devinette.
    const pairing = read(kt.pairing);
    expect(pairing).toContain("notice: String? = null,");
    // #146 : le même texte, borné sur trois lignes (le message est celui de
    // l'établissement, donc de longueur inconnue) — la condition est inchangée.
    expect(pairing).toContain("if (!notice.isNullOrEmpty()) {");
    expect(pairing).toMatch(/Text\(\s*text = notice,\s*maxLines = 3,/);
    // La session va droit dans le store chiffré : aucun bearer manipulé ici.
    expect(pairing).toContain("PairingRepository(sessions)");
    expect(codeOnly(pairing)).not.toContain("tokens.save(");
  });
});
