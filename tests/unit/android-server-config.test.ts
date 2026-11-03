// Serveur choisi À L'EXÉCUTION : `ServerConfig.validateBaseUrl` est EXÉCUTÉ par
// le pilote de parité, pas réécrit en TS. La saisie est libre, donc la
// validation EST l'allowlist. Les autres tests gardent le câblage réel et I1.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

const ROOT = join(import.meta.dir, "..", "..");
const ANDROID = join(ROOT, "android");
const DATA = join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data");
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
const CLEARTEXT_DEBUG_HINT =
  "HTTP est réservé à l'émulateur et à la boucle locale : utilisez l'adresse https de votre serveur.";
const CLEARTEXT_RELEASE_HINT =
  "HTTP en clair n'existe que dans les builds de développement : utilisez https.";

interface ServerUrlResult {
  ok: boolean;
  baseUrl?: string;
  message?: string;
}

type Cleartext = "forbid" | "loopback";

/** Verdict du VRAI `ServerConfig.validateBaseUrl`, via le pilote de parité. */
async function serverUrl(raw: string, cleartext: Cleartext = "forbid"): Promise<ServerUrlResult> {
  return JSON.parse(await link!.ask({ op: "serverUrl", raw, cleartext })) as ServerUrlResult;
}

/** Verdict du VRAI `ServerConfig.isAllowed`, via le pilote de parité. */
async function serverAllowed(url: string, baseUrl: string): Promise<boolean> {
  const result = JSON.parse(await link!.ask({ op: "serverAllowed", url, baseUrl })) as { allowed: boolean };
  return result.allowed;
}

/** Porte Android 17 : le VRAI `ServerConfig.isLocalNetworkUrl`, sans DNS. */
async function localNetwork(raw: string): Promise<boolean> {
  const result = JSON.parse(await link!.ask({ op: "localNetwork", raw })) as { local: boolean };
  return result.local;
}

const HTTPS_ACCEPTED: [string, string][] = [
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
  ["https://127.0.0.1:8443", "https://127.0.0.1:8443"],
  // IPv6 littérale entre crochets.
  ["https://[2001:db8::1]:8443", "https://[2001:db8::1]:8443"],
  ["https://[::1]", "https://[::1]"],
  // Nom DNS à un seul label (poste / réseau local).
  ["https://serveur-poste", "https://serveur-poste"],
  ["https://a.b.c.exemple.fr", "https://a.b.c.exemple.fr"],
];

// Clair loopback/émulateur : politique DEBUG seulement, jamais celle de release.
const DEBUG_HTTP_ACCEPTED: [string, string][] = [
  ["http://10.0.2.2:3000", "http://10.0.2.2:3000"],
  ["http://localhost:3000", "http://localhost:3000"],
  ["http://10.0.2.2", "http://10.0.2.2"],
  ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
  ["http://127.0.0.2:8080", "http://127.0.0.2:8080"],
  ["http://[::1]", "http://[::1]"],
  // La graine du build debug doit toujours passer la validation.
  ["http://10.0.2.2:3000\n", "http://10.0.2.2:3000"],
];

