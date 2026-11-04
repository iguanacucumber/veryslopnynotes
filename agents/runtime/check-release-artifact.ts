// Assertions de l'artefact release (#928) : l'APK publié doit rester
// distribuable — notices complètes, aucun secret, permissions connues, version
// identique au tag et aux sources. La signature est vérifiée par le workflow
// avec apksigner ; le certificat debug est aussi refusé ici depuis `--certs`.
//
// Le script lit un vrai APK (`unzip` + `aapt dump badging`) : le YAML ne fait
// que l'appeler, et les fonctions pures sont éprouvées sur des fixtures.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tagsAtHead, versionFromTag, versionFromTags } from "./android-version";
import { matchPatterns, PATTERNS } from "./secret-patterns";

const ROOT = join(import.meta.dir, "..", "..");

/** Permissions attendues du manifeste release fusionné (app + AndroidX,
 *  WorkManager et zxing). Toute autre permission est une régression. */
export const PERMISSION_ALLOWLIST: readonly string[] = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_LOCAL_NETWORK",
  "android.permission.WAKE_LOCK",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.CAMERA",
  // Permission signature générée par AndroidX pour ses receivers dynamiques.
  "fr.veryslopnynotes.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
];

export interface ArtifactFile {
  path: string;
  bytes: Uint8Array;
}

export interface Artifact {
  versionName: string;
  versionCode: string;
  permissions: readonly string[];
  files: readonly ArtifactFile[];
}

export interface ReleaseSources {
  /** VersionName/versionCode du paquet Android lus sur HEAD
   *  (`agents/runtime/android-version.ts`, source unique de Gradle). */
  packageVersion: string;
  packageVersionCode: string;
  tag?: string | null;
  /** Chemins APK → contenu attendu (`assets/web/...`). */
  notices: ReadonlyMap<string, Uint8Array>;
}

export interface ReleaseOptions {
  certs?: string;
  allowlist?: readonly string[];
}

export function certificateErrors(certs: string): string[] {
  if (certs.trim() === "") {
    return ["sortie apksigner vide : signature non vérifiable"];
  }
  if (/CN=Android Debug/.test(certs)) {
    return ["certificat debug Android (CN=Android Debug) : APK non publiable"];
  }
  return [];
}

