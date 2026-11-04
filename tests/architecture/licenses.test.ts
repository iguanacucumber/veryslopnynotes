// Les notices de licence (GPL de l'app, MIT, Apache-2.0, OFL) sont
// redistribuées avec l'APK : Vite copie `web/public/` dans `assets/web/`.
// L'inventaire et les versions sont vérifiés contre `bun.lock` et le catalogue
// Gradle : une dépendance livrée sans son texte est une redistribution sans
// licence.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveConfig } from "vite";

const ROOT = join(import.meta.dir, "..", "..");
const LICENSES = join(ROOT, "web", "public", "licenses");
const NOTICES = "THIRD_PARTY_NOTICES.md";
const repo = (path: string) => readFileSync(join(ROOT, path), "utf8");
const notice = (name: string) => readFileSync(join(LICENSES, name), "utf8");

function required(value: string | undefined, label: string): string {
  if (value === undefined) throw new Error(`${label} absent`);
  return value;
}

const pkg = JSON.parse(repo("package.json")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const lock = repo("bun.lock");
const catalog = Bun.TOML.parse(repo("android/gradle/libs.versions.toml")) as {
  versions: Record<string, string>;
};
const notices = repo(NOTICES);
const appVersion = required(
  /versionName\s*=\s*"([^"]+)"/.exec(repo("android/app/build.gradle.kts"))?.[1],
  "versionName Android",
);
const papiconsVersion = required(
  /Icônes Papicons ([\d.]+)/.exec(repo("web/src/ui/icons.tsx"))?.[1],
  "version Papicons",
);

type Source = "npm" | "gradle" | "asset" | "app";

interface Shipped {
  component: string;
  version: string; // vide pour un asset sans version résolue
  license: string;
  text: string;
  source: Source;
  ref?: string; // alias du catalogue Gradle
}

const SHIPPED: Shipped[] = [
  {
    component: "veryslopnynotes",
    version: appVersion,
    license: "GPL-3.0-only",
    text: "APP-GPL-3.0-ONLY.txt",
    source: "app",
  },
  {
    component: "pronotets",
    version: required(pkg.devDependencies["pronotets"], "pronotets"),
    license: "MIT",
    text: "PRONOTETS-MIT.txt",
    source: "npm",
  },
  {
    component: "react",
    version: required(pkg.dependencies["react"], "react"),
    license: "MIT",
    text: "REACT-MIT.txt",
    source: "npm",
  },
  {
    component: "react-dom",
    version: required(pkg.dependencies["react-dom"], "react-dom"),
    license: "MIT",
    text: "REACT-MIT.txt",
    source: "npm",
  },
  {
    component: "react-router-dom",
    version: required(pkg.dependencies["react-router-dom"], "react-router-dom"),
    license: "MIT",
    text: "REACT-ROUTER-DOM-MIT.txt",
    source: "npm",
  },
  {
    component: "rolldown",
    version: required(/"(rolldown)": \["rolldown@([^"]+)"/.exec(lock)?.[2], "rolldown dans bun.lock"),
    license: "MIT",
    text: "ROLLDOWN-MIT.txt",
    source: "npm",
  },
  {
    component: "androidx.core:core-ktx",
    version: required(catalog.versions["core-ktx"], "core-ktx"),
    license: "Apache-2.0",
    text: "APACHE-2.0.txt",
    source: "gradle",
    ref: "core-ktx",
  },
  {
    component: "androidx.activity:activity-ktx",
    version: required(catalog.versions["activity-ktx"], "activity-ktx"),
    license: "Apache-2.0",
    text: "APACHE-2.0.txt",
    source: "gradle",
    ref: "activity-ktx",
  },
  {
    component: "androidx.exifinterface:exifinterface",
    version: required(catalog.versions["exifinterface"], "exifinterface"),
    license: "Apache-2.0",
    text: "APACHE-2.0.txt",
    source: "gradle",
    ref: "exifinterface",
  },
  {
    component: "androidx.security:security-crypto",
    version: required(catalog.versions["security-crypto"], "security-crypto"),
    license: "Apache-2.0",
    text: "APACHE-2.0.txt",
    source: "gradle",
    ref: "security-crypto",
  },
  {
    component: "androidx.work:work-runtime-ktx",
    version: required(catalog.versions["work"], "work"),
    license: "Apache-2.0",
    text: "APACHE-2.0.txt",
    source: "gradle",
    ref: "work",
  },
  {
    component: "com.squareup.okhttp3:okhttp",
    version: required(catalog.versions["okhttp"], "okhttp"),
    license: "Apache-2.0",
    text: "APACHE-2.0.txt",
    source: "gradle",
    ref: "okhttp",
  },
  {
    component: "com.journeyapps:zxing-android-embedded",
    version: required(catalog.versions["zxing-android-embedded"], "zxing-android-embedded"),
    license: "Apache-2.0",
    text: "APACHE-2.0.txt",
    source: "gradle",
    ref: "zxing-android-embedded",
  },
  { component: "SN Pro", version: "", license: "OFL-1.1", text: "SN-PRO-OFL.txt", source: "asset" },
  {
    component: "Papicons",
    version: papiconsVersion,
    license: "MIT",
    text: "PAPICONS-MIT.txt",
    source: "asset",
  },
];

