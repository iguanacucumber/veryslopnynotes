// I10 : le QR scanné reste côté natif. Le JS ne reçoit qu'un handle opaque +
// un login masqué ; `pairing.pair` rend le handle contre le QR. Logique
// exécutée (QrHandle.kt) et câblage du pont épinglé par lecture des sources.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { readBridgeSource } from "./fixtures/bridge-source";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "QrHandleMain.kt");
const TYPES = join(ROOT, "web", "src", "bridge", "types.ts");
const SCREEN = join(ROOT, "web", "src", "features", "pairing", "PairingScreen.tsx");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

describe("QR scanné : handle opaque, jeton jamais au JS (#786)", () => {
  test.skipIf(skip)("le handle du dernier scan seul rend le QR", async () => {
    const qid = (await ask({ op: "new" })).qid;
    const premier = (await ask({ op: "remember", qid, qr: "premier" })).handle;
    expect(await ask({ op: "lookup", qid, handle: premier })).toEqual({ found: true, value: "premier" });

    // Un nouveau scan invalide l'ancien handle : un QR périmé ne réapparaît pas.
    const second = (await ask({ op: "remember", qid, qr: "second" })).handle;
    expect((await ask({ op: "lookup", qid, handle: premier })).found).toBe(false);
    expect(await ask({ op: "lookup", qid, handle: second })).toEqual({ found: true, value: "second" });

    // Handle vide ou inconnu : aucun QR.
    for (const handle of ["", "inconnu", "h1-1"]) {
      expect({ handle, found: (await ask({ op: "lookup", qid, handle })).found }).toEqual({ handle, found: false });
    }

    await ask({ op: "clear", qid });
    expect((await ask({ op: "lookup", qid, handle: second })).found).toBe(false);
  });

  test.skipIf(skip)("le login envoyé au JS est masqué", async () => {
    expect((await ask({ op: "mask", login: "a1b2c3" })).masked).toBe("a1…");
    for (const login of ["", "a", "ab"]) {
      expect({ login, masked: (await ask({ op: "mask", login })).masked }).toEqual({ login, masked: "…" });
    }
  });

  test("le pont n'envoie ni login ni jeton, et prend un handle", () => {
    const bridge = codeOnly(readBridgeSource());
    // Scan : handle + login masqué + adresse, rien d'autre.
    expect(bridge).toContain("qrHandles.remember(qr)");
    expect(bridge).toContain("maskLogin(qr.login)");
    expect(bridge).not.toContain('.put("jeton"');
    expect(bridge).not.toContain('.put("login", qr.login');
    // Appairage : le QR vient du handle, jamais du payload JS.
    expect(bridge).toContain('bounded(p.string("handle"), QrHandle.HANDLE_MAX_CHARS)');
    expect(bridge).toContain("qrHandles.lookup(handle)");
    expect(bridge).not.toContain("SchoolQr(\n            login = bounded");
    // Un appairage réussi (ou une déconnexion) efface le secret en mémoire.
    expect(bridge.match(/qrHandles\.clear\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);

    const types = codeOnly(readFileSync(TYPES, "utf8"));
    const params = types.slice(types.indexOf("export interface PairParams"), types.indexOf("export interface PairResult"));
    expect(params).toContain("handle: string");
    expect(params).toContain("pin: string");
    expect(params).not.toContain("jeton");

    const screen = readFileSync(SCREEN, "utf8");
    expect(screen).toContain("bridge.pair({ handle: qr.handle, pin: normalizePin(pin) })");
    expect(screen).not.toContain("qr.jeton");
  });
});
