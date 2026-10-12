// Serveur choisi À L'EXÉCUTION (au lieu d'être figé dans BuildConfig).
// Le build Gradle ne tourne pas ici : on Miroite la validation Kotlin en TS
// ET on garde statiquement le câblage (technique de android-401.test.ts).
// Point de sécurité central : la saisie est libre, donc la validation EST
// l'allowlist — `ServerConfig.validateBaseUrl` + `isAllowed`.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const ANDROID = join(ROOT, "android");
const CORE = join(ANDROID, "core/src/main/java/fr/veryslopnynotes/core");
const DATA = join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui");
const APP = join(ANDROID, "app/src/main/java/fr/veryslopnynotes/app");

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

// ---------------------------------------------------------------------------
// Miroir TS de ServerConfig.validateBaseUrl (core/ServerConfig.kt).
// Messages identiques : c'est le contrat affiché à l'utilisateur.
// Les tables et le miroir sont `export`és pour pouvoir rejouer ce tableau
// contre le VRAI Kotlin (compilateur JVM hors Gradle) : sans ça, le miroir
// pourrait diverger en silence et le test ne PLUS RIEN prouver.

const MAX_BASE_URL_CHARS = 300;
const MAX_AUTHORITY_CHARS = 253;
const MAX_LABEL_CHARS = 63;
const MAX_PORT = 65535;
const PORT_HINT = "Port invalide : utilisez un nombre entre 1 et 65535.";
const HOST_HINT = "Domaine invalide : utilisez un nom de domaine, une IPv4 ou une IPv6 entre crochets.";

type TsResult = { ok: true; baseUrl: string } | { ok: false; message: string };

// Miroir de ServerConfig.isLoopbackHost : égalité stricte (le préfixe de
// isEmulatorHost est trop laxistpour décider du HTTP clair).
function tsIsLoopbackHost(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return bare === "10.0.2.2" || bare === "localhost" || bare === "::1" || (tsIsIpv4(bare) && bare.startsWith("127."));
}

function tsIsAuthorityChar(c: string): boolean {
  return /^[a-z0-9.:[\]-]$/.test(c);
}

function tsSplitAuthority(authority: string): { host: string; port: string | null } | null {
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end < 0) return null;
    const rest = authority.slice(end + 1);
    if (rest === "") return { host: authority.slice(0, end + 1), port: null };
    if (rest.startsWith(":")) return { host: authority.slice(0, end + 1), port: rest.slice(1) };
    return null;
  }
  const colon = authority.lastIndexOf(":");
  if (colon < 0) return { host: authority, port: null };
  if (authority.slice(0, colon).includes(":")) return null;
  return { host: authority.slice(0, colon), port: authority.slice(colon + 1) };
}

function tsIsValidPort(port: string): boolean {
  return port.length >= 1 && port.length <= 5 && /^[0-9]+$/.test(port) && Number(port) >= 1 && Number(port) <= MAX_PORT;
}

function tsIsIpv4(host: string): boolean {
  const groups = host.split(".");
  return (
    groups.length === 4 &&
    groups.every((g) => g.length >= 1 && g.length <= 3 && /^[0-9]+$/.test(g) && (g.length === 1 || g[0] !== "0") && Number(g) <= 255)
  );
}

function tsIsIpv6(host: string): boolean {
  return host.split("").filter((c) => c === ":").length >= 2 && /^[0-9a-f:.]+$/.test(host);
}

function tsIsDnsName(host: string): boolean {
  if (host.endsWith(".")) return false;
  const labels = host.split(".");
  if (labels.length > 1 && /^[0-9]+$/.test(labels[labels.length - 1] ?? "")) return false;
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= MAX_LABEL_CHARS &&
      /^[a-z0-9-]+$/.test(label) &&
      !label.startsWith("-") &&
      !label.endsWith("-"),
  );
}

function tsIsValidHost(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare === "" || bare.length > MAX_AUTHORITY_CHARS) return false;
  if (bare.includes(":")) return tsIsIpv6(bare);
  return tsIsIpv4(bare) || tsIsDnsName(bare);
}