// Clair vers un hôte NON loopback : refusé par les deux politiques.
const PUBLIC_HTTP: string[] = [
  "http://notes.exemple.fr",
  "http://192.168.1.10:3000",
  "http://203.0.113.10",
  "http://10.0.2.234:3000",
  "http://10.0.2.2.evil.tld",
  "http://localhost.evil.tld",
  "http://serveur-poste:8080",
  "http://[2001:db8::1]",
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
  ["http://notes.exemple.fr", CLEARTEXT_DEBUG_HINT],
  ["http://192.168.1.10:3000", CLEARTEXT_DEBUG_HINT],
  ["http://10.0.2.234:3000", CLEARTEXT_DEBUG_HINT],
  ["http://10.0.2.2.evil.tld", CLEARTEXT_DEBUG_HINT],
  ["http://localhost.evil.tld", CLEARTEXT_DEBUG_HINT],
  ["http://serveur-poste:8080", CLEARTEXT_DEBUG_HINT],
  ["http://[2001:db8::1]", CLEARTEXT_DEBUG_HINT],
  // Ports hors bornes / non numériques.
  ["https://notes.exemple.fr:0", PORT_HINT],
  ["https://notes.exemple.fr:65536", PORT_HINT],
  ["https://notes.exemple.fr:99999", PORT_HINT],
  ["https://notes.exemple.fr:abc", PORT_HINT],
  ["https://notes.exemple.fr:", PORT_HINT],
  ["https://notes.exemple.fr:-1", PORT_HINT],
  ["https://notes.exemple.fr:+80", "Caractère interdit dans le domaine."],
  ["https://notes.exemple.fr: 80", "Espace ou caractère interdit dans l'adresse."],
  // Hôtes invalides : zéros initiaux, IPv6 sans crochets, étiquettes cassées, longueurs.
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
  test.skipIf(skip)("https accepté sous les deux politiques, release comprise", async () => {
    for (const [input, canonical] of HTTPS_ACCEPTED) {
      for (const cleartext of ["forbid", "loopback"] as const) {
        const res = await serverUrl(input, cleartext);
        expect({ input, cleartext, res }).toEqual({
          input,
          cleartext,
          res: { ok: true, baseUrl: canonical },
        });
      }
    }
  });

  test.skipIf(skip)("debug : clair loopback/émulateur seul, IPv4 et IPv6", async () => {
    for (const [input, canonical] of DEBUG_HTTP_ACCEPTED) {
      const res = await serverUrl(input, "loopback");
      expect({ input, res }).toEqual({ input, res: { ok: true, baseUrl: canonical } });
    }
  });

  test.skipIf(skip)("release : tout clair est refusé, loopback, émulateur et IPv6 compris", async () => {
    // Défaut sûr du noyau : sans politique explicite, c'est release.
    const implicit = JSON.parse(
      await link!.ask({ op: "serverUrl", raw: "http://localhost:3000" }),
    ) as ServerUrlResult;
    expect(implicit).toEqual({ ok: false, message: CLEARTEXT_RELEASE_HINT });

    const loopback = DEBUG_HTTP_ACCEPTED.map(([raw]) => raw);
    for (const input of [...loopback, ...PUBLIC_HTTP]) {
      const res = await serverUrl(input, "forbid");
      expect({ input, res }).toEqual({ input, res: { ok: false, message: CLEARTEXT_RELEASE_HINT } });
    }
  });

  test.skipIf(skip)("formes refusées : message français actionnable, cause unique", async () => {
    for (const [input, message] of REJECTED) {
      // Politique debug : les autres refus gardent leur cause, et le clair
      // public montre le message loopback plutôt que celui de release.
      const res = await serverUrl(input, "loopback");
      expect({ input, res }).toEqual({ input, res: { ok: false, message } });
      // Un refus ne réécrit jamais la saisie : elle révèle l'établissement.
      expect(res.message?.includes(input.trim()) && input.trim().length > 3).toBe(false);
    }
  });

  test.skipIf(skip)("allowlist : préfixe strict, `hote.evil.tld` ne passe plus pour `hote`", async () => {
    const base = "https://notes.exemple.fr";
    const cases: [string, string, boolean][] = [
      ["https://notes.exemple.fr/v1/grades", base, true],
      ["https://notes.exemple.fr/v1/media?ref=x", base, true],
      ["https://notes.exemple.fr", base, true],
      // Préfixe nu : ce faux ami passait avant la barre oblique.
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

  test.skipIf(skip)("réseau local : seuls les hôtes LAN déclenchent Android 17, jamais le loopback", async () => {
    const LAN = [
      "https://192.168.1.10:3000",
      "https://10.1.2.3",
      "https://172.16.0.5",
      "https://172.31.255.1",
      "https://169.254.1.1",
      "https://serveur-poste",
      "https://nas.local",
      "https://[fe80::1]",
      "https://[fd00::1]",
    ];
    const REMOTE = [
      "http://10.0.2.2:3000",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://[::1]",
      "https://notes.exemple.fr",
      "https://1.2.3.4",
      "https://8.8.8.8",
      "https://203.0.113.10",
      "https://[2001:db8::1]",
    ];
    for (const raw of LAN) expect({ raw, local: await localNetwork(raw) }).toEqual({ raw, local: true });
    for (const raw of REMOTE) expect({ raw, local: await localNetwork(raw) }).toEqual({ raw, local: false });
  });

  test("store : une adresse, validée avant écriture, prefs séparées des comptes", () => {
    const store = read(join(DATA, "ServerStore.kt"));
    expect(store).toContain("class ServerStore(");
    // La politique de clair vient du build : release par défaut, jamais un
    // `http` hérité qui ressortirait après mise à jour.
    expect(store).toContain("private val cleartext: CleartextPolicy = CleartextPolicy.FORBID");
    expect(store).toContain("getSharedPreferences(PREFS, Context.MODE_PRIVATE)");
    // Prefs PROPRE à AccountStore : le serveur choisi survit à `logout()`.
    const accounts = read(join(DATA, "AccountStore.kt"));
    expect(store).toContain('const val PREFS = "server"');
    expect(accounts).toContain('const val PREFS = "accounts"');
    expect(store).not.toContain('const val PREFS = "accounts"');
    // Validation avant écriture, et revalidation à la lecture.
    const choice = read(join(DATA, "StoreCommit.kt"));
    expect(store).toContain("fun baseUrl(seed: String): String");
    expect(choice).toContain("ServerConfig.validateBaseUrl(stored, cleartext)");
    expect(store).toContain("fun save(raw: String): ServerUrlResult");
    expect(store).toContain("ServerConfig.validateBaseUrl(raw, cleartext)");
    expect(store).toContain("if (validated !is ServerUrlResult.Ok) return validated");
    // #890 : validation AVANT écriture, puis commit SYNCHRONE vérifié.
    expect(store).toContain("target.save(validated)");
    expect(choice).toContain("store.commit(mapOf(KEY_BASE_URL");
    const serverChoice = choice.slice(choice.indexOf("class ServerChoice"));
    expect(serverChoice.indexOf("fun save")).toBeLessThan(serverChoice.indexOf("store.commit("));
    // Un seul store : aucun secret, aucun log, aucune donnée d'établissement.
    expect(codeOnly(store)).not.toMatch(/Log\.[vdiew]\(|println\(|printStackTrace/);
    // L'adresse est la seule clé : aucun secret stocké ici.
    expect(codeOnly(store)).not.toMatch(/token|secret|password/i);
    expect(store).not.toContain("class ServerStoreStore");
    const dataFiles = readdirSync(DATA).map((f) => join(DATA, f));
    const stores = dataFiles.filter((f) => read(f).includes("const val PREFS = \"server\""));
    expect(stores.map((f) => f.split("/").pop())).toEqual(["ServerStore.kt"]);
  });

  test("adresse du scraper : état + store, déconnexion purge par logout()", () => {
    // Le pont natif porte la graine et l'état ; l'écran React ne saisit plus d'adresse.
    const bridge = readBridgeSource();
    const bridgeCode = codeOnly(bridge);
    expect(bridge).toContain("private val baseUrlSeed: String = if (BuildConfig.SERVER_HOST.isEmpty())");
    expect(bridge).toContain("internal val serverStore = ServerStore(ctx, cleartextPolicy)");
    expect(bridge).toContain("internal fun currentBaseUrl(): String = serverStore.baseUrl(baseUrlSeed)");
    expect(bridge).toContain("serverStore.save(baseUrl)");
    // Aucune purge parallèle : tout passe par PairingRepository.logoutBlocking().
    expect(bridgeCode).not.toContain("clearAll(");
    expect(bridgeCode).not.toContain("sessions.clear(");
    expect(bridgeCode).not.toContain("SessionTokens(");
    expect(accounts_have_logout()).toBe(true);
    expect(bridgeCode).not.toContain("changeServer");
    expect(bridgeCode).not.toContain("onServerChange");
  });

  test("grain de build : release sans défaut, émulateur et clair dans src/debug seuls", () => {
    const bridge = readBridgeSource();
    expect(bridge).toContain("private val baseUrlSeed: String = if (BuildConfig.SERVER_HOST.isEmpty())");
    expect(bridge).toContain("BuildConfig.SERVER_SCHEME");
    expect(bridge).toContain("BuildConfig.SERVER_HOST");
    expect(bridge).toContain("currentBaseUrl()");
    // Aucun hôte en dur côté app : la seule adresse connue est la graine.
    expect(codeOnly(bridge)).not.toMatch(/https?:\/\/[^"' )`]+/);
    // Le pont n'infère http qu'en debug ; la politique de clair suit le build.
    expect(bridge).toContain(
      "if (BuildConfig.DEBUG) CleartextPolicy.LOOPBACK_ONLY else CleartextPolicy.FORBID",
    );
    const bridgeSettings = codeOnly(read(join(ANDROID, "app/src/main/java/fr/veryslopnynotes/app/VsnBridgeSettings.kt")));
    expect(bridgeSettings).toContain("if (BuildConfig.DEBUG) ServerConfig.schemeFor(host) else \"https\"");
    expect(bridgeSettings).toContain("ServerConfig.validateBaseUrl(host, cleartextPolicy)");
    expect(bridgeSettings).toContain("ServerConfig.validateBaseUrl(serverHost(p), cleartextPolicy)");
    // Un seul validateur : pas de préfixe `http://` recopié dans le pont.
    expect(bridgeSettings).not.toContain('host.startsWith("http://")');

    const gradle = read(join(ANDROID, "app/build.gradle.kts"));
    const defaultConfig = gradleBlock(gradle, "defaultConfig");
    const debug = gradleBlock(gradle, "debug");
    const release = gradleBlock(gradle, "release");
    // La release ne porte NI défaut émulateur NI schéma clair.
    expect(release).toContain('buildConfigField("String", "SERVER_HOST", "\\"${configuredHost.orEmpty()}\\"")');
    expect(release).toContain('buildConfigField("String", "SERVER_SCHEME", "\\"https\\"")');
    expect(release).not.toContain("10.0.2.2");
    expect(release).not.toContain('"http"');
    expect(defaultConfig).not.toContain("10.0.2.2");
    expect(defaultConfig).not.toContain("SERVER_HOST");
    // Le défaut émulateur et son schéma http restent dans le seul bloc debug.
    expect(debug).toContain('?: "10.0.2.2:3000"');
    expect(debug).toContain('buildConfigField("String", "SERVER_SCHEME", "\\"$scheme\\"")');

    // Jamais `usesCleartextTraffic` : une networkSecurityConfig l'interdit par défaut.
    const manifest = read(join(ANDROID, "app/src/main/AndroidManifest.xml"));
    expect(manifest).not.toContain("usesCleartextTraffic");
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    // Release : aucun hôte en clair, aucune exception de domaine.
    const nsc = read(join(ANDROID, "app/src/main/res/xml/network_security_config.xml"));
    expect(nsc).toContain('<base-config cleartextTrafficPermitted="false"');
    expect(nsc).not.toContain('cleartextTrafficPermitted="true"');
    expect(nsc).not.toContain("<domain");
    expect(nsc).not.toContain("10.0.2.2");
    // Debug : les seuls hôtes en clair, boucle locale + alias émulateur, sans sous-domaines.
    const debugNsc = read(join(ANDROID, "app/src/debug/res/xml/network_security_config.xml"));
    const cleartextHosts = [...debugNsc.matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)].map((m) => m[1]);
    expect(cleartextHosts).toEqual(["10.0.2.2", "localhost", "127.0.0.1"]);
    expect(debugNsc.match(/cleartextTrafficPermitted="true"/g)).toHaveLength(1);
    for (const f of androidFiles()) {
      expect({ file: f.split("/").slice(-2).join("/"), cleartext: read(f).includes("usesCleartextTraffic") }).toEqual({
        file: f.split("/").slice(-2).join("/"),
        cleartext: false,
      });
    }
  });

  test("I1 : aucun hôte en dur dans android/, aucun hôte Pronote", () => {
    // Seul `android/pronote/` parle Pronote ; sa déclaration Gradle est la seule mention tolérée.
    const pronoteHost = /pronote/i;
    const files = androidFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      if (f.includes("/android/pronote/")) continue;
      let code = codeOnly(read(f));
      if (f.endsWith("settings.gradle.kts")) code = code.replace(/^include\(.*\)$/m, "");
      // La déclaration de dépendance est le câblage sanctionné, pas un hôte.
      code = code.replace(/project\(":pronote"\)/g, "");
      // Les TYPES du client local et le code d'erreur de protocole ne portent aucune adresse.
      code = code
        .replace(/PronoteSession|PronoteClientProvider|PronoteAPIError|pronoteErrorCode/g, "")
        .replace(/fr\.veryslopnynotes\.pronote/g, "");
      expect({ file: f.split("/").slice(-2).join("/"), hit: pronoteHost.test(code) }).toEqual({
        file: f.split("/").slice(-2).join("/"),
        hit: false,
      });
    }
    // Seules URL tolérées : endpoint public LLM, gabarit de refus, gardes de schéma.
    // Un hôte réel d'établissement (il vient du QR) casserait cette liste.
    const allowed = new Set([
      "https://domaine[:port].",
      "https://openrouter.ai/api/v1/chat/completions",
      // Établissement de DÉMONSTRATION public de l'éditeur, compte public.
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

// `logout()` purge par l'orchestrateur : session, mémoire, PUIS caches.
function accounts_have_logout(): boolean {
  const pairing = read(join(DATA, "PairingRepository.kt"));
  const repair = read(join(DATA, "SessionRepair.kt"));
  const factory = read(join(DATA, "AccountPurgeFactory.kt"));
  const clearSession = factory.indexOf("AccountPurgeStep(AccountDataStore.SESSION)");
  const cache = factory.indexOf("AccountPurgeStep(AccountDataStore.CACHE)");
  return (
    pairing.includes("fun logoutBlocking(") &&
    pairing.includes("AccountPurgeMode.LOGOUT") &&
    factory.includes("AccountDataStore.CACHE") &&
    factory.indexOf("SessionRepair.clearSession") < cache &&
    repair.indexOf("invalidateSession()") < repair.indexOf("PronoteSession.clear()") &&
    clearSession > -1 &&
    clearSession < cache
  );
}

/** Corps du bloc Gradle `name { … }`, accolades équilibrées (sous-blocs inclus). */
function gradleBlock(source: string, name: string): string {
  const start = source.indexOf(`${name} {`);
  expect({ block: name, found: start >= 0 }).toEqual({ block: name, found: true });
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`bloc Gradle non fermé : ${name}`);
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