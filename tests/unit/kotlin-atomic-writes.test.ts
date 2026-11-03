// #879 — une écriture durable ne perd jamais la version précédente : le
// contenu part dans un temporaire fsyncé, la cible est remplacée par rename,
// et la version d'avant reste en `.bak`. Un fichier corrompu est mis en
// quarantaine, puis la sauvegarde est relue.
//
// Les pannes (écriture partielle, rename refusé) sont INJECTÉES dans le VRAI
// `DurableFile` compilé par le harnais. Outillage absent = SKIP BRUYANT.
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

describe("câblage des écritures durables (#879)", () => {
  test("notes, chat et préférences passent par le même chemin atomique", () => {
    const artifacts = source("OfflineArtifacts.kt");
    expect(artifacts).toContain("DurableFile.write(file, content.toByteArray(Charsets.UTF_8))");
    expect(artifacts).toContain("DurableFile.write(file, bytes)");
    // La garde d'époque reste AUTOUR de l'écriture et de son dossier.
    const guard = artifacts.indexOf("SessionEpoch.writeIfCurrent(epoch)");
    expect(guard).toBeGreaterThan(-1);
    expect(artifacts.indexOf("it.mkdirs()")).toBeGreaterThan(guard);

    expect(source("LessonNotesStore.kt")).toContain("DurableFile.read(file, ::parseLessonNotesOrNull)");
    expect(source("TeacherChatStore.kt")).toContain("DurableFile.read(file, ::parseTeacherThreadOrNull)");
    expect(source("SubjectPrefs.kt")).toContain(
      "DurableFile.read(file, SubjectPrefs::listFromJsonOrNull)",
    );
  });

  test("le manuel utilise le même chemin, dans offline/, et la purge efface ses copies", () => {
    const manuals = source("Manuals.kt");
    expect(manuals).toContain('File(context.applicationContext.filesDir, "offline/manual.json")');
    expect(manuals).toContain("DurableFile.read(it, ::parseObject)");
    // Même chemin durable ET même garde d'époque que les trois autres stores.
    expect(manuals).toContain("OfflineArtifacts.writeText(target, obj.toString(), SessionEpoch.current())");
    // Cible, `.bak` ET quarantaine partent avec le compte (I16) : l'effacement
    // vérifié vit dans le seam pur joué par la parité.
    expect(source("ManualAccountData.kt")).toContain("DurableFile.delete(it)");
    expect(manuals).toContain("clearManualAccountData(file)");
    // Le drapeau d'invitation n'est jamais une donnée du compte.
    const purge = manuals.slice(
      manuals.indexOf("fun clearAccountData()"),
      manuals.indexOf("fun saveGuess("),
    );
    expect(purge).not.toContain("KEY_PROMPT_SEEN");
  });
});

describe("crash simulé : la version précédente survit (#879)", () => {
  test.skipIf(skip)("une écriture interrompue laisse cible et sauvegarde intactes", async () => {
    const sid = (await ask({ op: "newDir" })).sid as number;

    expect((await ask({ op: "write", sid, name: "store.json", content: "v1" })).written).toBe(true);
    expect((await ask({ op: "write", sid, name: "store.json", content: "v2" })).written).toBe(true);

    const crashed = await ask({ op: "crashWrite", sid, name: "store.json", content: "v3" });
    expect(crashed.failure).toBe("IOException");

    // Aucune écriture partielle n'est visible, et la sauvegarde d'avant reste.
    expect((await ask({ op: "raw", sid, name: "store.json" })).content).toBe("v2");
    expect((await ask({ op: "raw", sid, name: "store.json.bak" })).content).toBe("v1");
    const files = (await ask({ op: "files", sid })).files as string[];
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test.skipIf(skip)("un rename refusé ne remplace pas la cible", async () => {
    const sid = (await ask({ op: "newDir" })).sid as number;

    await ask({ op: "write", sid, name: "store.json", content: "v1" });
    await ask({ op: "write", sid, name: "store.json", content: "v2" });

    const crashed = await ask({ op: "crashRename", sid, name: "store.json", content: "v3" });
    expect(crashed.failure).toBe("IOException");

    // La sauvegarde est la version d'AVANT ce remplacement (v2), pas v1 :
    // elle est réécrite juste avant le rename refusé.
    expect((await ask({ op: "raw", sid, name: "store.json" })).content).toBe("v2");
    expect((await ask({ op: "raw", sid, name: "store.json.bak" })).content).toBe("v2");
  });
});

describe("fichier corrompu : quarantaine puis sauvegarde (#879)", () => {
  test.skipIf(skip)("la cible illisible part en quarantaine, la sauvegarde revient", async () => {
    const sid = (await ask({ op: "newDir" })).sid as number;

    await ask({ op: "write", sid, name: "store.json", content: "v1" });
    await ask({ op: "write", sid, name: "store.json", content: "v2" });
    // Corruption externe : la cible n'est plus du JSON lisible.
    await ask({ op: "writeRaw", sid, name: "store.json", content: "BAD{corrompu" });

    const read = await ask({ op: "read", sid, name: "store.json" });
    expect(read.value).toBe("v1");

    // La cible restaurée EST la sauvegarde ; l'octet corrompu est conservé.
    expect((await ask({ op: "raw", sid, name: "store.json" })).content).toBe("v1");
    expect((await ask({ op: "raw", sid, name: "store.json.bak" })).content).toBe("v1");
    const files = (await ask({ op: "files", sid })).files as string[];
    const quarantined = files.find((f) => f.startsWith("quarantine/store.json.") && f.endsWith(".corrupt"));
    expect(quarantined).toBeDefined();
    expect((await ask({ op: "raw", sid, name: quarantined! })).content).toBe("BAD{corrompu");
  });

  test.skipIf(skip)("sans sauvegarde, la corruption est isolée et la lecture rend null", async () => {
    const sid = (await ask({ op: "newDir" })).sid as number;

    await ask({ op: "writeRaw", sid, name: "store.json", content: "BAD{seul" });
    const read = await ask({ op: "read", sid, name: "store.json" });
    expect(read.value).toBeNull();
    // Plus de cible servie ; la copie corrompue reste inspectable.
    expect((await ask({ op: "raw", sid, name: "store.json" })).exists).toBe(false);
    const files = (await ask({ op: "files", sid })).files as string[];
    const quarantined = files.find((f) => f.startsWith("quarantine/store.json.") && f.endsWith(".corrupt"));
    expect(quarantined).toBeDefined();
    expect((await ask({ op: "raw", sid, name: quarantined! })).content).toBe("BAD{seul");
  });
});