export function tsValidateBaseUrl(raw: string): TsResult {
  const input = raw.trim();
  if (input === "") return { ok: false, message: "Adresse vide : saisissez l'adresse de votre serveur." };
  if (input.length > MAX_BASE_URL_CHARS) {
    return { ok: false, message: `Adresse trop longue (${MAX_BASE_URL_CHARS} caractères maximum).` };
  }
  if (/[\s\p{Cc}]/u.test(input)) return { ok: false, message: "Espace ou caractère interdit dans l'adresse." };
  const sep = input.indexOf("://");
  if (sep <= 0) return { ok: false, message: "Adresse incomplète : le format attendu est https://domaine[:port]." };
  const scheme = input.slice(0, sep).toLowerCase();
  if (scheme !== "https" && scheme !== "http") {
    return { ok: false, message: "Schéma refusé : utilisez https (http est réservé à l'émulateur et à la boucle locale)." };
  }
  const authority = input.slice(sep + 3).toLowerCase().replace(/\/+$/, "");
  if (authority === "") return { ok: false, message: "Domaine manquant après le schéma." };
  if (authority.length > MAX_AUTHORITY_CHARS) {
    return { ok: false, message: `Domaine trop long (${MAX_AUTHORITY_CHARS} caractères maximum).` };
  }
  if (authority.includes("@")) {
    return { ok: false, message: "Identifiants (utilisateur:mot de passe@) refusés : saisissez seulement le domaine." };
  }
  if (authority.includes("/")) {
    return { ok: false, message: "Chemin refusé : saisissez seulement le domaine et le port." };
  }
  if (authority.includes("?") || authority.includes("#")) {
    return { ok: false, message: "Paramètres ou ancre refusés : saisissez seulement le domaine et le port." };
  }
  if (![...authority].every(tsIsAuthorityChar)) return { ok: false, message: "Caractère interdit dans le domaine." };
  const parts = tsSplitAuthority(authority);
  if (parts === null) {
    const colons = authority.split("").filter((c) => c === ":").length;
    return { ok: false, message: colons > 1 ? HOST_HINT : PORT_HINT };
  }
  if (!tsIsValidHost(parts.host)) return { ok: false, message: HOST_HINT };
  if (parts.port !== null && !tsIsValidPort(parts.port)) return { ok: false, message: PORT_HINT };
  if (scheme === "http" && !tsIsLoopbackHost(parts.host)) {
    return { ok: false, message: "HTTP est réservé à l'émulateur et à la boucle locale : utilisez l'adresse https de votre serveur." };
  }
  return { ok: true, baseUrl: `${scheme}://${authority}` };
}

/** Miroir de ServerConfig.isAllowed — baseUrl exacte + "/" (plus préfixe nu). */
function tsIsAllowed(url: string, baseUrl: string): boolean {
  return url === baseUrl || url.startsWith(`${baseUrl.replace(/\/+$/, "")}/`);
}

