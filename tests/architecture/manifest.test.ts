// Le manifeste SOURCE ne prouve rien : AGP y ajoute les composants et
// permissions des dépendances. Ce test lit donc le manifeste FUSIONNÉ produit
// par Gradle quand il est frais, et refait la fusion des sources sinon (CI :
// `make check` lance `architecture` en parallèle d'`android-compile`).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const ANDROID = join(ROOT, "android");
const APP = join(ANDROID, "app");
const BUILD = readFileSync(join(APP, "build.gradle.kts"), "utf8");
const MAIN_MANIFEST = join(APP, "src/main/AndroidManifest.xml");

function buildValue(pattern: RegExp, label: string): string {
  const value = pattern.exec(BUILD)?.[1];
  if (!value) throw new Error(`android/app/build.gradle.kts : ${label} introuvable`);
  return value;
}

const NAMESPACE = buildValue(/\bnamespace\s*=\s*"([^"]+)"/, "namespace");
const APPLICATION_ID = buildValue(/\bapplicationId\s*=\s*"([^"]+)"/, "applicationId");
const TARGET_SDK = Number(buildValue(/\btargetSdk\s*=\s*(\d+)/, "targetSdk"));
const MAIN_ACTIVITY = `${NAMESPACE}.MainActivity`;
const FILE_PROVIDER = "androidx.core.content.FileProvider";
const LOOPBACK = ["10.0.2.2", "localhost", "127.0.0.1"];

// Documentées : CAMERA (scan QR zxing, android/README.md) et
// ACCESS_LOCAL_NETWORK (serveur local, manifeste principal). Toute autre
// permission dangereuse est une régression.
const DOCUMENTED_DANGEROUS = new Set([
  "android.permission.ACCESS_LOCAL_NETWORK",
  "android.permission.CAMERA",
]);

// Niveaux `dangerous` d'Android (API 37). Les permissions normales/signature
// (INTERNET, WAKE_LOCK, FOREGROUND_SERVICE, …) n'y figurent pas.
const DANGEROUS = new Set([
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "android.permission.CAMERA",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
  "android.permission.GET_ACCOUNTS",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_PHONE_STATE",
  "android.permission.READ_PHONE_NUMBERS",
  "android.permission.CALL_PHONE",
  "android.permission.ANSWER_PHONE_CALLS",
  "android.permission.READ_CALL_LOG",
  "android.permission.WRITE_CALL_LOG",
  "android.permission.ADD_VOICEMAIL",
  "android.permission.USE_SIP",
  "android.permission.PROCESS_OUTGOING_CALLS",
  "android.permission.BODY_SENSORS",
  "android.permission.BODY_SENSORS_BACKGROUND",
  "android.permission.SEND_SMS",
  "android.permission.RECEIVE_SMS",
  "android.permission.READ_SMS",
  "android.permission.RECEIVE_WAP_PUSH",
  "android.permission.RECEIVE_MMS",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "android.permission.ACCESS_MEDIA_LOCATION",
  "android.permission.ACTIVITY_RECOGNITION",
  "android.permission.BLUETOOTH_ADVERTISE",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.NEARBY_WIFI_DEVICES",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.UWB_RANGING",
  "android.permission.ACCEPT_HANDOVER",
  "android.permission.ACCESS_LOCAL_NETWORK",
]);

type Variant = "debug" | "release";
const VARIANTS: Variant[] = ["debug", "release"];

interface Component {
  kind: "activity" | "activity-alias" | "service" | "receiver" | "provider";
  name: string;
  attrs: Map<string, string>;
  hasFilter: boolean;
}

interface Manifest {
  application: Map<string, string>;
  permissions: Set<string>;
  components: Component[];
}

function attrsOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs.set(m[1]!, m[2]!);
  return attrs;
}

function withoutComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

function normalizeName(name: string): string {
  if (name.startsWith(".")) return `${NAMESPACE}${name}`;
  return name.includes(".") ? name : `${NAMESPACE}.${name}`;
}

