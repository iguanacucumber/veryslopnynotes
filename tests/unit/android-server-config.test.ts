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
    // ApiClient garde l'allowlist en PREMIER filtre, inchangé.
    const api = codeOnly(read(join(DATA, "ApiClient.kt")));
    expect(api).toContain("require(ServerConfig.isAllowed(url, baseUrl))");
    expect(api.indexOf("ServerConfig.isAllowed")).toBeLessThan(api.indexOf("Authorization"));
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

  test("changement de serveur : purge AVANT le nouveau serveur, chemin logout() existant", () => {
    const nav = read(join(UI, "AppNav.kt"));
    const navCode = codeOnly(nav);
    // L'adresse courante est un ÉTAT, la graine du build n'est qu'un défaut.
    expect(nav).toContain("baseUrlSeed: String = \"\"");
    expect(nav).toContain("val serverStore = remember(ctx) { ServerStore(ctx) }");
    expect(nav).toContain("var baseUrl by remember(serverStore) { mutableStateOf(serverStore.baseUrl(baseUrlSeed)) }");
    // Ordre SÉCURITÉ : valider (sans effet) -> persister -> logout() (secret +
    // caches) -> basculer l'état.
    //   - logout() AVANT onSwitched : le bearer de l'ancien serveur ne peut pas
    //     partir vers le nouveau, il est effacé avant que la nouvelle adresse
    //     ne soit utilisée. C'est LA propriété qui compte.
    //   - save() AVANT logout() : si l'écriture échoue, l'utilisateur garde sa
    //     session et son cache au lieu d'être déconnecté pour rien.
    const fn = nav.slice(nav.indexOf("private fun changeServer"), nav.indexOf("@OptIn(ExperimentalMaterial3Api::class)"));
    const order = ["ServerConfig.validateBaseUrl(raw)", "serverStore.save(target)", "accounts.logout()", "onSwitched(target)"];
    const positions = order.map((needle) => fn.indexOf(needle));
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Le refus sort AVANT toute action de bord (rien n'est modifié).
    expect(fn.indexOf("is ServerUrlResult.Rejected -> return validated.message")).toBeLessThan(positions[1] as number);
    // Aucune purge parallèle : tout passe par AccountStore.logout().
    expect(navCode).not.toContain("clearAll(");
    expect(navCode).not.toContain("tokenStore.clear(");
    expect(navCode).not.toContain("TokenStore(");
    // Le chemin de purge est bien celui du AccountStore existant.
    expect(accounts_has_logout()).toBe(true);
    // Les repositories suivent l'adresse courante (remember(baseUrl) inchangé,
    // alerts inclus : le loader reçoit l'adresse).
    expect(nav).toContain("loadAlerts: suspend (String) -> List<SecurityAlert>");
    expect(nav).toContain("SecurityAlertsRoute { loadAlerts(baseUrl) }");
    // La route appairage reçoit le callback (pas de SettingsScreen).
    expect(nav).toContain("onServerChange = { raw ->");
    expect(nav).toContain("changeServer(raw, baseUrl, accounts, serverStore) { url ->");
    // Le cul-de-sac « serveur non configuré » a disparu de la route
    // appairage (le champ y est toujours accessible).
    const pairingRoute = nav.slice(nav.indexOf("composable(ROUTE_PAIRING)"), nav.indexOf('composable("alerts")'));
    expect(pairingRoute).toContain("PairingRoute(");
    expect(pairingRoute).not.toContain("Serveur non configuré.");
    // Et le garde-fou 401 (#113) reste câblé comme avant.
    expect(nav).toContain("DeviceAuth.setOnRejected");
    expect(nav).toContain("accounts.logout()");
    expect(nav).toContain("authNotice = DeviceAuth.REJECTED_MESSAGE");
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

  test("UI : le champ est sur l'écran d'appairage, honnête sur la joignabilité", () => {
    const screen = read(join(UI, "PairingScreen.kt"));
    expect(screen).toContain("onServerChange: (String) -> String? = { null }");
    expect(screen).toContain("var serverDraft by remember { mutableStateOf(baseUrl) }");
    expect(screen).toContain("ServerField(");
    expect(screen).toContain("val refusal = onServerChange(serverDraft)");
    expect(screen).toContain('label = { Text("Adresse du serveur (https://domaine[:port])") }');
    expect(screen).toContain('Text("Continuer")');
    expect(screen).toContain("Text(serverHint(value))");
    // Erreur affichée telle quelle, confirmation après purge de la session.
    expect(screen).toContain("if (!error.isNullOrEmpty()) Text(error)");
    expect(screen).toContain("Serveur enregistré. Si l'adresse change, reconnecte l'appareil.");
    // #120 : un refus d'adresse arrête ICI. Passer à l'étape du compte quand
    // le serveur ne répond pas, c'est faire découvrir une mauvaise adresse
    // trois écrans plus tard, sous la forme d'un « identifiants refusés ».
    expect(screen).toContain("step = SetupStep.ACCOUNT");
    // Le repo SSE/HTTP est rebouclé sur la nouvelle adresse, pas sur l'ancienne.
    expect(screen).toContain("val api = remember(baseUrl, tokens) { ApiClient(baseUrl, tokens = tokens) }");

    const state = read(join(UI, "PairingUiState.kt"));
    expect(state).toContain("fun serverHint(value: String): String");
    expect(state).toContain("ServerConfig.isLoopbackHost(host)");
    // Le port ne doit pas masquer l'adresse émulateur (défaut de build).
    expect(state).toContain("substringBefore(':')");
    for (const [value, kind] of [
      ["http://10.0.2.2:3000", "emulateur"],
      ["http://10.0.2.2", "emulateur"],
      ["http://localhost:3000", "emulateur"],
      ["http://127.0.0.1:3000", "emulateur"],
      ["https://notes.exemple.fr", "https"],
      ["https://notes.exemple.fr:8443", "https"],
      ["", "https"],
      ["pas-une-url", "https"],
    ] as [string, "emulateur" | "https"][]) {
      expect({ value, kind: tsServerHint(value) }).toEqual({ value, kind });
    }
    // Le défaut de build (alias émulateur) est annoncé comme tel, et le clair
    // comme réservé à l'émulateur : pas de échec muet sur téléphone.
    expect(state).toContain("Adresse d'émulateur : elle ne fonctionne que dans l'émulateur Android.");
    expect(state).toContain("Sur un téléphone, utilisez l'adresse https de votre serveur");
    expect(state).toContain("http est réservé à l'émulateur et à la boucle locale");
    // #120 : la sonde de joignabilité EXISTE, mais seulement sur appui
    // explicite (« Continuer ») et elle vit dans le dépôt, pas dans l'écran :
    // l'écran ne fait aucun appel direct. C'est la seule façon de distinguer
    // « mauvaise adresse » de « identifiants refusés » pour l'utilisateur.
    expect(screen).toContain("probeHealthBlocking(target)");
    expect(codeOnly(screen)).not.toContain("api.buildGet(");
    expect(codeOnly(screen)).not.toContain("client().newCall(");
    const repo = read(join(DATA, "SetupRepository.kt"));
    expect(repo).toContain("fun probeHealthBlocking(baseUrl: String): HealthResult");
    expect(repo).toContain("ServerConfig.HEALTH_PATH");
  });

  test("I1 : aucun hôte en dur dans android/, aucun hôte Pronote/ENT", () => {
    const pronoteHost = /pronote|index-education|ent\.(ac-|cas|nevers)|cas\./i;
    const files = androidFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const code = codeOnly(read(f));
      expect({ file: f.split("/").slice(-2).join("/"), hit: pronoteHost.test(code) }).toEqual({
        file: f.split("/").slice(-2).join("/"),
        hit: false,
      });
    }
    // Les SEULES chaînes ressemblant à une URL dans le code Kotlin de
    // android/ : le gabarit affiché dans l'écran d'appairage. Un hôte réel
    // passé en dur (ou dans un message) casserait cette liste.
    const allowed = new Set(["https://domaine[:port]", "https://domaine[:port]."]);
    const urls = new Set<string>();
    for (const f of files.filter((f) => /\.(kt|kts)$/.test(f))) {
      for (const m of codeOnly(read(f)).matchAll(/https?:\/\/[^"' )`]*/g)) urls.add(m[0] as string);
    }
    expect([...urls].sort()).toEqual([...allowed].sort());
  });
});

// `logout()` existe bien (le chemin de purge appelé au changement de serveur).
function accounts_has_logout(): boolean {
  const accounts = read(join(DATA, "AccountStore.kt"));
  return (
    accounts.includes("fun logout()") &&
    accounts.indexOf("tokenStore.clear()") < accounts.indexOf("cacheStore.clearAll()")
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