/** Miroir de ui/serverHint (affichage, pas une décision de sécurité). */
function tsServerHint(value: string): "emulateur" | "https" {
  const authority = value.trim().split("://")[1]?.split("/")[0]?.trim() ?? "";
  const host = authority.replace(/^\[/, "").split("]")[0]?.split(":")[0] ?? "";
  return tsIsLoopbackHost(host) ? "emulateur" : "https";
}

export const ACCEPTED: [string, string][] = [
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

export const REJECTED: [string, string][] = [
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
  ["https://notes.exemple.fr ", "Espace ou caractère interdit dans l'adresse."],
  ["https://notes.exemple.fr ", "Espace ou caractère interdit dans l'adresse."],
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
  test("formes acceptées : https, hôte borné, port 1-65535, grain du build émulé", () => {
    for (const [input, canonical] of ACCEPTED) {
      expect({ input, res: tsValidateBaseUrl(input) }).toEqual({ input, res: { ok: true, baseUrl: canonical } });
    }
    // La graine BuildConfig par défaut (defaultConfig Gradle) reste valide :
    // le flux émulateur 10.0.2.2:3000 n'est jamais refusé par la nouvelle
    // validation.
    const seed = "http://10.0.2.2:3000";
    expect(tsValidateBaseUrl(seed)).toEqual({ ok: true, baseUrl: seed });
  });

  test("formes refusées : message français actionnable, cause unique", () => {
    for (const [input, message] of REJECTED) {
      expect({ input, res: tsValidateBaseUrl(input) }).toEqual({ input, res: { ok: false, message } });
      // Un refus ne doit jamais réécrire la saisie dans son propre message
      // (elle révèle l'établissement : ni log, ni crash, ni écran).
      const said = tsValidateBaseUrl(input).ok ? "" : (tsValidateBaseUrl(input) as { message: string }).message;
      expect(said.includes(input.trim()) && input.trim().length > 3).toBe(false);
    }
  });

  test("allowlist : préfixe strict, `hote.evil.tld` ne passe plus pour `hote`", () => {
    const base = "https://notes.exemple.fr";
    expect(tsIsAllowed("https://notes.exemple.fr/v1/grades", base)).toBe(true);
    expect(tsIsAllowed("https://notes.exemple.fr/v1/media?ref=x", base)).toBe(true);
    expect(tsIsAllowed("https://notes.exemple.fr", base)).toBe(true);
    // Avant : préfixe nu => ce faux ami passait (l'API ne connaît plus le
    // préfixe brut, donc `hote.evil.tld` n'est plus « dans » l'allowlist).
    expect("https://notes.exemple.fr.evil.tld/v1/grades".startsWith(base)).toBe(true);
    expect(tsIsAllowed("https://notes.exemple.fr.evil.tld/v1/grades", base)).toBe(false);
    // Autre schéma, autre port, autre chemin racine : refusés.
    expect(tsIsAllowed("http://notes.exemple.fr/v1/grades", base)).toBe(false);
    expect(tsIsAllowed("https://notes.exemple.fr:8443/v1/grades", base)).toBe(false);
    expect(tsIsAllowed("https://notes.exemple.frX/v1/grades", base)).toBe(false);
    expect(tsIsAllowed("https://notes.exemple.fr.evil.tld/v1/grades", "")).toBe(false);
    // baseUrl vide = non configuré (previews/tests) : pas de network call.
    expect(tsIsAllowed("/v1/grades", "")).toBe(true);

    const config = read(join(CORE, "ServerConfig.kt"));
    expect(config).toContain("fun isAllowed(url: String, baseUrl: String): Boolean =");
    expect(config).toContain("url == baseUrl || url.startsWith(baseUrl.trimEnd('/') + \"/\")");
    // #206 : plus d'ApiClient (device-only) — l'allowlist reste la primitive
    // du scraper (`manualsScrapeUrl`), vérifiée ci-dessous.
  });

  test("Kotlin : la validation porte toutes les règles, la graine reste le défaut", () => {
    const config = read(join(CORE, "ServerConfig.kt"));
    expect(config).toContain("sealed interface ServerUrlResult");
    expect(config).toContain("data class Ok(val baseUrl: String) : ServerUrlResult");
    expect(config).toContain("data class Rejected(val message: String) : ServerUrlResult");
    expect(config).toContain("fun validateBaseUrl(raw: String): ServerUrlResult");
    expect(config).toContain("const val MAX_BASE_URL_CHARS = 300");
    expect(config).toContain("const val MAX_AUTHORITY_CHARS = 253");
    expect(config).toContain("private const val MAX_LABEL_CHARS = 63");
    expect(config).toContain("private const val MAX_PORT = 65535");
    const code = codeOnly(config);
    // Les refus de structure, dans l'ordre des gardes.
    for (const guard of [
      "input.length > MAX_BASE_URL_CHARS",
      "it.isWhitespace() || it.isISOControl()",
      "input.indexOf(\"://\")",
      "scheme != \"https\" && scheme != \"http\"",
      "authority.contains('@')",
      "authority.contains('/')",
      "authority.contains('?') || authority.contains('#')",
      "isValidHost(parts.host)",
      "isValidPort(parts.port)",
      "scheme == \"http\" && !isLoopbackHost(parts.host)",
    ]) {
      expect({ guard, found: code.includes(guard) }).toEqual({ guard, found: true });
    }
    // Le clair ne dépend QUE d'une liste Loopback en ÉGALITÉ STRICTE : le
    // préfixe de isEmulatorHost (miroir Gradle, conservé) laisserait passer
    // « 10.0.2.234 » ou « localhost.evil.tld » en clair, bearer inclus.
    expect(code).toContain('bare == "10.0.2.2" || bare == "localhost" || bare == "::1"');
    expect(code).toContain('(isIpv4(bare) && bare.startsWith("127."))');
    // isEmulatorHost reste inchangé (Gradle en fait le miroir).
    expect(code).toContain("fun isEmulatorHost(host: String): Boolean =");
    expect(code).toContain('host.startsWith("10.0.2.2") || host.startsWith("localhost")');
    // Pas de log, pas d'exception qui transporterait l'adresse.
    expect(code).not.toMatch(/Log\.[vdiew]\(|println\(|printStackTrace|throw /);
    // Les messages de refus existent, sont uniques et ne citent aucun hôte.
    const messages = [...config.matchAll(/(?:rejected\(|private const val \w+_HINT = )"([^"]+)"/g)].map((m) => m[1] as string);
    expect(messages.length).toBe(14);
    expect(new Set(messages).size).toBe(messages.length);
    for (const m of messages) {
      expect(/^[A-ZÉÀ]/.test(m)).toBe(true);
      expect(m).not.toMatch(/10\.0\.2\.2|localhost/);
      // Aucun message ne cite un hôte : la seule URL admise est le GABARIT
      // affiché (l'adresse saisie ne part ni dans un log ni à l'écran).
      expect(m).not.toMatch(/\.(fr|com|net|org|tld|lyon|ac-[a-z]+)\b/i);
    }
    expect(messages.filter((m) => m.includes("://"))).toEqual([
      "Adresse incomplète : le format attendu est https://domaine[:port].",
    ]);
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
    const nav = read(join(UI, "AppNav.kt"));
    const navCode = codeOnly(nav);
    // L'adresse du scraper est un ÉTAT, la graine du build n'est qu'un défaut.
    expect(nav).toContain("baseUrlSeed: String = \"\"");
    expect(nav).toContain("val serverStore = remember(ctx) { ServerStore(ctx) }");
    expect(nav).toContain("val baseUrl = remember(serverStore) { serverStore.baseUrl(baseUrlSeed) }");
    // #206 : plus de changement de serveur dans l'appairage (device-only,
    // aucune route serveur à repointer) — donc plus de changeServer nulle part.
    expect(nav).not.toContain("changeServer");
    expect(nav).not.toContain("onServerChange");
    expect(read(join(UI, "PairingScreen.kt"))).not.toContain("fun changeServer(");
    // Aucune purge parallèle : tout passe par AccountStore.logout().
    expect(navCode).not.toContain("clearAll(");
    expect(navCode).not.toContain("sessions.clear(");
    expect(navCode).not.toContain("SessionTokens(");
    // Le chemin de purge est bien celui du AccountStore existant.
    expect(accounts_has_logout()).toBe(true);
    // Les repositories suivent le cache partagé ; la route alertes lit ce
    // `repo` (#144, cache hors-ligne). #172 : le paramètre `loadAlerts` est
    // SUPPRIMÉ (mort depuis #144, seul `MainActivity` le passait) — un point
    // d'injection qui n'injecte plus rien ne doit pas rester en place.
    expect({ loadAlerts: nav.includes("loadAlerts:") }).toEqual({ loadAlerts: false });
    expect(nav).toContain("SecurityAlertsRoute(repo = repo, baseUrl = baseUrl)");
    // La route appairage ne reçoit plus d'adresse serveur (device-only).
    const pairingRoute = nav.slice(nav.indexOf("composable(ROUTE_PAIRING"), nav.indexOf("composable(ROUTE_ALERTS"));
    expect(pairingRoute).toContain("PairingRoute(");
    expect(pairingRoute).not.toContain("baseUrl");
    expect(pairingRoute).not.toContain("Serveur non configuré.");
    // Et le garde-fou de session morte (#113) reste câblé : la réparation
    // vit dans `SessionGate` (extrait d'AppNav en #206, #135), l'état ici.
    expect(nav).toContain("SessionGate(sessions = sessions, accounts = accounts, nav = nav, onNotice = { authNotice = it })");
    const gate = read(join(UI, "SessionGate.kt"));
    expect(gate).toContain("DeviceAuth.setOnRejected");
    expect(gate).toContain("accounts.logout()");
    expect(gate).toContain("onNotice(DeviceAuth.REJECTED_MESSAGE)");
  });

  test("grain de build : plus de valeur figée côté app, et pas de cleartext ajouté", () => {
    const activity = read(join(APP, "MainActivity.kt"));
    expect(activity).toContain("val baseUrlSeed = fr.veryslopnynotes.core.ServerConfig.baseUrl(");
    expect(activity).toContain("BuildConfig.SERVER_SCHEME");
    expect(activity).toContain("BuildConfig.SERVER_HOST");
    expect(activity).toContain("baseUrlSeed = baseUrlSeed");
    // Aucun hôte en dur côté app : la seule adresse connue est la graine.
    expect(codeOnly(activity)).not.toMatch(/https?:\/\//);
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

  test("ServerConfig ne connaît que le scraper : zéro route métier côté app", () => {
    // #206 : l'app ne parle plus métier à personne (le téléphone lit
    // l'établissement en direct) — les builders de routes meurent ici, il ne
    // reste que la validation d'URL + la route du scraper (#209).
    const config = read(join(CORE, "ServerConfig.kt"));
    expect(config).toContain("fun validateBaseUrl(raw: String): ServerUrlResult");
    expect(config).toContain("fun isAllowed(url: String, baseUrl: String): Boolean =");
    expect(config).toContain('const val MANUALS_SCRAPE_PATH = "/v1/manuals/scrape"');
    expect(config).toContain("fun manualsScrapeUrl(baseUrl: String): String");
    for (const mort of [
      "fun gradesUrl",
      "fun assignmentsUrl",
      "fun assignmentsToggleUrl",
      "fun homeworkGenerateUrl",
      "fun mediaUrl",
      "fun mediaPath",
      "fun timetableUrl",
      "fun pairingStartUrl",
      "fun pairingConfirmUrl",
      "fun setupUrl",
      "fun revisionSheetsUrl",
      "fun revisionSheetPdfUrl",
      "fun subjectPrefsUrl",
      "fun newsUrl",
      "fun menusUrl",
      "fun attendanceUrl",
      "fun punishmentsUrl",
      "fun capabilitiesUrl",
      "fun syncRefreshUrl",
      "fun discussionsUrl",
      "fun discussionsPath",
      "fun meUrl",
      "fun periodsUrl",
      "fun eventsUrl",
      "fun securityAlertsUrl",
      "PAIRING_START_PATH",
      "PAIRING_CONFIRM_PATH",
      "SETUP_PATH",
      "HEALTH_PATH",
      "HOMEWORK_GENERATE_PATH",
    ]) {
      expect({ mort, present: config.includes(mort) }).toEqual({ mort, present: false });
    }
    // L'écran d'appairage ne connaît plus aucune adresse serveur : ni champ,
    // ni sonde, ni callback — juste l'établissement puis le QR.
    const screen = read(join(UI, "PairingScreen.kt"));
    expect(screen).not.toContain("ServerField(");
    expect(screen).not.toContain("serverDraft");
    expect(screen).not.toContain("serverHint");
    expect(screen).not.toContain("probeHealthBlocking");
    expect(screen).not.toContain("ServerConfig.");
    const state = read(join(UI, "PairingUiState.kt"));
    expect(state).not.toContain("serverHint");
    expect(state).not.toContain("ServerConfig.");
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
      code = code
        .replace(/PronoteSession|PronoteClientProvider/g, "")
        .replace(/fr\.veryslopnynotes\.pronote/g, "");
      expect({ file: f.split("/").slice(-2).join("/"), hit: pronoteHost.test(code) }).toEqual({
        file: f.split("/").slice(-2).join("/"),
        hit: false,
      });
    }
    // Les SEULES chaînes ressemblant à une URL dans le code Kotlin de
    // android/ : le gabarit affiché dans l'écran d'appairage, plus (#204)
    // l'endpoint PUBLIC du fournisseur LLM (pas un hôte d'établissement ni
    // de serveur : catégorie distincte, comme le modèle en constante de code ;
    // jamais d'identifiant ni de secret dedans). Un hôte réel d'établissement
    // passé en dur (ou dans un message) casserait cette liste.
    // #206 : le gabarit "https://domaine[:port]" (label du champ serveur
    // supprimé) a disparu ; restent le gabarit des messages de refus (avec son
    // point), l'endpoint public du fournisseur LLM, et les deux gardes de
    // schéma du store de session (pas des hôtes : juste "https://" / "http://").
    const allowed = new Set(["https://domaine[:port].", "https://openrouter.ai/api/v1/chat/completions", "https://", "http://"]);
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
  return (
    accounts.includes("fun logout()") &&
    accounts.indexOf("sessions.clear()") < accounts.indexOf("PronoteSession.clear()") &&
    accounts.indexOf("PronoteSession.clear()") < accounts.indexOf("cacheStore.clearAll()")
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