function parseManifest(xml: string): Manifest {
  const clean = withoutComments(xml);
  const application = attrsOf(/<application\b([^>]*)>/.exec(clean)?.[1] ?? "");
  const permissions = new Set<string>();
  for (const m of clean.matchAll(/<uses-permission(?:-sdk-\d+)?\b([^>]*)\/?>/g)) {
    const name = attrsOf(m[1] ?? "").get("android:name");
    if (name) permissions.add(name);
  }
  const components: Component[] = [];
  for (const m of clean.matchAll(
    /<(activity|activity-alias|service|receiver|provider)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g,
  )) {
    const raw = attrsOf(m[2] ?? "").get("android:name");
    if (!raw) continue;
    components.push({
      kind: m[1] as Component["kind"],
      name: normalizeName(raw),
      attrs: attrsOf(m[2] ?? ""),
      hasFilter: /<intent-filter\b/.test(m[3] ?? ""),
    });
  }
  return { application, permissions, components };
}

/** Fusionne main + variant comme AGP le fait pour les manifestes de l'app.
 *  Un composant du variant surcharge les attributs du main (`tools:node`). */
function mergeSources(variant: Variant): Manifest {
  const files = [MAIN_MANIFEST, join(APP, `src/${variant}/AndroidManifest.xml`)].filter(existsSync);
  const application = new Map<string, string>();
  const permissions = new Set<string>();
  const components = new Map<string, Component>();
  for (const file of files) {
    const parsed = parseManifest(readFileSync(file, "utf8"));
    for (const [key, value] of parsed.application) application.set(key, value);
    for (const permission of parsed.permissions) permissions.add(permission);
    for (const component of parsed.components) {
      const key = `${component.kind}:${component.name}`;
      const node = component.attrs.get("tools:node");
      if (node === "remove") {
        components.delete(key);
        continue;
      }
      const previous = components.get(key);
      if (!previous || node === "replace") {
        components.set(key, component);
        continue;
      }
      components.set(key, {
        ...previous,
        attrs: new Map([...previous.attrs, ...component.attrs]),
        hasFilter: previous.hasFilter || component.hasFilter,
      });
    }
  }
  return { application, permissions, components: [...components.values()] };
}

function mergedPath(variant: Variant): string | null {
  for (const dir of ["merged_manifest", "merged_manifests"]) {
    const root = join(APP, "build/intermediates", dir, variant);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).sort()) {
      const path = join(root, entry, "AndroidManifest.xml");
      if (existsSync(path)) return path;
    }
  }
  return null;
}

/** Une sortie Gradle antérieure à une source décrit l'ancien état : on
 *  retombe sur la fusion des sources au lieu de valider un manifeste périmé. */
function newestSourceMtime(variant: Variant): number {
  const paths = [
    MAIN_MANIFEST,
    join(APP, `src/${variant}/AndroidManifest.xml`),
    join(APP, "build.gradle.kts"),
    join(ANDROID, "gradle/libs.versions.toml"),
  ].filter(existsSync);
  return Math.max(...paths.map((path) => statSync(path).mtimeMs));
}

interface Profile {
  variant: Variant;
  origin: string;
  manifest: Manifest;
}

function profile(variant: Variant): Profile {
  const path = mergedPath(variant);
  if (path && statSync(path).mtimeMs >= newestSourceMtime(variant)) {
    return { variant, origin: "Gradle fusionné", manifest: parseManifest(readFileSync(path, "utf8")) };
  }
  return { variant, origin: "repli sources", manifest: mergeSources(variant) };
}

const PROFILES = VARIANTS.map(profile);

/** `android:exported` implicite : false sans intent-filter, et true avec filtre
 *  seulement sous API < 31. L'app cible 37, donc tout export est explicite. */
function isExported(component: Component): boolean {
  const declared = component.attrs.get("android:exported");
  if (declared === "true") return true;
  if (declared === "false") return false;
  return component.hasFilter && TARGET_SDK < 31;
}

interface Cleartext {
  base: string | undefined;
  hosts: string[];
  wildcardHosts: string[];
}

