// #894 : la purge du DOM storage garde l'apparence et efface TOUT le reste.
// Le script vient du VRAI Kotlin (harnais de parité) et il est EXÉCUTÉ sur un
// `localStorage`/`sessionStorage` factices : aucune relecture de sa forme.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "WebViewAccountStorageMain.kt");

const skip = parityToolchain.skipReason !== null;
let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

interface Script {
  script: string;
  appearance: string[];
}

async function script(keep?: string[]): Promise<Script> {
  return JSON.parse(await link!.ask({ op: "script", keep })) as Script;
}

function memoryStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
    snapshot(): Record<string, string> {
      return Object.fromEntries(values);
    },
  };
}

function run(source: string, local: ReturnType<typeof memoryStorage>, session = memoryStorage({})) {
  return new Function("localStorage", "sessionStorage", `return ${source}`)(local, session) as string;
}

describe("purge du DOM storage de la WebView (#894)", () => {
  test.skipIf(skip)("la liste blanche d'apparence est celle du web", async () => {
    expect((await script()).appearance).toEqual(["vsn:theme", "vsn:scheme"]);
  });

  test.skipIf(skip)("bascule de compte : les identifiants lus partent, le thème reste", async () => {
    const { script: source } = await script();
    const local = memoryStorage({
      "vsn:theme": "DARK",
      "vsn:scheme": "aero",
      "vsn:news:read": JSON.stringify(["n1", "n2"]),
      "vsn:account:autre": "donnée du compte",
    });
    const session = memoryStorage({ "vsn:temp": "en cours" });

    expect(run(source, local, session)).toBe("ok");
    expect(local.snapshot()).toEqual({ "vsn:theme": "DARK", "vsn:scheme": "aero" });
    expect(session.snapshot()).toEqual({});
  });

  test.skipIf(skip)("toute clé inconnue part : pas de liste noire à maintenir", async () => {
    const { script: source } = await script();
    const local = memoryStorage({ "vsn:futur": "identifiant", "vsn:theme": "LIGHT" });
    run(source, local);
    expect(local.snapshot()).toEqual({ "vsn:theme": "LIGHT" });
  });

  test.skipIf(skip)("une liste vide retire même l'apparence (le script n'est pas codé en dur)", async () => {
    const { script: source } = await script([]);
    const local = memoryStorage({ "vsn:theme": "DARK", "vsn:news:read": "[]" });
    run(source, local);
    expect(local.snapshot()).toEqual({});
  });

  test.skipIf(skip)("un stockage indisponible rend « ko », sans exception", async () => {
    const { script: source } = await script();
    const broken = new Proxy(
      {},
      {
        get() {
          throw new Error("stockage indisponible");
        },
      },
    );
    expect(run(source, broken as never)).toBe("ko");
  });
});