export function versionErrors(artifact: Artifact, sources: ReleaseSources): string[] {
  const errors: string[] = [];
  if (sources.packageVersion.trim() === "") errors.push("versionName Android absente");
  if (sources.packageVersionCode.trim() === "") errors.push("versionCode Android absent");
  if (artifact.versionName.trim() === "") errors.push("versionName de l'APK absent");
  if (artifact.versionCode.trim() === "") errors.push("versionCode de l'APK absent");
  if (sources.packageVersion !== artifact.versionName) {
    errors.push(`versionName Android ${sources.packageVersion || "?"} ≠ APK ${artifact.versionName || "?"}`);
  }
  if (sources.packageVersionCode !== artifact.versionCode) {
    errors.push(`versionCode Android ${sources.packageVersionCode || "?"} ≠ APK ${artifact.versionCode || "?"}`);
  }

  if (sources.tag) {
    const tag = sources.tag.replace(/^refs\/tags\//, "");
    let expected: { name: string; code: number } | null = null;
    try {
      expected = versionFromTag(tag);
    } catch (error) {
      errors.push(`tag « ${tag} » invalide : ${(error as Error).message}`);
    }
    if (expected === null) {
      errors.push(`tag « ${tag} » ne porte pas de version Android`);
    } else {
      if (expected.name !== sources.packageVersion) {
        errors.push(`tag ${expected.name} ≠ versionName Android ${sources.packageVersion || "?"}`);
      }
      if (String(expected.code) !== sources.packageVersionCode) {
        errors.push(`tag ${expected.code} ≠ versionCode Android ${sources.packageVersionCode || "?"}`);
      }
      if (expected.name !== artifact.versionName) {
        errors.push(`tag ${expected.name} ≠ APK ${artifact.versionName || "?"}`);
      }
      if (String(expected.code) !== artifact.versionCode) {
        errors.push(`tag ${expected.code} ≠ versionCode APK ${artifact.versionCode || "?"}`);
      }
    }
  }
  return errors;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function noticeErrors(artifact: Artifact, notices: ReleaseSources["notices"]): string[] {
  const errors: string[] = [];
  for (const [path, expected] of notices) {
    const file = artifact.files.find((candidate) => candidate.path === path);
    if (!file) {
      errors.push(`notice absente de l'APK : ${path}`);
    } else if (!sameBytes(file.bytes, expected)) {
      errors.push(`notice altérée dans l'APK : ${path}`);
    }
  }
  return errors;
}

export function secretErrors(files: readonly ArtifactFile[]): string[] {
  const errors: string[] = [];
  for (const file of files) {
    // Les dex portent les constantes compilées (BuildConfig) ; les assets les
    // fichiers web. Un binaire d'assets (fonte, image) est ignoré : son octet
    // aléatoire n'est pas un secret lisible.
    const dex = /^classes\d*\.dex$/.test(file.path);
    if (!dex && !/^(?:assets|res\/raw)\//.test(file.path)) continue;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: !dex }).decode(file.bytes);
    } catch {
      continue;
    }
    for (const pattern of matchPatterns(text, PATTERNS)) {
      errors.push(`secret potentiel (${pattern}) dans ${file.path}`);
    }
  }
  return errors;
}

export function permissionErrors(
  permissions: readonly string[],
  allowlist: readonly string[] = PERMISSION_ALLOWLIST,
): string[] {
  const allowed = new Set(allowlist);
  return [...new Set(permissions)]
    .filter((permission) => !allowed.has(permission))
    .sort()
    .map((permission) => `permission inattendue : ${permission}`);
}

export function checkReleaseArtifact(
  artifact: Artifact,
  sources: ReleaseSources,
  options: ReleaseOptions = {},
): string[] {
  return [
    ...(options.certs === undefined ? [] : certificateErrors(options.certs)),
    ...versionErrors(artifact, sources),
    ...noticeErrors(artifact, sources.notices),
    ...secretErrors(artifact.files),
    ...permissionErrors(artifact.permissions, options.allowlist),
  ];
}

interface Args {
  apk?: string;
  certs?: string;
  tag?: string;
  aapt?: string;
  sdk?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`argument invalide « ${key ?? ""} » (attendu --clé valeur)`);
    }
    i += 1;
    switch (key) {
      case "--apk":
        args.apk = value;
        break;
      case "--certs":
        args.certs = value;
        break;
      case "--tag":
        args.tag = value;
        break;
      case "--aapt":
        args.aapt = value;
        break;
      case "--sdk":
        args.sdk = value;
        break;
      default:
        throw new Error(`option inconnue « ${key} »`);
    }
  }
  return args;
}

function tagFromEnv(env: NodeJS.ProcessEnv): string | null {
  if (env["GITHUB_REF_TYPE"] === "tag" && env["GITHUB_REF_NAME"]) return env["GITHUB_REF_NAME"];
  const ref = env["GITHUB_REF"] ?? "";
  return ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : null;
}

function sdkDirs(args: Args, env: NodeJS.ProcessEnv): string[] {
  const dirs = [args.sdk, env["ANDROID_SDK_ROOT"], env["ANDROID_HOME"]].filter(
    (dir): dir is string => typeof dir === "string" && dir.trim() !== "",
  );
  const local = join(ROOT, "android", "local.properties");
  if (existsSync(local)) {
    const sdk = /^sdk\.dir=(.+)$/m.exec(readFileSync(local, "utf8"))?.[1]?.trim();
    if (sdk) dirs.push(sdk);
  }
  return dirs;
}

/** `aapt` du build-tools le plus récent, sinon null. */
export function findAapt(args: Args = {}, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const sdk of sdkDirs(args, env)) {
    const buildTools = join(sdk, "build-tools");
    if (!existsSync(buildTools)) continue;
    const versions = readdirSync(buildTools).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    for (const version of versions.reverse()) {
      const aapt = join(buildTools, version, "aapt");
      if (existsSync(aapt)) return aapt;
    }
  }
  return null;
}

