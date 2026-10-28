// Serveur choisi À L'EXÉCUTION (au lieu d'être figé dans BuildConfig).
// La validation n'est PAS réécrite en TS : les tables ci-dessous sont rejouées
// contre `ServerConfig.validateBaseUrl` EXÉCUTÉ par le pilote de parité
// (`CoreValidationParityMain.kt`). Les autres tests gardent le câblage réel
// (store, purge, graine de build) et l'invariant I1.
// Point de sécurité central : la saisie est libre, donc la validation EST
// l'allowlist — `ServerConfig.validateBaseUrl` + `isAllowed`.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, type ParityLink } from "./fixtures/kotlin-harness";

const ROOT = join(import.meta.dir, "..", "..");
const ANDROID = join(ROOT, "android");
const DATA = join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data");
const APP = join(ANDROID, "app/src/main/java/fr/veryslopnynotes/app");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CoreValidationParityMain.kt");

const skip = parityToolchain.skipReason !== null;
let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

function read(p: string): string {
  return readFileSync(p, "utf8");
}

const PORT_HINT = "Port invalide : utilisez un nombre entre 1 et 65535.";
const HOST_HINT = "Domaine invalide : utilisez un nom de domaine, une IPv4 ou une IPv6 entre crochets.";

interface ServerUrlResult {
  ok: boolean;
  baseUrl?: string;
  message?: string;
}

/** Verdict du VRAI `ServerConfig.validateBaseUrl`, via le pilote de parité. */
async function serverUrl(raw: string): Promise<ServerUrlResult> {
  return JSON.parse(await link!.ask({ op: "serverUrl", raw })) as ServerUrlResult;
}

/** Verdict du VRAI `ServerConfig.isAllowed`, via le pilote de parité. */
async function serverAllowed(url: string, baseUrl: string): Promise<boolean> {
  const result = JSON.parse(await link!.ask({ op: "serverAllowed", url, baseUrl })) as { allowed: boolean };
  return result.allowed;
}

const ACCEPTED: [string, string][] = [
  ["https://notes.exemple.fr", "https://notes.exemple.fr"],
  ["https://notes.exemple.fr:8443", "https://notes.exemple.fr:8443"],
  ["https://notes.exemple.fr:1", "https://notes.exemple.fr:1"],
  ["https://notes.exemple.fr:65535", "https://notes.exemple.fr:65535"],
  ["  https://notes.exemple.fr  ", "https://notes.exemple.fr"],
  ["\thttps://notes.exemple.fr\r\n", "https://notes.exemple.fr"],
  // Normalisation : casse + barre oblique finale collée depuis un navigateur.
  ["https://NOTES.Exemple.FR/", "https://notes.exemple.fr"],
  ["HTTPS://Notes.Exemple.FR", "https://notes.exemple.fr"],
  // IPv4 littérale (adresse de développement / réseau interne).
  ["https://192.168.1.10:3000", "https://192.168.1.10:3000"],
  ["https://1.2.3.4", "https://1.2.3.4"],
  // IPv6 littérale entre crochets.
  ["https://[2001:db8::1]:8443", "https://[2001:db8::1]:8443"],
  ["https://[::1]", "https://[::1]"],
  // Nom DNS à un seul label (poste / réseau local).
  ["https://serveur-poste", "https://serveur-poste"],
  ["https://a.b.c.exemple.fr", "https://a.b.c.exemple.fr"],
  // Clair UNIQUEMENT émulateur / boucle locale (identique à la règle du build).
  ["http://10.0.2.2:3000", "http://10.0.2.2:3000"],
  ["http://localhost:3000", "http://localhost:3000"],
  ["http://10.0.2.2", "http://10.0.2.2"],
  ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
  ["http://[::1]", "http://[::1]"],
  // La graine du build (defaultConfig Gradle) doit toujours passer la validation.
  ["http://10.0.2.2:3000\n", "http://10.0.2.2:3000"],
];

