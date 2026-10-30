import { expect, test } from "bun:test";
import { ask, canonTs, ktLogin, portError, skip, startStub, tsCanon, tsErrorOfAsync, tsLogin } from "../fixtures/pronote-client";
import type { Stub } from "../fixtures/pronote-client";

export function registerClientFlow(): void {
  test.skipIf(skip)("post : `G=10` rejoue handshake + retry, `G=22` remonte sans rejeu", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const arm = (s: typeof tsa) => {
        s.script.nextEnvelope = { Erreur: { G: 10, Titre: "expire" } };
      };
      arm(tsa);
      const tsRes = await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      arm(kta);
      const ktRes = await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } });
      // Un second handshake (FP) a eu lieu des deux côtés, puis le retry a abouti.
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      for (const stub of [tsa, kta]) {
        const uuids = stub.posts
          .filter((p) => p.id === "FonctionParametres")
          .map((p) => ((p.inner as { data: { Uuid: string } }).data.Uuid));
        expect(new Set(uuids).size).toBe(2);
      }
      expect(canonTs(JSON.parse(ktRes))).toBe(tsCanon(tsRes));

      // `G=22` : pas de rejeu, `ExpiredObject` direct.
      tsa.script.nextEnvelope = { Erreur: { G: 22, Titre: "mort" } };
      kta.script.nextEnvelope = { Erreur: { G: 22, Titre: "mort" } };
      let tsName = "";
      let tsMsg = "";
      try {
        await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      } catch (e) {
        tsName = (e as Error).name;
        tsMsg = (e as Error).message;
      }
      const ktErr = portError(await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } }, true));
      expect(tsName).toBe("ExpiredObject");
      expect(ktErr).toEqual({ name: tsName, message: tsMsg });
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);

      // `G` inconnu UNE fois : `refresh` + retry qui aboutit — aucune erreur ne
      // remonte (le retry est brut, son résultat fait foi). Refresh prouvé par
      // les handshakes, succès identiques ensuite.
      tsa.script.nextEnvelope = { Erreur: { G: 99, Titre: "Bizarre" } };
      kta.script.nextEnvelope = { Erreur: { G: 99, Titre: "Bizarre" } };
      const ts99 = await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      const kt99 = JSON.parse(await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } }));
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(3);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(3);
      expect(canonTs(kt99)).toBe(tsCanon(ts99));

      // HTTP 500 UNE fois : même scénario (refresh + retry + succès identique).
      tsa.script.nextPostStatus = { status: 500, body: "oops" };
      kta.script.nextPostStatus = { status: 500, body: "oops" };
      const ts500 = await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      const kt500 = JSON.parse(await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } }));
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(4);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(4);
      expect(canonTs(kt500)).toBe(tsCanon(ts500));

      // JSON cassé : les deux jettent (classes brutes différentes, fait assumé).
      tsa.script.nextRaw = "pas du json{";
      kta.script.nextRaw = "pas du json{";
      const tsBad = await tsErrorOfAsync(() => tsClient.post("TestEcho", 7, { data: { a: 1 } }));
      const ktBad = portError(await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } }, true));
      expect(tsBad?.name).toBe("SyntaxError");
      expect(ktBad.name).toBe("JsonError");
    } finally {
      tsa.close();
      kta.close();
    }
  });

  // #405 : le rafraîchissement est ATOMIQUE.
  //
  // `ClientBase._refreshing` était un `var Boolean` nu : le job de fond
  // (`PeriodicSyncWorker`) et la lecture de l'interface tombant en erreur en
  // MÊME temps, les deux lisaient `false` et déclenchaient DEUX
  // rafraîchissements — deux `Communication` (deux cookies, deux compteurs de
  // requêtes), le champ finissant sur celle qui avait fini la dernière, les
  // requêtes entrelacées (clé AES mélangée) : le serveur répondait `G=25`
  // « Exceeded max authorization requests » ou la session restait à moitié
  // initialisée.
  //
  // La référence TS est MONO-THREAD (`await` : la session est rafraîchie
  // avant le retour), donc la parité à prouver est COMPORTEMENTALE : le port
  // fait les MÊMES requêtes, dans le MÊME ordre, et UN SEUL rafraîchissement.

  test.skipIf(skip)("refresh concurrent : UN SEUL refresh, les deux fils réussissent (#405)", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);

      // Session fermée par l'établissement : elle rouvre au handshake suivant
      // (le refresh). La référence TS poste DEUX fois (la première déclenche
      // le refresh, la seconde passe sur la session neuve) ; le port poste
      // les MÊMES deux requêtes, mais CONCURRENTEMENT.
      tsa.script.deadUntilHandshake = true;
      kta.script.deadUntilHandshake = true;

      const ts1 = await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      const ts2 = await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      const ktRes = JSON.parse(await ask({
        op: "clientConcurrentPost",
        cid: ktCid,
        function: "TestEcho",
        onglet: 7,
        threads: 2,
        data: { data: { a: 1 } },
      })) as { results: string[]; payloads: string[] };

      // Les DEUX fils réussissent : le perdant de la course ATTEND le
      // rafraîchissement et rejoue sa requête sur la session neuve (au lieu
      // de remonter l'erreur à l'appelant).
      expect(ktRes.results).toEqual(["ok", "ok"]);

      // UN SEUL rafraîchissement : deux handshakes en tout (login + refresh),
      // pas trois — deux refreshs = deux `Communication` = le bug.
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      // Une seule nouvelle `Communication` : une seule re-poignée de main.
      expect(kta.gets).toBe(2);
      expect(tsa.gets).toBe(2);

      // PARITÉ : le FIL de requêtes est celui de la référence — mêmes
      // fonctions, dans le même ordre (handshake, login, refresh, rejeu).
      const fil = (stub: Stub): string[] => stub.posts.map((p) => p.id);
      expect(fil(kta)).toEqual(fil(tsa));
      // Et les RÉPONSES sont identiques des deux côtés.
      for (const payload of ktRes.payloads) {
        expect(canonTs(JSON.parse(payload))).toBe(tsCanon(ts1));
      }
      expect(tsCanon(ts2)).toBe(tsCanon(ts1));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  // #408 : la RELECTURE MANUELLE doit forcer un aller-retour.
  //
  // `Communication.post` rafraîchit `lastPing` à chaque POST réussi : juste
  // après une lecture, le seuil de 110 s n'est PAS atteint, donc
  // `pingIfDue()` ne partait JAMAIS — la relecture rendait `Updated` sans
  // rien vérifier de la session (une session morte passait pour vivante : ni
  // `DeviceAuth.reject()`, ni invite à ré-appairer).
  //
  // Le ping MANUEL (`KeepAlive.ping()`) force la requête. C'est une
  // EXTENSION du port (la référence n'a que le ping périodique), mais la
  // requête émise est CELLE de la référence — `post("Navigation", 7, { onglet:
  // 7, ongletPrec: 7 })` — et le fil est comparé des deux côtés.

  test.skipIf(skip)("keepAlive : le ping manuel force l'aller-retour (après une lecture) — #408", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);

      // Une LECTURE (les notes) : son POST rafraîchit `lastPing`.
      await ask({ op: "clientPost", cid: ktCid, function: "DernieresNotes", onglet: 198 });
      const ktAvant = kta.posts.length;
      expect(ktAvant).toBeGreaterThan(0);

      // Le ping « si dû » : AUCUNE requête (le bug #408 — la relecture ne
      // vérifiait rien de la session).
      await ask({ op: "clientPing", cid: ktCid, mode: "ifDue" });
      expect(kta.posts.length).toBe(ktAvant);

      // Le ping MANUEL : UN aller-retour — et UN SEUL.
      await ask({ op: "clientPing", cid: ktCid, mode: "manual" });
      expect(kta.posts.length).toBe(ktAvant + 1);
      const ktPing = kta.posts[ktAvant]!;
      expect(ktPing.id).toBe("Navigation");

      // PARITÉ : la requête est CELLE de la référence (même fonction, même
      // onglet, mêmes données) — le ping manuel n'est pas un protocole
      // différent, et le fil est OCTET-pour-octet le même des deux côtés.
      await tsClient.post("Navigation", 7, { onglet: 7, ongletPrec: 7 });
      const tsPing = tsa.posts[tsa.posts.length - 1]!;
      expect(tsPing.id).toBe("Navigation");
      expect(canonTs(ktPing.inner)).toBe(canonTs(tsPing.inner));
      expect(canonTs(ktPing.inner)).toBe(
        canonTs({ Signature: { onglet: 7 }, data: { onglet: 7, ongletPrec: 7 } }),
      );

      // Session MORTE : le ping manuel remonte l'ERREUR de session (elle
      // n'est pas avalée) — c'est ce que la couche data traduit en
      // ré-appairage (`isSessionFailure` → `DeviceAuth.reject()`).
      kta.script.deadSession = true;
      tsa.script.deadSession = true;
      const ktErr = portError(await ask({ op: "clientPing", cid: ktCid, mode: "manual" }, true));
      const tsErr = await tsErrorOfAsync(() => tsClient.post("Navigation", 7, { onglet: 7, ongletPrec: 7 }));
      expect(ktErr.name).toBe(tsErr?.name ?? "(aucune erreur)");
      expect(ktErr.message).toMatch(/session/i);
      expect(tsErr?.message ?? "").toMatch(/session/i);
    } finally {
      tsa.close();
      kta.close();
    }
  });
}
