// Fixtures des assertions de l'artefact release (#928) : chaque refus est
// prouvé sur une copie du manifeste/assets courant, sans construire l'APK.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  FALLBACK_VERSION,
  versionFromTag,
} from "../../agents/runtime/android-version";
import {
  PERMISSION_ALLOWLIST,
  certificateErrors,
  checkReleaseArtifact,
  type Artifact,
  type ReleaseSources,
} from "../../agents/runtime/check-release-artifact";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path));
const androidVersionName = FALLBACK_VERSION.name;
const LICENSES = join(ROOT, "web", "public", "licenses");

function notices(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set("assets/web/THIRD_PARTY_NOTICES.md", read("THIRD_PARTY_NOTICES.md"));
  for (const name of readdirSync(LICENSES).filter((entry) => entry.endsWith(".txt"))) {
    files.set(`assets/web/licenses/${name}`, readFileSync(join(LICENSES, name)));
  }
  return files;
}

function sources(overrides: Partial<ReleaseSources> = {}): ReleaseSources {
  return {
    packageVersion: FALLBACK_VERSION.name,
    packageVersionCode: String(FALLBACK_VERSION.code),
    tag: null,
    notices: notices(),
    ...overrides,
  };
}

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  const files = [...notices()].map(([path, bytes]) => ({ path, bytes }));
  return {
    versionName: FALLBACK_VERSION.name,
    versionCode: String(FALLBACK_VERSION.code),
    permissions: [...PERMISSION_ALLOWLIST],
    files,
    ...overrides,
  };
}

describe("assertions artefact release (#928)", () => {
  test("la configuration courante passe", () => {
    expect(checkReleaseArtifact(artifact(), sources())).toEqual([]);
    expect(certificateErrors("Signer #1 certificate DN: CN=VSN CI ephemeral,O=veryslopnynotes")).toEqual([]);
  });

  test("un certificat debug est refusé", () => {
    const errors = checkReleaseArtifact(artifact(), sources(), {
      certs: "Signer #1 certificate DN: CN=Android Debug,O=Android,C=US",
    });
    expect(errors.some((error) => error.includes("CN=Android Debug"))).toBe(true);
    expect(certificateErrors("")).not.toEqual([]);
  });

  test("une notice GPL ou tierce absente est refusée", () => {
    const copie = artifact();
    const errors = checkReleaseArtifact(
      { ...copie, files: copie.files.filter((file) => !file.path.endsWith("APP-GPL-3.0-ONLY.txt")) },
      sources(),
    );
    expect(errors).toContain("notice absente de l'APK : assets/web/licenses/APP-GPL-3.0-ONLY.txt");

    const sansInventaire = artifact();
    expect(
      checkReleaseArtifact(
        { ...sansInventaire, files: sansInventaire.files.filter((file) => file.path !== "assets/web/THIRD_PARTY_NOTICES.md") },
        sources(),
      ),
    ).toContain("notice absente de l'APK : assets/web/THIRD_PARTY_NOTICES.md");
  });

  test("une notice altérée est refusée", () => {
    const copie = artifact();
    const errors = checkReleaseArtifact(
      {
        ...copie,
        files: copie.files.map((file) =>
          file.path.endsWith("REACT-MIT.txt") ? { ...file, bytes: new TextEncoder().encode("MIT License") } : file,
        ),
      },
      sources(),
    );
    expect(errors).toContain("notice altérée dans l'APK : assets/web/licenses/REACT-MIT.txt");
  });

  test("un secret embarqué dans les assets est refusé", () => {
    const copie = artifact();
    const errors = checkReleaseArtifact(
      {
        ...copie,
        files: [
          ...copie.files,
          {
            path: "assets/web/assets/app.js",
            bytes: new TextEncoder().encode(
              `const key = "${["sk-or-v1", "abcdefgh1234"].join("-")}";`,
            ),
          },
        ],
      },
      sources(),
    );
    expect(errors.some((error) => error.includes("openrouter-key") && error.includes("assets/web/assets/app.js"))).toBe(
      true,
    );

    const dex = checkReleaseArtifact(
      {
        ...copie,
        files: [
          ...copie.files,
          {
            path: "classes.dex",
            bytes: new TextEncoder().encode(
              `const key = "${["sk-or-v1", "abcdefgh1234"].join("-")}";`,
            ),
          },
        ],
      },
      sources(),
    );
    expect(dex.some((error) => error.includes("openrouter-key") && error.includes("classes.dex"))).toBe(true);
  });

  test("une permission hors allowlist est refusée", () => {
    const copie = artifact();
    const errors = checkReleaseArtifact(
      { ...copie, permissions: [...copie.permissions, "android.permission.READ_SMS"] },
      sources(),
    );
    expect(errors).toContain("permission inattendue : android.permission.READ_SMS");
  });

  test("un tag, package ou APK de version différente est refusé", () => {
    const apkVersion = "99.0.0";
    const apk = checkReleaseArtifact(artifact({ versionName: apkVersion }), sources());
    expect(apk).toContain(`versionName Android ${androidVersionName} ≠ APK ${apkVersion}`);

    const packageVersion = checkReleaseArtifact(artifact(), sources({ packageVersion: "99.0.0" }));
    expect(packageVersion).toContain(`versionName Android 99.0.0 ≠ APK ${androidVersionName}`);

    const packageCode = checkReleaseArtifact(artifact(), sources({ packageVersionCode: "99" }));
    expect(packageCode).toContain(`versionCode Android 99 ≠ APK ${FALLBACK_VERSION.code}`);

    const tagged = versionFromTag("v1.9.9")!;
    const tag = checkReleaseArtifact(artifact(), sources({ tag: "v1.9.9" }));
    expect(tag).toContain(`tag ${tagged.name} ≠ versionName Android ${androidVersionName}`);
    expect(tag).toContain(`tag ${tagged.code} ≠ versionCode Android ${FALLBACK_VERSION.code}`);

    const badTag = checkReleaseArtifact(artifact(), sources({ tag: "release-0.1.0" }));
    expect(badTag.some((error) => error.includes("ne porte pas de version Android"))).toBe(true);
  });

  test("le tag accepte le préfixe v et refs/tags/", () => {
    const tagged = versionFromTag("v0.1.0")!;
    const sourcesTagged = sources({
      tag: "v0.1.0",
      packageVersion: tagged.name,
      packageVersionCode: String(tagged.code),
    });
    const artifactTagged = artifact({ versionName: tagged.name, versionCode: String(tagged.code) });
    expect(checkReleaseArtifact(artifactTagged, sourcesTagged)).toEqual([]);
    expect(checkReleaseArtifact(artifactTagged, { ...sourcesTagged, tag: "refs/tags/v0.1.0" })).toEqual([]);
  });
});