function cleartextConfig(profile: Profile): Cleartext {
  const reference = profile.manifest.application.get("android:networkSecurityConfig");
  const name = reference ? /^@xml\/([\w.-]+)$/.exec(reference)?.[1] : undefined;
  if (!name) throw new Error(`${profile.variant} : networkSecurityConfig absente ou illisible`);
  const path = [
    join(APP, `src/${profile.variant}/res/xml/${name}.xml`),
    join(APP, `src/main/res/xml/${name}.xml`),
  ].find(existsSync);
  if (!path) throw new Error(`${profile.variant} : res/xml/${name}.xml introuvable`);
  const xml = withoutComments(readFileSync(path, "utf8"));

  const baseConfigs = [...xml.matchAll(/<base-config\b([^>]*)>/g)];
  if (baseConfigs.length !== 1) throw new Error(`${profile.variant} : base-config absente ou multiple`);
  const base = attrsOf(baseConfigs[0]![1]!).get("cleartextTrafficPermitted");

  const hosts: string[] = [];
  const wildcardHosts: string[] = [];
  for (const config of xml.matchAll(/<domain-config\b([^>]*)>([\s\S]*?)<\/domain-config>/g)) {
    if (attrsOf(config[1]!).get("cleartextTrafficPermitted") !== "true") continue;
    for (const domain of config[2]!.matchAll(/<domain\b([^>]*?)(?:\/>|>[\s\S]*?<\/domain>)/g)) {
      const domainAttrs = attrsOf(domain[1]!);
      const host = /<domain\b[^>]*>([^<]*)<\/domain>/.exec(domain[0])?.[1]?.trim();
      if (!host) throw new Error(`${profile.variant} : domaine en clair sans hôte`);
      if (domainAttrs.get("includeSubdomains") === "true") wildcardHosts.push(host);
      hosts.push(host);
    }
  }
  return { base, hosts, wildcardHosts };
}

describe("manifeste Android fusionné (#900)", () => {
  test("targetSdk ≥ 31 : un composant sans `exported` explicite n'est pas exporté", () => {
    expect(TARGET_SDK).toBeGreaterThanOrEqual(31);
  });

  for (const current of PROFILES) {
    describe(`${current.variant} (${current.origin})`, () => {
      test("seul MainActivity est exporté", () => {
        const exported = current.manifest.components.filter(isExported);
        const exportedActivities = exported
          .filter((component) => component.kind === "activity" || component.kind === "activity-alias")
          .map((component) => component.name)
          .sort();
        expect(exportedActivities).toEqual([MAIN_ACTIVITY]);

        const main = current.manifest.components.find((component) => component.name === MAIN_ACTIVITY);
        expect(main?.attrs.get("android:exported")).toBe("true");

        // Les services/receveurs des bibliothèques ne peuvent être exportés
        // que derrière une permission système (BIND_JOB_SERVICE, DUMP, …).
        const unguarded = exported
          .filter((component) => component.name !== MAIN_ACTIVITY)
          .filter((component) => !component.attrs.get("android:permission"))
          .map((component) => `${component.kind}:${component.name}`);
        expect(unguarded).toEqual([]);
      });

      test("le FileProvider n'est pas exporté et sert l'autorité de l'app", () => {
        const provider = current.manifest.components.find(
          (component) => component.kind === "provider" && component.name === FILE_PROVIDER,
        );
        expect(provider).toBeDefined();
        expect(provider!.attrs.get("android:exported")).toBe("false");
        expect(provider!.attrs.get("android:authorities")).toBe(`${APPLICATION_ID}.fileprovider`);
      });

      test("aucune permission dangereuse hors ensemble documenté", () => {
        const undeclared = [...current.manifest.permissions]
          .filter((permission) => DANGEROUS.has(permission))
          .filter((permission) => !DOCUMENTED_DANGEROUS.has(permission))
          .sort();
        expect(undeclared).toEqual([]);
      });

      test("le clairtexte est limité à la boucle locale", () => {
        expect(current.manifest.application.get("android:usesCleartextTraffic") ?? "false").toBe("false");
        expect(current.manifest.application.get("android:networkSecurityConfig")).toBe(
          "@xml/network_security_config",
        );
        const config = cleartextConfig(current);
        expect(config.base).toBe("false");
        // La release refuse TOUT clair ; seul le debug garde les hôtes locaux
        // nécessaires à l'émulateur (#864).
        expect([...config.hosts].sort()).toEqual(
          current.variant === "debug" ? [...LOOPBACK].sort() : [],
        );
        expect(config.wildcardHosts).toEqual([]);
      });
    });
  }

  test("le manifeste source ne demande que le réseau et le réseau local", () => {
    // Repli CI : une permission ajoutée à la main est refusée même sans sortie
    // Gradle fraîche. Les permissions des dépendances restent couvertes par le
    // manifeste fusionné quand il existe.
    const source = parseManifest(readFileSync(MAIN_MANIFEST, "utf8"));
    expect([...source.permissions].sort()).toEqual([
      "android.permission.ACCESS_LOCAL_NETWORK",
      "android.permission.INTERNET",
    ]);
  });
});