const REJECTED: [string, string][] = [
  ["", "Adresse vide : saisissez l'adresse de votre serveur."],
  ["   ", "Adresse vide : saisissez l'adresse de votre serveur."],
  ["notes.exemple.fr", "Adresse incomplète : le format attendu est https://domaine[:port]."],
  ["://notes.exemple.fr", "Adresse incomplète : le format attendu est https://domaine[:port]."],
  ["ftp://notes.exemple.fr", "Schéma refusé : utilisez https (http est réservé à l'émulateur et à la boucle locale)."],
  ["file:///etc/passwd", "Schéma refusé : utilisez https (http est réservé à l'émulateur et à la boucle locale)."],
  ["https:/notes.exemple.fr", "Adresse incomplète : le format attendu est https://domaine[:port]."],
  ["https://", "Domaine manquant après le schéma."],
  // Structure interdite : elle se retrouverait dans l'URL de requête.
  ["https://user:pass@notes.exemple.fr", "Identifiants (utilisateur:mot de passe@) refusés : saisissez seulement le domaine."],
  ["https://user@notes.exemple.fr", "Identifiants (utilisateur:mot de passe@) refusés : saisissez seulement le domaine."],
  ["https://notes.exemple.fr/v1/grades", "Chemin refusé : saisissez seulement le domaine et le port."],
  ["https://notes.exemple.fr//evil", "Chemin refusé : saisissez seulement le domaine et le port."],
  ["https://notes.exemple.fr?a=b", "Paramètres ou ancre refusés : saisissez seulement le domaine et le port."],
  ["https://notes.exemple.fr#frag", "Paramètres ou ancre refusés : saisissez seulement le domaine et le port."],
// Espaces / caractères de contrôle À L'INTÉRIEUR : autour, c'est un trim.
  ["https://notes exemple.fr", "Espace ou caractère interdit dans l'adresse."],
  ["https://notes.exemple.fr\t:8443", "Espace ou caractère interdit dans l'adresse."],
  ["https://notes.exemple.fr\n/v1", "Espace ou caractère interdit dans l'adresse."],
  ["https://notes.exemple.fr\u0000", "Espace ou caractère interdit dans l'adresse."],
  ["https://notes.exemple.fr\u0000", "Espace ou caractère interdit dans l'adresse."],
  // HTTP hors émulateur/boucle locale : jamais affaibli.
  ["http://notes.exemple.fr", "HTTP est réservé à l'émulateur et à la boucle locale : utilisez l'adresse https de votre serveur."],
  ["http://192.168.1.10:3000", "HTTP est réservé à l'émulateur et à la boucle locale : utilisez l'adresse https de votre serveur."],
  ["http://10.0.2.234:3000", "HTTP est réservé à l'émulateur et à la boucle locale : utilisez l'adresse https de votre serveur."],
  ["http://10.0.2.2.evil.tld", "HTTP est réservé à l'émulateur et à la boucle locale : utilisez l'adresse https de votre serveur."],
  ["http://localhost.evil.tld", "HTTP est réservé à l'émulateur et à la boucle locale : utilisez l'adresse https de votre serveur."],
  ["http://serveur-poste:8080", "HTTP est réservé à l'émulateur et à la boucle locale : utilisez l'adresse https de votre serveur."],
  // Ports hors bornes / non numériques.
  ["https://notes.exemple.fr:0", PORT_HINT],
  ["https://notes.exemple.fr:65536", PORT_HINT],
  ["https://notes.exemple.fr:99999", PORT_HINT],
  ["https://notes.exemple.fr:abc", PORT_HINT],
  ["https://notes.exemple.fr:", PORT_HINT],
  ["https://notes.exemple.fr:-1", PORT_HINT],
  ["https://notes.exemple.fr:+80", "Caractère interdit dans le domaine."],
  ["https://notes.exemple.fr: 80", "Espace ou caractère interdit dans l'adresse."],
  // Hôtes invalides : zéros initiaux (lecture octale divergente), IPv6 sans
  // crochets, étiquettes DNS cassées, bornes de longueur.
  ["https://010.0.0.1", HOST_HINT],
  ["https://256.1.1.1", HOST_HINT],
  ["https://1.2.3", HOST_HINT],
  ["https://notes.exemple.fr.", HOST_HINT],
  ["https://notes..exemple.fr", HOST_HINT],
  ["https://-notes.exemple.fr", HOST_HINT],
  ["https://notes-.exemple.fr", HOST_HINT],
  ["https://notes.exemple.fr:8443:1", HOST_HINT],
  ["https://::1", HOST_HINT],
  ["https://[::1", HOST_HINT],
  ["https://[::1]x", HOST_HINT],
  ["https://[not-hex::1]", HOST_HINT],
  ["https://[fe80::1%eth0]", "Caractère interdit dans le domaine."],
  [`https://${"a".repeat(64)}.exemple.fr`, HOST_HINT],
  [`https://${"a".repeat(260)}`, "Domaine trop long (253 caractères maximum)."],
  [`https://${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.x`, "Domaine trop long (253 caractères maximum)."],
  [`https://${"a".repeat(300)}`, "Adresse trop longue (300 caractères maximum)."],
];

