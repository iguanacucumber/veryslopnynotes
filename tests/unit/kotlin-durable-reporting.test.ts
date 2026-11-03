// #910 — une suppression n'est « réussie » que si le fichier a VRAIMENT
// disparu ; une donnée illisible est DITE et n'est jamais écrasée en silence.
//
// Le VRAI `DurableFile` compilé par le harnais est piloté : suppression
// refusée par le disque, corruption sans sauvegarde, puis relecture des stores.
// Outillage absent = SKIP BRUYANT.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "AtomicFileMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

afterAll(async () => {
  if (!link) return;
  try {
    await link.ask({ op: "cleanup" });
  } catch {
    // pilote déjà mort : rien à nettoyer.
  }
});

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

const source = (name: string): string => readFileSync(join(DATA, name), "utf8");

function bodyOf(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  const open = src.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

describe("suppression VÉRIFIÉE (#910)", () => {
  test.skipIf(skip)("la cible, sa sauvegarde et la quarantaine partent, absence vérifiée", async () => {
    const sid = (await ask({ op: "newDir" })).sid as number;

    await ask({ op: "write", sid, name: "store.json", content: "v1" });
    await ask({ op: "write", sid, name: "store.json", content: "v2" });
    await ask({ op: "writeRaw", sid, name: "store.json", content: "BAD{corrompu" });
    // Corruption : la cible part en quarantaine, la sauvegarde reste.
    expect((await ask({ op: "read", sid, name: "store.json" })).value).toBe("v1");

    const result = await ask({ op: "delete", sid, name: "store.json" });
    expect(result.deleted).toBe(true);
    const files = (await ask({ op: "files", sid })).files as string[];
    expect(files).toEqual([]);
  });

  test.skipIf(skip)("un fichier qui résiste rend `false`, sans annoncer un succès", async () => {
    const sid = (await ask({ op: "newDir" })).sid as number;

    await ask({ op: "write", sid, name: "store.json", content: "v1" });
    await ask({ op: "write", sid, name: "store.json", content: "v2" });
    await ask({ op: "writeRaw", sid, name: "store.json", content: "BAD{corrompu" });
    await ask({ op: "read", sid, name: "store.json" });
    await ask({ op: "writeRaw", sid, name: "store.json", content: "nouvelle" });

    const result = await ask({ op: "deleteFail", sid, name: "store.json" });
    expect(result.deleted).toBe(false);
    // Rien n'a disparu : la cible et la sauvegarde sont encore là.
    expect((await ask({ op: "raw", sid, name: "store.json" })).exists).toBe(true);
    expect((await ask({ op: "raw", sid, name: "store.json.bak" })).exists).toBe(true);
    const files = (await ask({ op: "files", sid })).files as string[];
    expect(files.some((f) => f.startsWith("quarantine/store.json."))).toBe(true);
  });
});

describe("corruption DITE (#910)", () => {
  test.skipIf(skip)("sans sauvegarde, la lecture lève « données locales illisibles »", async () => {
    const sid = (await ask({ op: "newDir" })).sid as number;

    await ask({ op: "writeRaw", sid, name: "store.json", content: "BAD{seul" });
    const read = await ask({ op: "read", sid, name: "store.json" });

    expect(read.unreadable).toBe(true);
    expect(read.value).toBeNull();
    expect(String(read.message).toLowerCase()).toContain("données locales illisibles");
    // L'octet corrompu n'est pas perdu : il reste inspectable en quarantaine.
    expect((await ask({ op: "raw", sid, name: "store.json" })).exists).toBe(false);
    const files = (await ask({ op: "files", sid })).files as string[];
    const quarantined = files.find((f) => f.startsWith("quarantine/store.json.") && f.endsWith(".corrupt"));
    expect(quarantined).toBeDefined();
    expect((await ask({ op: "raw", sid, name: quarantined! })).content).toBe("BAD{seul");
  });
});

describe("aucun écrasement silencieux d'une cible illisible (#910)", () => {
  test("chaque store relit AVANT d'écrire", () => {
    const chat = source("TeacherChatStore.kt");
    const chatSave = bodyOf(chat, "override fun save(thread: TeacherThread, epoch: Long)");
    expect(chatSave.indexOf("load()")).toBeGreaterThan(-1);
    expect(chatSave.indexOf("load()")).toBeLessThan(chatSave.indexOf("OfflineArtifacts.writeText"));

    const notes = source("LessonNotesStore.kt");
    const notesSave = bodyOf(notes, "override fun save(notes: List<LessonNote>, epoch: Long)");
    expect(notesSave.indexOf("read()")).toBeGreaterThan(-1);
    expect(notesSave.indexOf("read()")).toBeLessThan(notesSave.indexOf("OfflineArtifacts.writeText"));

    const prefs = source("SubjectPrefs.kt");
    const prefsSave = bodyOf(prefs, "override fun save(prefs: List<SubjectPrefs>, epoch: Long)");
    expect(prefsSave.indexOf("load()")).toBeGreaterThan(-1);
    expect(prefsSave.indexOf("load()")).toBeLessThan(prefsSave.indexOf("OfflineArtifacts.writeText"));

    // L'entrée `data()` ne convertit plus une corruption en objet vide.
    const manual = source("Manuals.kt");
    expect(manual).toContain("private fun data(): JSONObject =\n        file?.let { DurableFile.read(it, ::parseObject) } ?: legacyData()");
    const manualUpdate = bodyOf(manual, "private fun update(block: (JSONObject) -> Unit)");
    expect(manualUpdate.indexOf("data()")).toBeGreaterThan(-1);
    expect(manualUpdate.indexOf("data()")).toBeLessThan(manualUpdate.indexOf("OfflineArtifacts.writeText"));
    expect(manualUpdate).toContain("catch (e: LocalDataUnreadable)");
  });

  test("la suppression du chat passe aussi par le chemin vérifié", () => {
    const chat = source("TeacherChatStore.kt");
    const remove = bodyOf(chat, "override fun delete(epoch: Long): TeacherChatDelete");
    expect(remove).toContain("DurableFile.delete(file)");
    expect(remove).toContain("TeacherChatDelete.FAILED");
  });

  test("le manuel rend son verdict de purge au lieu de l'avaler", () => {
    const manual = source("Manuals.kt");
    expect(manual).toContain("fun clearAccountData(): Boolean");
    expect(manual).toContain("clearManualAccountData(file)");
    expect(manual).toContain("?.commit() ?: true");
    // L'effacement du fichier et des clés héritées vit dans le seam PUR, joué
    // par `kotlin-manual-account-purge.test.ts`.
    expect(source("ManualAccountData.kt")).toContain("DurableFile.delete(it)");
  });
});
