// UI test (#896) : la rationale et le refus sont des états RENDUS dans Réglages,
// pas des promesses avalées. Le test appareil (API 37) est décrit dans
// `android/README.md` ; ici on vérifie le câblage et les phrases visibles.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOCAL_NETWORK_RATIONALE,
  LOCAL_NETWORK_TITLE,
  serverSaveError,
} from "../../web/src/features/settings/model";

const WEB = join(import.meta.dir, "..", "..", "web", "src");
const APP = join(
  import.meta.dir,
  "..",
  "..",
  "android",
  "app",
  "src",
  "main",
  "java",
  "fr",
  "veryslopnynotes",
  "app",
);

function source(path: string, root = WEB): string {
  return readFileSync(join(root, path), "utf8");
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe("réglages — autorisation réseau local demandée à l'enregistrement (#896)", () => {
  const card = source("features/settings/ServerCard.tsx");

  test("une adresse LAN montre la rationale avant de lancer l'enregistrement", () => {
    expect(LOCAL_NETWORK_TITLE).toBe("Accès au réseau local");
    expect(LOCAL_NETWORK_RATIONALE).toContain("Android");
    expect(LOCAL_NETWORK_RATIONALE).toContain("adresse ne sera pas enregistrée");
    expect(card).toContain("bridge.localNetwork(result.value)");
    expect(card).toContain("setPermissionHost(result.value)");
    expect(card).toContain("LOCAL_NETWORK_RATIONALE");
    expect(card).toContain("LOCAL_NETWORK_TITLE");
    expect(card).toContain("<Dialog");
    const save = between(card, "async function saveHost()", "async function allowLocalNetwork()");
    expect(save.indexOf("bridge.localNetwork")).toBeGreaterThan(-1);
    expect(save.indexOf("bridge.localNetwork")).toBeLessThan(save.indexOf("persistHost"));
  });

  test("un refus natif est affiché tel quel, jamais transformé en succès", () => {
    const refused =
      "Accès au réseau local refusé : l’adresse n’a pas été enregistrée. Autorise « Réseau local » dans Réglages Android.";
    expect(serverSaveError({ ok: false, message: refused })).toBe(refused);
    expect(serverSaveError({ ok: false })).toContain("vérifie le domaine");
    expect(serverSaveError({ ok: true })).toBe("");

    const persist = between(card, "async function persistHost", "async function saveHost");
    expect(persist).toContain("serverSaveError(response)");
    expect(persist.indexOf("if (!response.ok)")).toBeLessThan(
      persist.indexOf('setHostSaved("Adresse du serveur enregistrée.")'),
    );
  });

  test("annuler la rationale n'écrit pas l'adresse et le dit", () => {
    const cancel = between(card, "function cancelLocalNetwork", "return (");
    expect(cancel).not.toContain("persistHost");
    expect(cancel).toContain("setPermissionHost(null)");
    expect(cancel).toContain("Adresse non enregistrée");
  });
});

describe("natif — aucune demande au démarrage, porte LAN puis écriture (#896)", () => {
  test("MainActivity ne demande plus rien avant l'enregistrement", () => {
    const activity = source("MainActivity.kt", APP);
    expect(activity).not.toContain("requestLocalNetworkPermission");
    expect(activity).not.toContain("ACCESS_LOCAL_NETWORK");
    expect(activity).not.toContain("RequestPermission");
  });

  test("saveServer consulte la porte LAN AVANT le point d'écriture", () => {
    const settings = source("VsnBridgeSettings.kt", APP);
    const save = between(
      settings,
      "internal fun VsnBridge.saveServer",
      "internal fun VsnBridge.localNetworkStatus",
    );
    expect(save).toContain("localNetworkPermissionRequired(checked.baseUrl)");
    expect(save).toContain("requestLocalNetworkPermission(requestId, checked.baseUrl)");
    expect(save).toContain("completeServerSave(checked.baseUrl)");
    expect(save.indexOf("localNetworkPermissionRequired")).toBeLessThan(
      save.indexOf("completeServerSave(checked.baseUrl)"),
    );
  });

  test("un refus répond un message avec le chemin Réglages, sans écrire", () => {
    const bridge = source("VsnBridge.kt", APP);
    expect(bridge).toContain("Accès au réseau local refusé");
    expect(bridge).toContain("Réglages Android");
    const denied = between(
      bridge,
      "private fun completeLocalNetworkSave",
      "private fun failLocalNetworkSave",
    );
    expect(denied).toContain("if (!granted)");
    expect(denied.indexOf("if (!granted)")).toBeLessThan(denied.indexOf("completeServerSave"));
  });
});