describe("serveur choisi à l'exécution : validation + purge (allowlist saisie)", () => {
  test.skipIf(skip)("formes acceptées : https, hôte borné, port 1-65535, grain du build émulé", async () => {
    for (const [input, canonical] of ACCEPTED) {
      const res = await serverUrl(input);
      expect({ input, res }).toEqual({ input, res: { ok: true, baseUrl: canonical } });
    }
    // La graine BuildConfig par défaut (defaultConfig Gradle) reste valide :
    // le flux émulateur 10.0.2.2:3000 n'est jamais refusé par la validation.
    const seed = "http://10.0.2.2:3000";
    expect(await serverUrl(seed)).toEqual({ ok: true, baseUrl: seed });
  });

  test.skipIf(skip)("formes refusées : message français actionnable, cause unique", async () => {
    for (const [input, message] of REJECTED) {
      const res = await serverUrl(input);
      expect({ input, res }).toEqual({ input, res: { ok: false, message } });
      // Un refus ne doit jamais réécrire la saisie dans son propre message
      // (elle révèle l'établissement : ni log, ni crash, ni écran).
      expect(res.message?.includes(input.trim()) && input.trim().length > 3).toBe(false);
    }
  });

  test.skipIf(skip)("allowlist : préfixe strict, `hote.evil.tld` ne passe plus pour `hote`", async () => {
    const base = "https://notes.exemple.fr";
    const cases: [string, string, boolean][] = [
      ["https://notes.exemple.fr/v1/grades", base, true],
      ["https://notes.exemple.fr/v1/media?ref=x", base, true],
      ["https://notes.exemple.fr", base, true],
      // Préfixe nu : ce faux ami passait avant l'ajout de la barre oblique.
      ["https://notes.exemple.fr.evil.tld/v1/grades", base, false],
      // Autre schéma, autre port, autre chemin racine : refusés.
      ["http://notes.exemple.fr/v1/grades", base, false],
      ["https://notes.exemple.fr:8443/v1/grades", base, false],
      ["https://notes.exemple.frX/v1/grades", base, false],
      ["https://notes.exemple.fr.evil.tld/v1/grades", "", false],
      // baseUrl vide = non configuré (previews/tests) : pas de network call.
      ["/v1/grades", "", true],
    ];
    for (const [url, root, allowed] of cases) {
      expect({ url, root, allowed: await serverAllowed(url, root) }).toEqual({ url, root, allowed });
    }
  });

  test("store : une adresse, validée avant écriture, prefs séparées des comptes", () => {
    const store = read(join(DATA, "ServerStore.kt"));
    expect(store).toContain("class ServerStore(context: Context)");
    expect(store).toContain("getSharedPreferences(PREFS, Context.MODE_PRIVATE)");
    // Fichier PROPRE à AccountStore : `logout()` vide ses prefs, le serveur
    // choisi doit survivre à une déconnexion.
    const accounts = read(join(DATA, "AccountStore.kt"));
    expect(store).toContain('const val PREFS = "server"');
    expect(accounts).toContain('const val PREFS = "accounts"');
    expect(store).not.toContain('const val PREFS = "accounts"');
    // Validation avant écriture, et revalidation à la lecture (une prefs
    // altérée ne réintroduit pas un hôte refusé).
    expect(store).toContain("fun baseUrl(seed: String): String");
    expect(store).toContain("ServerConfig.validateBaseUrl(stored)");
    expect(store).toContain("fun save(raw: String): ServerUrlResult");
    expect(store).toContain("if (validated !is ServerUrlResult.Ok) return validated");
    expect(store.indexOf("fun save")).toBeLessThan(store.indexOf("putString(KEY_BASE_URL"));
    // Un seul store, aucun secret, aucun log, aucune donnée d'établissement.
    expect(codeOnly(store)).not.toMatch(/Log\.[vdiew]\(|println\(|printStackTrace/);
    // Aucun secret utilisé ni stocké ici : l'adresse est la seule clé.
    expect(codeOnly(store)).not.toMatch(/token|secret|password/i);
    expect(store).not.toContain("class ServerStoreStore");
    // Un seul store de serveur dans android/ (pas de copie concurrente).
    const dataFiles = readdirSync(DATA).map((f) => join(DATA, f));
    const stores = dataFiles.filter((f) => read(f).includes("const val PREFS = \"server\""));
    expect(stores.map((f) => f.split("/").pop())).toEqual(["ServerStore.kt"]);
  });

  test("adresse du scraper : état + store, déconnexion purge par logout()", () => {
    // Depuis le cutover WebView, le pont natif porte la graine et l'état ;
    // l'écran React n'a plus aucune saisie d'adresse serveur.
    const bridge = read(join(APP, "VsnBridge.kt"));
    const bridgeCode = codeOnly(bridge);
    expect(bridge).toContain("private val baseUrlSeed: String = fr.veryslopnynotes.core.ServerConfig.baseUrl(");
    expect(bridge).toContain("private val serverStore = ServerStore(ctx)");
    expect(bridge).toContain("private fun currentBaseUrl(): String = serverStore.baseUrl(baseUrlSeed)");
    expect(bridge).toContain("serverStore.save(host)");
    // Aucune purge parallèle : tout passe par AccountStore.logout().
    expect(bridgeCode).not.toContain("clearAll(");
    expect(bridgeCode).not.toContain("sessions.clear(");
    expect(bridgeCode).not.toContain("SessionTokens(");
    // Le chemin de purge est bien celui du AccountStore existant.
    expect(accounts_has_logout()).toBe(true);
    // Aucune référence à l'ancien changement de serveur dans l'app.
    expect(bridgeCode).not.toContain("changeServer");
    expect(bridgeCode).not.toContain("onServerChange");
  });

  test("grain de build : plus de valeur figée côté app, et pas de cleartext ajouté", () => {
    const bridge = read(join(APP, "VsnBridge.kt"));
    expect(bridge).toContain("private val baseUrlSeed: String = fr.veryslopnynotes.core.ServerConfig.baseUrl(");
    expect(bridge).toContain("BuildConfig.SERVER_SCHEME");
    expect(bridge).toContain("BuildConfig.SERVER_HOST");
    expect(bridge).toContain("currentBaseUrl()");
    // Aucun hôte en dur côté app : la seule adresse connue est la graine.
    expect(codeOnly(bridge)).not.toMatch(/https?:\/\//);
    // Le buildConfigField reste, mais il n'est plus qu'un défaut.
    const gradle = read(join(ANDROID, "app/build.gradle.kts"));
    expect(gradle).toContain('buildConfigField("String", "SERVER_SCHEME"');
    expect(gradle).toContain('buildConfigField("String", "SERVER_HOST"');
    expect(gradle).toContain('?: "10.0.2.2:3000"');
    // Clairtext : JAMAIS `usesCleartextTraffic` (attribut global). Le seul
    // mécanisme admis est une networkSecurityConfig qui l'INTERDIT par défaut
    // et ne l'autorise que pour la boucle locale / alias émulateur — sinon le
    // cleartext est bloqué par la plateforme depuis targetSdk 28 et la branche
    // `schemeFor` « émulateur » du code est inatteignable.
    const manifest = read(join(ANDROID, "app/src/main/AndroidManifest.xml"));
    expect(manifest).not.toContain("usesCleartextTraffic");
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    const nsc = read(join(ANDROID, "app/src/main/res/xml/network_security_config.xml"));
    expect(nsc).toContain('<base-config cleartextTrafficPermitted="false"');
    // Les seuls hôtes en clair : boucle locale + alias émulateur, sans sous-domaines.
    const cleartextHosts = [...nsc.matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)].map((m) => m[1]);
    expect(cleartextHosts).toEqual(["10.0.2.2", "localhost", "127.0.0.1"]);
    expect(nsc.match(/cleartextTrafficPermitted="true"/g)).toHaveLength(1);
    for (const f of androidFiles()) {
      expect({ file: f.split("/").slice(-2).join("/"), cleartext: read(f).includes("usesCleartextTraffic") }).toEqual({
        file: f.split("/").slice(-2).join("/"),
        cleartext: false,
      });
    }
  });

  test("I1 : aucun hôte en dur dans android/, aucun hôte Pronote", () => {
    // I1 repointé #200 : seul `android/pronote/` parle Pronote en direct (port
    // #200) ; la déclaration du module dans `settings.gradle.kts` est l'unique
    // mention tolérée hors module. Prose (INVARIANTS, AGENTS.md) en #211.
    const pronoteHost = /pronote/i;
    const files = androidFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      if (f.includes("/android/pronote/")) continue;
      let code = codeOnly(read(f));
      if (f.endsWith("settings.gradle.kts")) code = code.replace(/^include\(.*\)$/m, "");
      // #205 : `data` et `ui` dépendent du module local (`project(":pronote")`,
      // ADR-003) — la déclaration de dépendance est le câblage sanctionné, pas
      // un hôte : on la retire avant le balayage, comme l'`include` ci-dessus.
      code = code.replace(/project\(":pronote"\)/g, "");
      // #205 : les dépôts manipulent les TYPES du client local (`PronoteSession`,
      // `PronoteClientProvider`, paquet `fr.veryslopnynotes.pronote`) — aucune
      // adresse là-dedans, le garde-fou des URL en dur ci-dessous reste entier.
      // #520 : l'erreur de protocole et son code `G` aussi (`data` décide
      // « session morte » par TYPE et par code, jamais par un mot du message).
      code = code
        .replace(/PronoteSession|PronoteClientProvider|PronoteAPIError|pronoteErrorCode/g, "")
        .replace(/fr\.veryslopnynotes\.pronote/g, "");
      expect({ file: f.split("/").slice(-2).join("/"), hit: pronoteHost.test(code) }).toEqual({
        file: f.split("/").slice(-2).join("/"),
        hit: false,
      });
    }
    // Les SEULES chaînes ressemblant à une URL dans le code Kotlin de
    // android/ : plus (#204) l'endpoint PUBLIC du fournisseur LLM (pas un hôte
    // d'établissement ni de serveur : catégorie distincte, comme le modèle en
    // constante de code ; jamais d'identifiant ni de secret dedans), plus le
    // gabarit du message de refus de `ServerConfig` et les deux gardes de
    // schéma du store de session (pas des hôtes). Un hôte réel d'établissement
    // passé en dur (ou dans un message) casserait cette liste — l'adresse de
    // l'établissement vient du QR (#299), jamais du code.
    // #206 : le gabarit "https://domaine[:port]" (label du champ serveur
    // supprimé) a disparu.
    const allowed = new Set([
      "https://domaine[:port].",
      "https://openrouter.ai/api/v1/chat/completions",
      // L'établissement de DÉMONSTRATION public de l'éditeur : une adresse
      // PUBLIQUE par nature (l'éditeur la publie sur son site de
      // démonstration), avec un compte public lui aussi. Elle ne sert qu'à la
      // connexion en un clic — l'adresse de l'établissement de l'utilisateur,
      // elle, vient toujours du QR (#299).
      "https://demo.index-education.net/pronote/eleve.html",
      "https://",
      "http://",
    ]);
    const urls = new Set<string>();
    for (const f of files.filter((f) => /\.(kt|kts)$/.test(f))) {
      for (const m of codeOnly(read(f)).matchAll(/https?:\/\/[^"' )`]*/g)) urls.add(m[0] as string);
    }
    expect([...urls].sort()).toEqual([...allowed].sort());
  });
});

// `logout()` existe bien (le chemin de purge appelé à la déconnexion) :
// session persistée PUIS session mémoire PUIS caches (un jeton vivant après
// la purge des caches partirait vers des lectures fantômes).
function accounts_has_logout(): boolean {
  const accounts = read(join(DATA, "AccountStore.kt"));
  const repair = read(join(DATA, "SessionRepair.kt"));
  // #407 : la purge est déléguée à `CacheScope.purge` (UN seul endroit, avec l'appairage
  // d'un autre compte et la session morte) — l'ORDRE ne bouge pas : session
  // persistée, session mémoire, PUIS caches.
  // #397 : la déconnexion ET la session morte partagent le MÊME code de purge
  // (`SessionRepair.purge`) : l'ordre est vérifié là où il est écrit.
  const purge = repair.indexOf("CacheScope.purge(cacheStore)");
  return (
    accounts.includes("fun logout()") &&
    accounts.includes("SessionRepair.purge(") &&
    accounts.includes("sessions.clear()") &&
    repair.indexOf("invalidateSession()") < repair.indexOf("PronoteSession.clear()") &&
    repair.indexOf("PronoteSession.clear()") < purge &&
    purge > -1
  );
}

function androidFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      if ([".gradle", "build"].includes(e)) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(kt|kts|xml)$/.test(e)) out.push(p);
    }
  };
  walk(ANDROID);
  return out;
}