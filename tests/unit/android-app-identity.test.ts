// L'empreinte du certificat installé est calculée par le VRAI Kotlin, exécuté
// via le harnais : le format SHA-256 majuscule séparé par `:` ne peut pas
// dériver d'un miroir TS. Outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "AppIdentityMain.kt");
const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

function sha256Colon(bytes: Buffer): string {
  return (
    createHash("sha256")
      .update(bytes)
      .digest("hex")
      .toUpperCase()
      .match(/../g) ?? []
  ).join(":");
}

async function fingerprint(bytes: Buffer): Promise<string> {
  const res = JSON.parse(
    await link!.ask({ op: "fingerprint", derHex: bytes.toString("hex") }),
  ) as { fingerprint: string };
  return res.fingerprint;
}

describe("empreinte du certificat (#944)", () => {
  test.skipIf(skip)("le format SHA-256 est celui d'apksigner (majuscules, deux-points)", async () => {
    // Vecteur public SHA-256("abc"), recalculé par Node : le format seul est
    // comparé, le certificat réel restant lu par PackageManager sur l'appareil.
    const expected = sha256Colon(Buffer.from("abc"));
    expect(expected).toBe(
      "BA:78:16:BF:8F:01:CF:EA:41:41:40:DE:5D:AE:22:23:B0:03:61:A3:96:17:7A:9C:B4:10:FF:61:F2:00:15:AD",
    );
    expect(await fingerprint(Buffer.from("abc"))).toBe(expected);
  });

  test.skipIf(skip)("les octets signés (0x80–0xFF) ne changent pas de représentation", async () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
    expect(await fingerprint(bytes)).toBe(sha256Colon(bytes));
  });

  test.skipIf(skip)("une entrée vide rend une empreinte, jamais une chaîne vide", async () => {
    expect(await fingerprint(Buffer.alloc(0))).toBe(sha256Colon(Buffer.alloc(0)));
  });
});
