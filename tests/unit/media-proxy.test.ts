// Tests media-proxy (issue #84). Mocks session Pronote : aucun réseau, aucun secret.
// Refs stables vérifiées : lesson-doc, lesson-content-file, homework-file.
import { describe, expect, test } from "bun:test";
import { downloadMedia, MediaProxyError } from "../../server/infrastructure/media-proxy";

function file(name: string, bytes: number[]) {
  return { name, data: async () => Buffer.from(bytes) };
}

function sessions() {
  return {
    requireClient: (_id: string) => ({
      homework: async () => [{ files: () => [file("devoir.pdf", [1, 2, 3])] }],
      lessons: async () => [
        {
          homeworkDocuments: [file("cours.pdf", [4, 5])],
          content: async () => ({ files: () => [file("piece.pdf", [6])] }),
        },
      ],
    }),
  };
}

describe("media-proxy", () => {
  test("refs stables téléchargent via session (I1 : pas d'URL directe)", async () => {
    const s = sessions();
    const hw = await downloadMedia(s, "acc-fake-1", "homework:0:file:0:fid");
    expect(hw.name).toBe("devoir.pdf");
    expect([...hw.bytes]).toEqual([1, 2, 3]);
    const doc = await downloadMedia(s, "acc-fake-1", "lesson:0:doc:0:fid");
    expect(doc.name).toBe("cours.pdf");
    expect([...doc.bytes]).toEqual([4, 5]);
    const cf = await downloadMedia(s, "acc-fake-1", "lesson:0:content-file:0:fid");
    expect(cf.name).toBe("piece.pdf");
    expect([...cf.bytes]).toEqual([6]);
  });

  test("bad_ref / not_found / session_expired typées sans secret", async () => {
    const s = sessions();
    for (const bad of ["", "nope", "lesson:x:doc:0:", "homework:0:file:99:fid", "lesson:9:doc:0:fid"]) {
      const err = await downloadMedia(s, "acc-fake-1", bad).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MediaProxyError);
      expect(["bad_ref", "not_found"]).toContain((err as MediaProxyError).code);
    }
    const noSession = { requireClient: (_id: string) => { throw new Error("session expired"); } };
    const errS = await downloadMedia(noSession, "acc-fake-1", "homework:0:file:0:fid").catch((e: unknown) => e);
    expect((errS as MediaProxyError).code).toBe("session_expired");
    const errA = await downloadMedia(s, "  ", "homework:0:file:0:fid").catch((e: unknown) => e);
    expect((errA as MediaProxyError).code).toBe("bad_ref");
  });
});
