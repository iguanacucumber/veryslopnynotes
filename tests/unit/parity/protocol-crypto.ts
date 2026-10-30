import { expect, test } from "bun:test";
import { Encryption, IV1_HEX, K0_HEX, RSA_E_DEC, RSA_N_DEC, TEMP_HEX, ask, canonTs, checkRsaHeader, enBytes, expectKt, md5, modPow, portError, prepareOnglets, sha256HexUpper, skip, tsAesEncrypt, tsErrorOf, tsParseHtml } from "../fixtures/pronote-protocol";

export function registerProtocolCrypto(): void {
  test.skipIf(skip)("crypto : MD5 et SHA-256 sur vecteurs (vide, ASCII, unicode, long)", async () => {
    for (const hex of ["", "00", "ff", "00112233445566778899aabbccddeeff"]) {
      const data = Buffer.from(hex, "hex");
      const kt = await ask({ op: "md5", dataHex: hex });
      expect(kt).toBe(JSON.stringify({ hex: md5(data).toString("hex") }));
    }
    for (const text of ["", "abc", "mot de passe", "Éléonore — 妥当性", "x".repeat(1000)]) {
      const kt = await ask({ op: "sha256", text });
      expect(kt).toBe(JSON.stringify({ hex: sha256HexUpper(text) }));
    }
  });

  test.skipIf(skip)("crypto : AES déterministe à clé/IV fixés + déchiffrement croisé", async () => {
    const plains = ["", "00", "0011223344556677", "001122334455667788", "ff".repeat(64)];
    for (const dataHex of plains) {
      const data = Buffer.from(dataHex, "hex");
      const tsEnc = new Encryption();
      tsEnc.aesKey = Buffer.from(K0_HEX, "hex");
      tsEnc.aesIv = Buffer.from(IV1_HEX, "hex");
      const tsCipher = tsEnc.aesEncrypt(data).toString("hex");
      const kt = (JSON.parse(await ask({ op: "aes", keyHex: K0_HEX, ivHex: IV1_HEX, dataHex, mode: "encrypt" })) as { hex: string }).hex;
      expect(`${dataHex} -> ${kt}`).toBe(`${dataHex} -> ${tsCipher}`);
      // Déchiffrement croisé dans les deux sens.
      const ktDec = (JSON.parse(await ask({ op: "aes", keyHex: K0_HEX, ivHex: IV1_HEX, dataHex: tsCipher, mode: "decrypt" })) as { hex: string }).hex;
      expect(ktDec).toBe(dataHex);
      expect(tsEnc.aesDecrypt(Buffer.from(kt, "hex")).toString("hex")).toBe(dataHex);
    }
    // Mauvaise clé : les deux hurlent `CryptoError` au même message.
    const badHex = tsAesEncrypt(K0_HEX, IV1_HEX, Buffer.from("0011223344556677", "hex")).toString("hex");
    const ktBad = portError(await ask({ op: "aes", keyHex: "ff".repeat(16), ivHex: IV1_HEX, dataHex: badHex, mode: "decrypt" }, true));
    const tsEnc = new Encryption();
    tsEnc.aesKey = Buffer.from("ff".repeat(16), "hex");
    tsEnc.aesIv = Buffer.from(IV1_HEX, "hex");
    const tsBad = tsErrorOf(() => tsEnc.aesDecrypt(Buffer.from(badHex, "hex")));
    expect(tsBad?.name).toBe("CryptoError");
    expect(ktBad).toEqual({ name: "CryptoError", message: tsBad?.message ?? "" });
  });

  test.skipIf(skip)("crypto : défauts (md5(vide), IV zéros) + IV dérivé du temporaire", async () => {
    const kt = await ask({ op: "aesDefaults", dataHex: "00112233", mode: "encrypt" });
    const tsEnc = new Encryption();
    expect(kt).toBe(JSON.stringify({ hex: tsEnc.aesEncrypt(Buffer.from("00112233", "hex")).toString("hex") }));
    const ktIv = await ask({ op: "aesSetIvNull", tempHex: TEMP_HEX });
    const tsEnc2 = new Encryption();
    tsEnc2.aesIvTemp = Buffer.from(TEMP_HEX, "hex");
    tsEnc2.aesSetIv();
    expect(ktIv).toBe(JSON.stringify({ iv: tsEnc2.aesIv.toString("hex") }));
    expect(JSON.parse(ktIv)).toEqual({ iv: IV1_HEX });
  });

  test.skipIf(skip)("crypto : RSA-1024 PKCS#1 v1.5 sous la clé codée en dur (en-tête + constantes)", async () => {
    // Les constantes arrivent intactes des deux côtés (bourrage aléatoire oblige).
    const ktKey = JSON.parse(await ask({ op: "rsaKey" })) as { n: string; e: string };
    expect(ktKey).toEqual({ n: RSA_N_DEC, e: RSA_E_DEC });
    // Exponentiation revérifiée indépendamment sur un bloc EM déterministe.
    const data = Buffer.from("00112233", "hex");
    const em = Buffer.concat([Buffer.from([0x00, 0x02]), Buffer.alloc(128 - 3 - data.length, 0xff), Buffer.from([0x00]), data]);
    const expected = modPow(BigInt(`0x${em.toString("hex")}`), BigInt(RSA_E_DEC), BigInt(RSA_N_DEC));
    const ktRaw = (JSON.parse(await ask({ op: "rsaNoPad", emHex: em.toString("hex") })) as { hex: string }).hex;
    expect(BigInt(`0x${ktRaw}`)).toBe(expected);
    for (const dataHex of ["00", "00112233", "ff".repeat(32)]) {
      const ktCipher = (JSON.parse(await ask({ op: "rsa", dataHex })) as { hex: string }).hex;
      checkRsaHeader(ktCipher, `port ${dataHex}`);
      // La référence passe le même contrôle (sanity : le contrôle contrôle).
      checkRsaHeader(new Encryption().rsaEncrypt(Buffer.from(dataHex, "hex")).toString("hex"), `ref ${dataHex}`);
    }
  });

  test.skipIf(skip)("pures : enBytes, prepareOnglets", async () => {
    for (const text of ["", "72,105", "300", "abc", "12abc", "-1", " 7 , 8 ", "1,2,3,4,5"]) {
      expect(await ask({ op: "enBytes", text })).toBe(JSON.stringify({ hex: enBytes(text).toString("hex") }));
    }
    const ongletCases: unknown[] = [7, [1, [2, 3], { a: 4, b: [5] }], "texte", null, [], [{ x: 1 }, "ignoré", true, null, 9]];
    for (const value of ongletCases) {
      expect(await ask({ op: "prepareOnglets", value })).toBe(canonTs({ value: prepareOnglets(value as never) }));
    }
  });

  test.skipIf(skip)("parseHtml : attributs, IP banni, page inattendue, `h` manquant", async () => {
    const valid = `<html><body onload="Start({h: '123456', a: 'abcdef', CrA: '1', CoA: '0', http: ''})"></body></html>`;
    await expectKt({ op: "parseHtml", html: valid }, { ok: true, attrs: tsParseHtml(valid) }, "parseHtml");
    // Espaces et guillemets doubles : même lecture.
    const spaced = `Start({ h : "42" , a : "z" })`;
    await expectKt({ op: "parseHtml", html: spaced }, { ok: true, attrs: tsParseHtml(spaced) }, "parseHtml-espaces");
    // Refus : IP, page sans Start, `h` absent — les deux jettent (classes non
    // contractuelles ici : seul le contrôle compte, `initialise` réessaie).
    for (const html of ["IP bannie 1.2.3.4", "<html></html>", "Start({a: 'x'})"]) {
      const kt = JSON.parse(await ask({ op: "parseHtml", html }, true)) as { ok: boolean };
      expect(`${html} -> ${kt.ok}`).toBe(`${html} -> false`);
      expect(tsErrorOf(() => tsParseHtml(html)) !== null).toBe(true);
    }
  });
}
