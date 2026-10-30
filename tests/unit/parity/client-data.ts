import { expect, test } from "bun:test";
import { ask, canonTs, checkMagic, flatGrade, flatMessage, ktLogin, normMagicUrl, portError, richScript, skip, startStub, tsCanon, tsLogin, tsStateOf } from "../fixtures/pronote-client";
import type { RecordedPost } from "../fixtures/pronote-client";

export function registerClientData(): void {
  test.skipIf(skip)("trimestre : notes, moyennes, bulletin, vie scolaire", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      tsa.script.notes = tsa.script.notes ?? {};
      kta.script.notes = kta.script.notes ?? {};
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsPeriod = (tsClient.periods as unknown[]).find((p) => (p as { id: string }).id === "t1-p-1") as {
        grades(): Promise<unknown[]>; averages(): Promise<unknown[]>; overallAverage(): Promise<unknown>;
        absences(): Promise<unknown[]>; delays(): Promise<unknown[]>; punishments(): Promise<unknown[]>;
      };

      const tsGrades = (await tsPeriod.grades()) as Record<string, unknown>[];
      const ktGrades = JSON.parse(await ask({ op: "periodGrades", cid: ktCid, periodId: "t1-p-1" }));
      expect(canonTs(ktGrades)).toBe(tsCanon(tsGrades.map(flatGrade)));

      const tsAvg = await tsPeriod.averages();
      const ktAvg = JSON.parse(await ask({ op: "periodAverages", cid: ktCid, periodId: "t1-p-1" }));
      // `subject` est une instance plate (pas de cycle) : le canonique suffit.
      expect(canonTs(ktAvg)).toBe(tsCanon(tsAvg));

      const tsOverall = await tsPeriod.overallAverage();
      const ktOverall = JSON.parse(await ask({ op: "periodOverall", cid: ktCid, periodId: "t1-p-1" }));
      expect(canonTs(ktOverall)).toBe(canonTs(tsOverall));

      for (const [op, fn] of [["periodAbsences", "absences"], ["periodDelays", "delays"], ["periodPunishments", "punishments"]] as const) {
        const tsList = await (tsPeriod[fn]());
        const ktList = JSON.parse(await ask({ op, cid: ktCid, periodId: "t1-p-1" }));
        expect(`${op} -> ${canonTs(ktList)}`).toBe(`${op} -> ${tsCanon(tsList)}`);
      }
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("cours : EDT fenêtré, repli fin de cours, contenus + fichiers", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const from = new Date(2026, 8, 20);
      const to = new Date(2026, 8, 27);
      const tsLessons = await tsClient.lessons(from, to);
      const ktLessons = JSON.parse(
        await ask({ op: "lessons", cid: ktCid, from: "2026-09-20T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z" }),
      );
      // `l-2` (fin absente, repli `ListeHeuresFin`) est dedans. 4 cours, pas 2 :
      // la fenêtre couvre 2 semaines et le stub répond pareil par semaine (en réel
      // chaque semaine a ses cours) — les deux côtés s'accordent sur les 4.
      expect(canonTs(ktLessons)).toBe(tsCanon(tsLessons));
      expect((ktLessons as unknown[]).length).toBe(4);

      // Contenu + fichiers du premier cours.
      const tsContent = await (tsLessons[0] as { content(): Promise<unknown> }).content();
      const ktContent = JSON.parse(
        await ask({ op: "lessonContent", cid: ktCid, lessonId: "t2-l-1", from: "2026-09-20T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z" }),
      );
      expect(canonTs(ktContent)).toBe(tsCanon(tsContent));

      // Cours sans contenu : `null` des deux côtés.
      const tsEmpty = await (tsLessons[1] as { content(): Promise<unknown> }).content();
      const ktEmpty = JSON.parse(
        await ask({ op: "lessonContent", cid: ktCid, lessonId: "t2-l-2", from: "2026-09-20T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z" }),
      );
      expect(tsEmpty).toBeNull();
      expect(ktEmpty).toBeNull();
    } finally {
      tsa.close();
      kta.close();
    }
  });

  // #417 : le contenu du cours court-circuite comme la référence — `listeContenus`
  // n'est lu QUE pour le cours demandé. Avant, une entrée SANS `listeContenus`
  // (un cours d'un autre jour) jetait et PERDAIT tout le bloc « Contenu de cours ».

  test.skipIf(skip)("cours : contenu court-circuité (entrée sans `listeContenus`)", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const contenu = {
        cours: { V: { N: "t2-l-1" } },
        listeContenus: {
          V: [
            { L: "Fractions", descriptif: { V: "<p>Exercices</p>" }, categorie: { V: { L: "Cours" } }, ListePieceJointe: { V: [] } },
          ],
        },
      };
      // PAS de `listeContenus` — et ce n'est PAS le cours demandé.
      const sansListe = { cours: { V: { N: "t2-l-2" } } };
      for (const s of [tsa.script, kta.script]) s.lessonContent = [sansListe, contenu];
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const from = new Date(2026, 8, 20);
      const to = new Date(2026, 8, 27);
      const tsLessons = await tsClient.lessons(from, to);
      const tsContent = await (tsLessons[0] as { content(): Promise<unknown> }).content();
      const ktContent = JSON.parse(
        await ask({ op: "lessonContent", cid: ktCid, lessonId: "t2-l-1", from: "2026-09-20T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z" }),
      );
      expect(canonTs(ktContent)).toBe(tsCanon(tsContent));
      // Le contenu est bien celui du cours demandé (pas `null`, pas une erreur).
      expect((ktContent as { title: string }).title).toBe("Fractions");
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("devoirs : fenêtre, bascule fait, URL magique + octets", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const from = new Date(2026, 8, 20);
      const to = new Date(2026, 8, 30);
      // `h-2` (2020, fait) est hors fenêtre : un seul devoir.
      const tsHw = await tsClient.homework(from, to);
      const ktHw = JSON.parse(
        await ask({ op: "homework", cid: ktCid, from: "2026-09-20T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" }),
      );
      expect((ktHw as unknown[]).length).toBe(1);
      expect(canonTs(ktHw)).toBe(tsCanon(tsHw));

      // Bascule : le serveur voit le même `SaisieTAFFaitEleve` des deux côtés.
      await (tsHw[0] as { setDone(b: boolean): Promise<void> }).setDone(true);
      const ktDone = JSON.parse(
        await ask({ op: "hwSetDone", cid: ktCid, hwId: "t2-h-1", from: "2026-09-20T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z", done: true }),
      );
      expect(ktDone).toEqual({ done: true });
      const tsToggle = tsa.posts.filter((p) => p.id === "SaisieTAFFaitEleve").map((p) => p.inner);
      const ktToggle = kta.posts.filter((p) => p.id === "SaisieTAFFaitEleve").map((p) => p.inner);
      expect(canonTs(ktToggle)).toBe(canonTs(tsToggle));

      // Pièce jointe : URL magique AES identique (clé de session commune) + octets.
      const tsFiles = await (tsHw[0] as { files(): Array<{ url: string; name: string; data(): Promise<Buffer> }> }).files();
      const ktAtt = JSON.parse(
        await ask({ op: "attachmentProbe", cid: ktCid, from: "2026-09-20T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" }),
      ) as { url: string; dataHex: string; name: string };
      const [tsFile] = tsFiles;
      if (tsFile === undefined) throw new Error("pièce jointe TS absente");
      const tsUrl = tsFile.url;
      checkMagic(tsa, tsUrl, "t2-f-2");
      checkMagic(kta, ktAtt.url, "t2-f-2");
      expect(normMagicUrl(ktAtt.url)).toBe(normMagicUrl(tsUrl));
      expect(ktAtt.name).toBe(tsFile.name);
      expect(ktAtt.dataHex).toBe((await tsFile.data()).toString("hex"));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("messagerie : liste filtrée, fil chaîné, reply/markAs/delete/participants", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      // `d-2` (pas une discussion) et `d-3` (profondeur 1) filtrées : une seule.
      const tsList = await tsClient.discussions();
      const ktList = JSON.parse(await ask({ op: "discussions", cid: ktCid }));
      expect((ktList as unknown[]).length).toBe(1);
      expect(canonTs(ktList)).toBe(tsCanon(tsList));
      // `onlyUnread` : même filtre ET mêmes objets (`d-1` a `nbNonLus: 2`).
      const tsUnread = await tsClient.discussions(true);
      const ktUnread = JSON.parse(await ask({ op: "discussions", cid: ktCid, onlyUnread: true }));
      expect((ktUnread as unknown[]).length).toBe(1);
      expect(canonTs(ktUnread)).toBe(tsCanon(tsUnread));

      // Fil complet : chaînage `m-2 -> m-1 -> null(m-0 inconnu)`, auteur null si émetteur.
      const tsD = tsList[0] as unknown as {
        messages(): Promise<Record<string, unknown>[]>;
        reply(m: string): Promise<void>; markAs(b: boolean): Promise<void>;
        participants(): Promise<unknown[]>; delete(): Promise<void>; id: string;
      };
      const tsMessages = (await tsD.messages()).map(flatMessage);
      const ktFlow = JSON.parse(await ask({ op: "discussionFlow", cid: ktCid, discussionId: "t2-d-1", text: "Bien reçu" })) as {
        messages: unknown[]; participants: unknown[];
      };
      expect(canonTs(ktFlow.messages)).toBe(tsCanon(tsMessages));
      await tsD.reply("Bien reçu");
      await tsD.markAs(true);
      const tsParts = await tsD.participants();
      await tsD.delete();
      expect(canonTs(ktFlow.participants)).toBe(tsCanon(tsParts));
      // Les écritures vues par le serveur sont identiques (SaisieMessage ×3 + public).
      const sig = (posts: RecordedPost[]) =>
        posts.filter((p) => ["SaisieMessage", "SaisiePublicMessage", "ListeMessages"].includes(p.id)).map((p) => ({ id: p.id, inner: p.inner }));
      expect(canonTs(sig(kta.posts))).toBe(canonTs(sig(tsa.posts)));

      // Destinataires du premier message.
      const tsMsgs = await tsD.messages();
      const tsFirst = tsMsgs[0] as unknown as { recipients(): Promise<unknown[]> };
      const tsRecips = await tsFirst.recipients();
      const ktRecips = JSON.parse(await ask({ op: "messageRecipients", cid: ktCid, discussionId: "t2-d-1", messageId: "t2-m-1" }));
      expect(canonTs(ktRecips)).toBe(tsCanon(tsRecips));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("messagerie : destinataires + nouvelle discussion", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsR = await tsClient.getRecipients();
      const ktR = JSON.parse(await ask({ op: "getRecipients", cid: ktCid }));
      // `teacher` (G=3, fonctions) + `staff` (G=7→staff, `[fonction]`).
      expect(canonTs(ktR)).toBe(tsCanon(tsR));
      // Le prof écrit en premier (G:3 avant G:34), `type`/`functions` portés.
      expect((ktR as Array<{ type: string }>)?.map((r) => r.type)).toEqual(["teacher", "staff"]);

      await tsClient.newDiscussion("Sujet", "Bonjour", [tsR[0] as never]);
      const ktSent = JSON.parse(await ask({ op: "newDiscussion", cid: ktCid, subject: "Sujet", body: "Bonjour", to: ["t2-r-1"] })) as { sent: number };
      expect(ktSent).toEqual({ sent: 1 });
      const payload = (posts: RecordedPost[]) => posts.filter((p) => p.id === "SaisieMessage").map((p) => p.inner);
      expect(canonTs(payload(kta.posts))).toBe(canonTs(payload(tsa.posts)));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("actus : liste, filtres, contenu + pièces jointes", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsNews = await tsClient.informationAndSurveys();
      const ktNews = JSON.parse(await ask({ op: "news", cid: ktCid }));
      expect((ktNews as unknown[]).length).toBe(2);
      expect(canonTs(ktNews)).toBe(tsCanon(tsNews));
      // `onlyUnread` : `n-2` (lue) écartée.
      const tsUnread = await tsClient.informationAndSurveys({ onlyUnread: true });
      const ktUnread = JSON.parse(await ask({ op: "news", cid: ktCid, onlyUnread: true }));
      expect((ktUnread as unknown[]).length).toBe(1);
      expect(canonTs(ktUnread)).toBe(tsCanon(tsUnread));
      // Fenêtre sur `startDate` présent (`n-2` sans `startDate` : écartée).
      const tsWindow = await tsClient.informationAndSurveys({ dateFrom: new Date(2026, 8, 10), dateTo: new Date(2026, 8, 12) });
      const ktWindow = JSON.parse(
        await ask({ op: "news", cid: ktCid, dateFrom: "2026-09-10T00:00:00.000Z", dateTo: "2026-09-12T00:00:00.000Z" }),
      );
      expect((ktWindow as unknown[]).length).toBe(1);
      expect(canonTs(ktWindow)).toBe(tsCanon(tsWindow));

      const tsN = tsNews[0] as { content(): Promise<string>; attachments(): Promise<unknown[]> };
      const ktN = JSON.parse(await ask({ op: "newsContent", cid: ktCid, newsId: "t2-n-1" })) as { content: string; attachments: unknown[] };
      expect(ktN.content).toBe(await tsN.content());
      const normUrlsArr = (j: string): string =>
        j.replace(/\/FichiersExternes\/[0-9A-Fa-f]+\//g, "/FichiersExternes/MAGIC/").replace(/:\d+\//g, ":PORT/");
      expect(normUrlsArr(canonTs(ktN.attachments))).toBe(normUrlsArr(tsCanon(await tsN.attachments())));
      // La pièce jointe a le bon magic des deux côtés.
      const tsAtt = ((await tsN.attachments()) as Array<{ url: string }>)[0];
      if (tsAtt) checkMagic(tsa, tsAtt.url, "t2-f-3");
      const ktAtt = (ktN.attachments as Array<{ url: string }>)[0];
      if (ktAtt) checkMagic(kta, ktAtt.url, "t2-f-3");
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("cantine : semaines balayées, plats, `Date` injectée, filtre fenêtre", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsMenus = await tsClient.menus(new Date(2026, 8, 21), new Date(2026, 8, 21));
      const ktMenus = JSON.parse(
        await ask({ op: "menus", cid: ktCid, from: "2026-09-21T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" }),
      );
      expect((ktMenus as unknown[]).length).toBe(3);
      expect(canonTs(ktMenus)).toBe(tsCanon(tsMenus));
      // `G=0` déjeuner, `G=1` dîner, fromage/dessert au bon index (5/4).
      const dinner = (ktMenus as Array<{ isLunch: boolean; isDinner: boolean }>)[1];
      expect(dinner).toMatchObject({ isLunch: false, isDinner: true });
      // `G: null` = déjeuner (`Number(null) == 0`), sans slot (L11).
      const gouter = (ktMenus as Array<{ isLunch: boolean; isDinner: boolean }>)[2];
      expect(gouter).toMatchObject({ isLunch: true, isDinner: false });
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("profil : identité, photo, `cache()` + semaine + creds ENT", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsInfo = tsClient.info as unknown as Record<string, unknown>;
      const ktInfo = JSON.parse(await ask({ op: "clientInfo", cid: ktCid })) as { info: unknown; cache: unknown };
      const tsRendered = {
        info: {
          id: tsInfo.id, name: tsInfo.name, className: (tsInfo as Record<string, unknown>).className,
          establishment: (tsInfo as Record<string, unknown>).establishment,
          delegue: (tsInfo as Record<string, unknown>).delegue,
          profilePicture: (() => {
            const p = (tsInfo as Record<string, { url: string; name: string; id: string; type: number }>).profilePicture;
            return p ? { url: p.url, name: p.name, id: p.id, type: p.type } : null;
          })(),
        },
        cache: await (tsInfo as unknown as { cache(): Promise<unknown> }).cache(),
      };
      // URLs magiques + ports normalisés (IV et stubs par-côté, prouvés par ailleurs).
      const normUrls = (j: string): string =>
        j.replace(/\/FichiersExternes\/[0-9A-Fa-f]+\//g, "/FichiersExternes/MAGIC/").replace(/:\d+\//g, ":PORT/");
      const ktInfoStr = normUrls(canonTs(ktInfo));
      const tsInfoStr = normUrls(tsCanon(tsRendered));
      expect(ktInfoStr).toBe(tsInfoStr);
      // La photo a le bon magic des deux côtés (payload `{N: res-1}`).
      const tsPhoto = ((tsRendered as Record<string, unknown>).info as Record<string, { url: string }>).profilePicture;
      const ktPhoto = (ktInfo as { info: { profilePicture: { url: string } } }).info.profilePicture;
      if (tsPhoto) checkMagic(tsa, tsPhoto.url, "res-1");
      if (ktPhoto) checkMagic(kta, ktPhoto.url, "res-1");

      // `getWeek` : semaine 1 le lundi de `PremierLundi`, avant = négatif (floor, pas troncature).
      for (const iso of ["2026-09-07T00:00:00.000Z", "2026-09-13T00:00:00.000Z", "2026-09-14T00:00:00.000Z", "2026-08-30T00:00:00.000Z"]) {
        const kt = JSON.parse(await ask({ op: "getWeek", cid: ktCid, date: iso })) as { week: number };
        const ts = tsClient.getWeek(new Date(iso));
        expect(`${iso} -> ${kt.week}`).toBe(`${iso} -> ${ts}`);
      }
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("login mot de passe + ENT (branches `sha256` et cookies)", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      // ENT : `e`/`f` lus dans la page (`htmlExtra`), `pourENT: true`, clé
      // `md5(sha256(pass))` — `uuidAppliMobile` reste vide (pas mobile).
      for (const stub of [tsa, kta]) {
        stub.htmlExtra = `e: 'entuser', f: 'entpass'`;
        stub.password = "entpass";
        stub.script.securisation = 0;
      }
      const entTs = async () => {
        const { CookieJar } = await import("tough-cookie");
        return new CookieJar();
      };
      const { Client: C } = await import("pronotets");
      const tsClient = await C.login(`${tsa.base}/pronote/eleve.html`, "nimporte", "entpass", { ent: entTs as never });
      const ktCid = Number(
        JSON.parse(await ask({ op: "clientLogin", site: `${kta.base}/pronote/eleve.html`, username: "nimporte", password: "entpass", ent: true })).cid,
      );
      // `identifiant` vient de la page (`entuser`), pas des arguments.
      const tsIdent = tsa.posts.find((p) => p.id === "Identification");
      const ktIdent = kta.posts.find((p) => p.id === "Identification");
      expect((ktIdent?.inner as { data: Record<string, unknown> }).data).toEqual(
        (tsIdent?.inner as { data: Record<string, unknown> }).data,
      );
      expect(((tsIdent?.inner as { data: Record<string, unknown> }).data as Record<string, unknown>).pourENT).toBe(true);
      const ktState = JSON.parse(await ask({ op: "clientState", cid: ktCid }));
      expect(canonTs(ktState)).toBe(canonTs(tsStateOf(tsClient)));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  // #417 : le chemin ENT doit survivre à une page SANS `e`/`f` — la référence
  // traite l'attribut absent comme `undefined` (`String(undefined)`), le port
  // jetait un `KotlinNullPointerException` et le login s'arrêtait.

  test.skipIf(skip)("ENT : page sans `e`/`f` → le login aboutit (comme la référence)", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      // Pas de `e`/`f` dans la page : le mot de passe ENT vaut `undefined`
      // (JS : `String(undefined)`) — le stub attend exactement ce mot de passe.
      for (const stub of [tsa, kta]) {
        stub.htmlExtra = "";
        stub.password = "undefined";
        stub.script.securisation = 0;
      }
      const entTs = async () => {
        const { CookieJar } = await import("tough-cookie");
        return new CookieJar();
      };
      const { Client: C } = await import("pronotets");
      const tsClient = await C.login(`${tsa.base}/pronote/eleve.html`, "nimporte", "entpass", { ent: entTs as never });
      const ktCid = Number(
        JSON.parse(await ask({ op: "clientLogin", site: `${kta.base}/pronote/eleve.html`, username: "nimporte", password: "entpass", ent: true })).cid,
      );
      // `identifiant` ABSENT des deux côtés (la page n'a pas `e`).
      const tsIdent = tsa.posts.find((p) => p.id === "Identification");
      const ktIdent = kta.posts.find((p) => p.id === "Identification");
      expect((ktIdent?.inner as { data: Record<string, unknown> }).data).toEqual(
        (tsIdent?.inner as { data: Record<string, unknown> }).data,
      );
      expect(((tsIdent?.inner as { data: Record<string, unknown> }).data as Record<string, unknown>).pourENT).toBe(true);
      expect((ktIdent?.inner as { data: Record<string, unknown> }).data.identifiant).toBeUndefined();
      // Le login aboutit des deux côtés (état identique).
      const ktState = JSON.parse(await ask({ op: "clientState", cid: ktCid }));
      expect(canonTs(ktState)).toBe(canonTs(tsStateOf(tsClient)));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("robustesse : enveloppes tordues jettent des deux côtés", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      // Menu sans `ListePlats` : les deux jettent (pas de cantine silencieuse).
      tsa.script.menus = [{ Date: { V: "21/09/2026" }, ListeRepas: { V: [{ N: "x", L: "X", G: 0 }] } }];
      kta.script.menus = [{ Date: { V: "21/09/2026" }, ListeRepas: { V: [{ N: "x", L: "X", G: 0 }] } }];
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      let tsName = "";
      try {
        await tsClient.menus(new Date(2026, 8, 21), new Date(2026, 8, 21));
      } catch (e) {
        tsName = (e as Error).name;
      }
      const ktErr = portError(
        await ask({ op: "menus", cid: ktCid, from: "2026-09-21T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" }, true),
      );
      // `json.ListePlats.V` absent : accès direct = `TypeError` côté TS,
      // `ParsingError` ciblé côté port. Les deux jettent, aucun ne devine.
      expect(tsName).toBe("TypeError");
      expect(ktErr.name).toBe("ParsingError");
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("fil chiffré + compressé : `CrA` et `CoA` ensemble", async () => {
    // Régression : #200 n'a prouvé les drapeaux que séparément. Ici les deux :
    // requêtes double-hex chiffrées, réponses simple-hex chiffrées.
    const tsa = startStub();
    const kta = startStub();
    try {
      tsa.coa = true;
      kta.coa = true;
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsPeriod = ((tsClient.periods as unknown[]).find((p) => (p as { id: string }).id === "t1-p-1") as {
        grades(): Promise<unknown[]>;
      });
      const tsGrades = (await tsPeriod.grades()) as Record<string, unknown>[];
      const ktGrades = JSON.parse(await ask({ op: "periodGrades", cid: ktCid, periodId: "t1-p-1" }));
      expect(canonTs(ktGrades)).toBe(tsCanon(tsGrades.map(flatGrade)));
      // Le fil brut diffère (flux `deflate` Java ≠ zlib) : on compare les inners
      // déjà décodés par le stub (le décodage double-hex réussi EST la preuve).
      const normInner = (posts: RecordedPost[]) =>
        posts.map((p) => {
          const inner = JSON.parse(JSON.stringify(p.inner)) as { data?: Record<string, unknown> };
          const data = inner.data;
          if (data !== null && typeof data === "object") {
            if ("Uuid" in data) data.Uuid = "TEMP";
            if ("challenge" in data) data.challenge = "#";
            if ("codePin" in data) data.codePin = "#";
          }
          return { id: p.id, inner };
        });
      expect(canonTs(normInner(kta.posts))).toBe(canonTs(normInner(tsa.posts)));
    } finally {
      tsa.close();
      kta.close();
    }
  });
}