describe("notices de licence embarquées", () => {
  test("chaque texte référencé existe, est complet et sans orphelin", () => {
    const texts = [...new Set(SHIPPED.map((dep) => dep.text))].sort();
    expect(readdirSync(LICENSES).sort()).toEqual(texts);
    for (const text of texts) {
      expect({ texte: text, complet: notice(text).trim().length > 500 }).toEqual({
        texte: text,
        complet: true,
      });
    }
  });

  test("chaque dépendance livrée a une ligne versionnée dans l'inventaire", () => {
    expect(notices.trim().length).toBeGreaterThan(500);
    const lines = notices.split("\n");
    for (const dep of SHIPPED) {
      const found = lines.some(
        (line) =>
          line.includes(dep.component) &&
          line.includes(dep.version) &&
          line.includes(dep.license) &&
          line.includes(dep.text),
      );
      expect({ composant: dep.component, inventorie: found }).toEqual({
        composant: dep.component,
        inventorie: true,
      });
    }
  });

  test("les versions web sont celles résolues dans bun.lock", () => {
    for (const dep of SHIPPED.filter((d) => d.source === "npm")) {
      expect({
        paquet: dep.component,
        resolu: lock.includes(`"${dep.component}": ["${dep.component}@${dep.version}"`),
      }).toEqual({ paquet: dep.component, resolu: true });
    }
  });

  test("les versions Android sont celles du catalogue Gradle", () => {
    for (const dep of SHIPPED.filter((d) => d.source === "gradle")) {
      const ref = required(dep.ref, `alias Gradle de ${dep.component}`);
      expect({ composant: dep.component, version: catalog.versions[ref] }).toEqual({
        composant: dep.component,
        version: dep.version,
      });
    }
  });

  test("les textes GPL, Apache-2.0, MIT et OFL sont canoniques", () => {
    expect(notice("APP-GPL-3.0-ONLY.txt")).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(notice("APP-GPL-3.0-ONLY.txt")).toContain("Version 3, 29 June 2007");
    expect(notice("APACHE-2.0.txt")).toContain("Apache License");
    expect(notice("APACHE-2.0.txt")).toContain("Version 2.0, January 2004");
    for (const text of [
      "PRONOTETS-MIT.txt",
      "REACT-MIT.txt",
      "REACT-ROUTER-DOM-MIT.txt",
      "ROLLDOWN-MIT.txt",
      "PAPICONS-MIT.txt",
    ]) {
      expect({ texte: text, mit: notice(text).includes("MIT License") }).toEqual({
        texte: text,
        mit: true,
      });
      expect({ texte: text, garantie: notice(text).includes("WITHOUT WARRANTY OF ANY KIND") }).toEqual({
        texte: text,
        garantie: true,
      });
    }
    expect(notice("SN-PRO-OFL.txt")).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  test("les notices nomment les ayants droit des paquets installés", () => {
    expect(notice("PRONOTETS-MIT.txt")).toContain("Copyright (c) 2026 Pyronixus");
    expect(notice("REACT-MIT.txt")).toContain("Meta Platforms, Inc. and affiliates");
    expect(notice("REACT-ROUTER-DOM-MIT.txt")).toContain("React Training LLC");
    expect(notice("ROLLDOWN-MIT.txt")).toContain("VoidZero Inc. & Contributors");
    expect(notice("SN-PRO-OFL.txt")).toContain("The SN Pro Project Authors");
    expect(notice("PAPICONS-MIT.txt")).toContain("Association Papillon");
  });

  test("Vite copie bien ce dossier dans les assets de l'APK", async () => {
    const config = await resolveConfig(
      { configFile: join(ROOT, "web", "vite.config.ts"), root: join(ROOT, "web") },
      "build",
    );
    expect(config.publicDir).toBe(join(ROOT, "web", "public"));
    expect(resolve(join(ROOT, "web"), config.build.outDir)).toBe(
      join(ROOT, "android", "app", "src", "main", "assets", "web"),
    );
  });
});