function run(cmd: string[]): { code: number | null; stdout: Uint8Array; stderr: string } {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  return {
    code: result.exitCode,
    stdout: result.stdout ?? new Uint8Array(),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function apkEntries(apk: string): string[] {
  const result = run(["unzip", "-Z1", apk]);
  if (result.code !== 0) throw new Error(`unzip -Z1 ${apk} a échoué : ${result.stderr.trim()}`);
  return new TextDecoder()
    .decode(result.stdout)
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && !entry.endsWith("/"));
}

function apkFile(apk: string, entry: string): Uint8Array {
  const result = run(["unzip", "-p", apk, entry]);
  if (result.code !== 0) throw new Error(`unzip -p ${entry} a échoué : ${result.stderr.trim()}`);
  return result.stdout;
}

/** Le manifeste binaire ne se lit qu'avec `aapt` : version et permissions sont
 *  celles de l'APK signé, pas celles des sources. */
function apkBadging(apk: string, aapt: string): Artifact {
  const result = run([aapt, "dump", "badging", apk]);
  const badging = new TextDecoder().decode(result.stdout);
  if (result.code !== 0) throw new Error(`aapt dump badging a échoué : ${result.stderr.trim()}`);
  const packageLine = /^package: .*$/m.exec(badging)?.[0];
  if (!packageLine) throw new Error("aapt : ligne « package: » absente");
  const versionName = /versionName='([^']*)'/.exec(packageLine)?.[1] ?? "";
  const versionCode = /versionCode='([^']*)'/.exec(packageLine)?.[1] ?? "";
  const permissions = [...badging.matchAll(/^uses-permission(?:-sdk-\d+)?: name='([^']+)'/gm)].map(
    (match) => match[1]!,
  );
  return { versionName, versionCode, permissions, files: [] };
}

function repoSources(): ReleaseSources {
  const version = versionFromTags(tagsAtHead(ROOT));
  const notices = new Map<string, Uint8Array>();
  notices.set(
    "assets/web/THIRD_PARTY_NOTICES.md",
    readFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md")),
  );
  const licenses = join(ROOT, "web", "public", "licenses");
  for (const name of readdirSync(licenses).filter((entry) => entry.endsWith(".txt")).sort()) {
    notices.set(`assets/web/licenses/${name}`, readFileSync(join(licenses, name)));
  }
  if (!notices.has("assets/web/licenses/APP-GPL-3.0-ONLY.txt")) {
    throw new Error("web/public/licenses/APP-GPL-3.0-ONLY.txt absent");
  }
  return {
    packageVersion: version.name,
    packageVersionCode: String(version.code),
    notices,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.apk) throw new Error("--apk requis");
  const apk = resolve(args.apk);
  if (!existsSync(apk)) throw new Error(`APK introuvable : ${apk}`);
  const aapt = args.aapt ?? findAapt(args);
  if (!aapt) throw new Error("aapt introuvable : définir ANDROID_SDK_ROOT ou --aapt");
  const sources = { ...repoSources(), tag: args.tag ?? tagFromEnv(process.env) };
  const manifest = apkBadging(apk, aapt);
  const files = apkEntries(apk)
    .filter((entry) => /^(?:assets|res\/raw)\//.test(entry) || /^classes\d*\.dex$/.test(entry))
    .map((entry) => ({ path: entry, bytes: apkFile(apk, entry) }));
  const artifact: Artifact = { ...manifest, files };
  const certs = args.certs ? readFileSync(args.certs, "utf8") : undefined;
  const errors = checkReleaseArtifact(artifact, sources, { certs });

  if (errors.length > 0) {
    for (const error of errors) console.error(`::error title=Artefact release::${error}`);
    console.error(`check-release-artifact FAIL (${errors.length} erreur(s))`);
    process.exit(1);
  }
  console.log(
    `check-release-artifact OK : APK ${artifact.versionName} (${artifact.versionCode}), ` +
      `${files.length} fichier(s) scanné(s), ${artifact.permissions.length} permission(s).`,
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`::error title=Artefact release::${(error as Error).message}`);
    process.exit(1);
  }
}
