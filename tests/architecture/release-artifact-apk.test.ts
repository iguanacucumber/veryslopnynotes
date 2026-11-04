// APK fixture réel (manifeste binaire + assets) : le script lit `aapt` et
// `unzip`, pas seulement des fonctions pures. Chaque assertion doit rougir
// quand la fixture viole une règle, et passer sur la configuration courante.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FALLBACK_VERSION } from "../../agents/runtime/android-version";
import { PERMISSION_ALLOWLIST } from "../../agents/runtime/check-release-artifact";

const ROOT = join(import.meta.dir, "..", "..");
const APP_VERSION = FALLBACK_VERSION.name;
const APP_VERSION_CODE = String(FALLBACK_VERSION.code);

function sdk(): string {
  const env = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  if (env) return env;
  const local = join(ROOT, "android", "local.properties");
  if (!existsSync(local)) return "";
  return /^sdk\.dir=(.+)$/m.exec(readFileSync(local, "utf8"))?.[1]?.trim() ?? "";
}

function find(dir: string, names: string[]): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .reverse()
    .map((name) => join(dir, name, ...names))
    .find((path) => existsSync(path)) ?? "";
}

const SDK = sdk();
const AAPT2 = find(join(SDK, "build-tools"), ["aapt2"]);
const ANDROID_JAR = find(join(SDK, "platforms"), ["android.jar"]);
const SKIP =
  !APP_VERSION || !AAPT2 || !ANDROID_JAR
    ? "SDK Android absent (aapt2/android.jar) : fixture APK non construite."
    : null;
if (SKIP) console.warn(`\n  SKIP BRUYANT — assertions APK non éprouvées. ${SKIP}\n`);

interface Fixture {
  versionName?: string;
  versionCode?: string;
  unexpectedPermission?: string;
  omitNotice?: string;
  secret?: boolean;
}

function manifest(versionName: string, versionCode: string, permissions: string[]): string {
  return `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="fr.veryslopnynotes.app" android:versionCode="${versionCode}" android:versionName="${versionName}">
  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="37"/>
${permissions.map((name) => `  <uses-permission android:name="${name}"/>`).join("\n")}
  <application android:label="Fixture"/>
</manifest>
`;
}

function build(options: Fixture = {}): { dir: string; apk: string } {
  const dir = mkdtempSync(join(tmpdir(), "vsn-release-apk-"));
  const assets = join(dir, "assets");
  mkdirSync(join(assets, "web", "licenses"), { recursive: true });
  cpSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), join(assets, "web", "THIRD_PARTY_NOTICES.md"));
  for (const name of readdirSync(join(ROOT, "web", "public", "licenses"))) {
    if (name === options.omitNotice) continue;
    cpSync(join(ROOT, "web", "public", "licenses", name), join(assets, "web", "licenses", name));
  }
  if (options.secret) {
    mkdirSync(join(assets, "web", "assets"), { recursive: true });
    writeFileSync(
      join(assets, "web", "assets", "leak.js"),
      `const key = "${["sk-or-v1", "abcdefgh1234"].join("-")}";\n`,
    );
  }
  const permissions = [...PERMISSION_ALLOWLIST];
  if (options.unexpectedPermission) permissions.push(options.unexpectedPermission);
  const manifestPath = join(dir, "AndroidManifest.xml");
  writeFileSync(
    manifestPath,
    manifest(options.versionName ?? APP_VERSION, options.versionCode ?? APP_VERSION_CODE, permissions),
  );
  const apk = join(dir, "fixture.apk");
  const build = Bun.spawnSync(
    [AAPT2, "link", "-o", apk, "--manifest", manifestPath, "-I", ANDROID_JAR, "-A", assets],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (build.exitCode !== 0) {
    throw new Error(`aapt2 link a échoué : ${new TextDecoder().decode(build.stderr)}`);
  }
  return { dir, apk };
}

function run(apk: string, args: string[] = []): { code: number | null; out: string } {
  const result = Bun.spawnSync(
    ["bun", "run", "agents/runtime/check-release-artifact.ts", "--apk", apk, "--sdk", SDK, ...args],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  return {
    code: result.exitCode,
    out: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

describe("assertions artefact release sur APK réel (#928)", () => {
  test.skipIf(SKIP !== null)("la fixture conforme passe sur la configuration courante", () => {
    const { dir, apk } = build();
    try {
      const result = run(apk);
      expect({ code: result.code, out: result.out }).toEqual({
        code: 0,
        out: expect.stringContaining("check-release-artifact OK"),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test.skipIf(SKIP !== null)("un certificat debug, une notice, un secret, une permission et une version sont refusés", () => {
    const cases: { name: string; certs?: boolean; fixture?: Fixture; expected: string }[] = [
      { name: "debug", certs: true, expected: "CN=Android Debug" },
      { name: "notice", fixture: { omitNotice: "APP-GPL-3.0-ONLY.txt" }, expected: "notice absente" },
      { name: "secret", fixture: { secret: true }, expected: "secret potentiel" },
      {
        name: "permission",
        fixture: { unexpectedPermission: "android.permission.READ_SMS" },
        expected: "permission inattendue : android.permission.READ_SMS",
      },
      { name: "version", fixture: { versionName: "9.9.9" }, expected: "≠" },
    ];
    for (const c of cases) {
      const { dir, apk } = build(c.fixture);
      try {
        const args: string[] = [];
        if (c.certs) {
          const certs = join(dir, "certs.txt");
          writeFileSync(certs, "Signer #1 certificate DN: CN=Android Debug,O=Android,C=US\n");
          args.push("--certs", certs);
        }
        const result = run(apk, args);
        expect({ cas: c.name, code: result.code }).toEqual({ cas: c.name, code: 1 });
        expect({ cas: c.name, erreur: result.out.includes(c.expected) }).toEqual({
          cas: c.name,
          erreur: true,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 30_000);
});
