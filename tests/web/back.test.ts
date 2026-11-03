import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideBack } from "../../web/src/lib/back";
import {
  closeTopDialog,
  dialogCount,
  registerDialog,
} from "../../web/src/ui/dialogStack";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("retour matériel — décision pure", () => {
  test("un dialogue ouvert passe avant la route", () => {
    expect(decideBack({ dialogs: 1, pathname: "/settings", metaBack: "/profile" })).toEqual({
      kind: "dialog",
    });
    expect(decideBack({ dialogs: 2, pathname: "/", metaBack: undefined })).toEqual({
      kind: "dialog",
    });
  });

  test("sans dialogue, une route recule vers son repli meta.back", () => {
    expect(decideBack({ dialogs: 0, pathname: "/messages/d1", metaBack: "/messages" })).toEqual({
      kind: "route",
      fallback: "/messages",
    });
  });

  test("une route sans meta.back recule vers l'accueil, jamais hors de l'app", () => {
    expect(decideBack({ dialogs: 0, pathname: "/inconnue" })).toEqual({
      kind: "route",
      fallback: "/",
    });
  });

  test("l'accueil est la seule sortie", () => {
    expect(decideBack({ dialogs: 0, pathname: "/" })).toEqual({ kind: "root" });
  });
});

describe("pile de dialogues — le dernier ouvert ferme en premier", () => {
  test("LIFO, puis retrait sans fermer le suivant", () => {
    const closed: string[] = [];
    const removeA = registerDialog(() => closed.push("a"));
    const removeB = registerDialog(() => closed.push("b"));
    expect(dialogCount()).toBe(2);

    expect(closeTopDialog()).toBe(true);
    expect(closed).toEqual(["b"]);
    expect(dialogCount()).toBe(2);

    removeB();
    expect(dialogCount()).toBe(1);
    expect(closeTopDialog()).toBe(true);
    expect(closed).toEqual(["b", "a"]);

    removeA();
    expect(dialogCount()).toBe(0);
    expect(closeTopDialog()).toBe(false);
  });
});

describe("câblage web du retour", () => {
  test("la navigation matérielle et le dialogue partagent les mêmes briques", () => {
    const navigation = read("web/src/ui/BackNavigation.tsx");
    expect(navigation).toContain("decideBack(");
    expect(navigation).toContain("closeTopDialog()");
    expect(navigation).toContain("window.__vsnBack = onBack");
    expect(navigation).toContain("bridge.backState(available)");

    expect(read("web/src/ui/Dialog.tsx")).toContain("registerDialog(");
    expect(read("web/src/main.tsx")).toContain("<BackNavigation />");
  });
});
