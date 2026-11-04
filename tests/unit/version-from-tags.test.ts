import { describe, expect, test } from "bun:test";
import {
  FALLBACK_VERSION,
  MAX_VERSION_CODE,
  versionFromTag,
  versionFromTags,
} from "../../agents/runtime/android-version";

describe("version Android : un tag vX.Y.Z fixe versionName et versionCode (#927)", () => {
  test("aucun tag : repli déterministe 0.1.0 / 1", () => {
    expect(versionFromTags([])).toEqual({ name: "0.1.0", code: 1 });
    expect(FALLBACK_VERSION).toEqual({ name: "0.1.0", code: 1 });
  });

  test("les tags qui ne sont pas des versions sont ignorés", () => {
    expect(versionFromTags(["nightly", "backup-2024", "release-1.2.3", "vNext"])).toEqual({
      name: "0.1.0",
      code: 1,
    });
  });

  test("le préfixe v disparaît du versionName et le code encode X.Y.Z", () => {
    expect(versionFromTag("v0.1.0")).toEqual({ name: "0.1.0", code: 1_000 });
    expect(versionFromTag("v1.2.3")).toEqual({ name: "1.2.3", code: 1_002_003 });
    expect(versionFromTag("v2100.0.0")).toEqual({ name: "2100.0.0", code: MAX_VERSION_CODE });
  });

  test("versionCode strictement croissant pour toute suite de versions croissantes", () => {
    const tags = [
      "v0.0.1",
      "v0.0.999",
      "v0.1.0",
      "v0.1.1",
      "v0.1.999",
      "v0.2.0",
      "v0.999.999",
      "v1.0.0",
      "v1.2.3",
      "v1.2.999",
      "v1.3.0",
      "v1.999.999",
      "v2.0.0",
      "v2099.999.999",
      "v2100.0.0",
    ];
    for (let i = 1; i < tags.length; i++) {
      const previous = versionFromTags([tags[i - 1]!]);
      const current = versionFromTags([tags[i]!]);
      expect({ pair: [tags[i - 1], tags[i]], croissant: current.code > previous.code }).toEqual({
        pair: [tags[i - 1], tags[i]],
        croissant: true,
      });
    }
  });

  test("plusieurs tags sur HEAD : le plus haut gagne, de façon déterministe", () => {
    expect(versionFromTags(["v1.0.0", "nightly", "v2.0.0", "v1.5.0"])).toEqual({
      name: "2.0.0",
      code: 2_000_000,
    });
  });

  test("une pré-release est refusée avec un message explicite", () => {
    expect(() => versionFromTags(["v1.2.3-beta.1"])).toThrow(/pré-release/);
    expect(() => versionFromTags(["v1.2.3-rc.1"])).toThrow(/versionCode/);
  });

  test("un tag qui ressemble à une version mais est malformé est refusé", () => {
    for (const tag of [
      "v1.2",
      "v1.2.3.4",
      "v01.2.3",
      "v1.02.3",
      "v1.2.03",
      "v1.2.x",
      "v1.2.3+build.1",
      "v1.2.1000",
      "v2100.0.1",
    ]) {
      expect(() => versionFromTags([tag])).toThrow();
    }
  });
});
