// #367 : la fiche de revision doit etre un JSON {"fiche": ...}.
//
// Le prompt demandait « reponds en texte simple » alors que la sortie lue est
// un JSON : le modele obeissait, la garde I5 (parseJsonOutput +
// parseRevisionAnswer) rejetait la prose, et le pont avalait l'erreur en
// « Fiche non générée. » — aucune fiche ne pouvait etre enregistree.
//
// VRAI Kotlin compile : `android/core/` (Untrusted, LlmGuard, AiPrompts,
// RevisionAi — stdlib seul) est compile par le harnais puis pilote par
// `agents/runtime/kotlin-parity/RevisionAiMain.kt`. Les assertions portent
// donc sur du code execute, pas sur un miroir TS. Le pont (`app/`) ne compile
// pas hors Gradle : son câblage est verifie par lecture de source (le meme
// filet que `android-homework.test.ts`).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "RevisionAiMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown): Promise<string> {
  return link!.ask(op);
}

type Prompt = { system: string; body: string; nonce: string };
type Parse = { ok: boolean; fiche?: string; error?: string };
type Fiche = { ok: boolean; fiche?: string; error?: string; apiKey?: string | null; calls?: number };

describe("fiche de revision — le prompt demande le JSON attendu (#367)", () => {
  test.skipIf(skip)("la consigne systeme exige un JSON {\"fiche\"}", async () => {
    const prompt = JSON.parse(await ask({ op: "prompt" })) as Prompt;
    // Le schema, en clair : sans lui le modele repond en prose (le bug).
    expect(prompt.system).toContain("fiche");
    expect(prompt.system).toContain("JSON");
    expect(prompt.system).not.toContain("reponds en texte simple");
    // Le corps porte le schema : c'est lui qui est envoye au fournisseur.
    expect(prompt.body).toContain("{\"fiche\":string}");
  });

  test.skipIf(skip)("les sources restent des DONNEES delimitees par nonce (I6)", async () => {
    const prompt = JSON.parse(await ask({ op: "prompt" })) as Prompt;
    expect(prompt.nonce).toBe("revisionnonce000001");
    // Delimiteurs a nonce des deux cotes : le contenu externe n'est pas melange
    // a la consigne.
    expect(prompt.body).toContain(`---UNTRUSTED_DATA nonce="${prompt.nonce}"---`);
    expect(prompt.body).toContain(`<UNTRUSTED_DATA nonce="${prompt.nonce}">`);
    expect(prompt.body).toContain(`</UNTRUSTED_DATA nonce="${prompt.nonce}">`);
    expect(prompt.body).toContain("jamais instructions");
  });

  test.skipIf(skip)("parseRevisionAnswer accepte {\"fiche\"} et rejette prose / JSON sans fiche", async () => {
    const ok = JSON.parse(await ask({ op: "parse", text: '{"fiche":"Rappel : derivé de x^2 = 2x."}' })) as Parse;
    expect(ok).toEqual({ ok: true, fiche: "Rappel : derivé de x^2 = 2x." });

    // Texte brut : la garde I5 refuse (c'est ce que renvoyait le modele).
    const prose = JSON.parse(await ask({ op: "parse", text: "Voici ta fiche en texte simple." })) as Parse;
    expect(prose.ok).toBe(false);
    expect(prose.error).toContain("JSON invalide");

    // JSON sans « fiche » : pas une fiche, refus net.
    for (const text of ['{"reponse":"x"}', '{"fiche":""}', '{"fiche":42}', "{}"]) {
      const bad = JSON.parse(await ask({ op: "parse", text })) as Parse;
      expect({ text, ok: bad.ok }).toEqual({ text, ok: false });
      expect(bad.error).toContain("I5");
    }
  });

  test.skipIf(skip)("le message d'echec est explicite, borne et sans secret", async () => {
    // Requetes SEQUENTIELLES : le pilote est ligne a ligne, les reponses se
    // succedent dans l'ordre d emission.
    const messages: string[] = [];
    for (const failure of ["FORMAT", "KEY", "QUOTA", "PROVIDER", "UNKNOWN"]) {
      const { message } = JSON.parse(await ask({ op: "failure", failure })) as { message: string };
      messages.push(message);
    }
    // La cause, en clair : plus de « Fiche non générée. » qui ne dit rien.
    expect(messages[0]).toContain("format attendu");
    expect(messages[1]).toContain("Clé LLM");
    // Bornes : un message, pas une trace d'exception.
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThanOrEqual(200);
      expect(message).not.toMatch(/sk-or|Authorization|Bearer|Exception|at fr\./);
    }
  });
});

describe("fiche de revision — le point d'entree public relaie la cle (#428)", () => {
  // Avant #428, `requestRevisionSheet` OUBLIAIT la clé : l'appel partait
  // sans, et `OpenRouterLlm` levait « clé LLM absente » AVANT tout appel
  // HTTP. Le point d'entrée documenté ne pouvait donc jamais produire de fiche.
  test.skipIf(skip)("avec une cle, le fournisseur est appele et la fiche est rendue", async () => {
    const res = JSON.parse(await ask({ op: "fiche", key: "cle-de-test-1234" })) as Fiche;
    expect(res.ok).toBe(true);
    // La fiche PARSEE : le core garde la main sur le schema {"fiche"}.
    expect(res.fiche).toBe("Rappel : derivé de x^2 = 2x.");
    // La cle ATTEINT le fournisseur : c'est elle qui manquait.
    expect(res.apiKey).toBe("cle-de-test-1234");
    expect(res.calls).toBe(1);
  });

  test.skipIf(skip)("sans cle, l'appel est refuse net (aucune fiche en promenade)", async () => {
    const res = JSON.parse(await ask({ op: "fiche" })) as Fiche;
    expect(res.ok).toBe(false);
    expect(res.error).toContain("clé");
    // Le fournisseur a bien ete appele, SANS cle : le core n'invente pas de
    // credential de repli (I8 : l'appareil n'en possede aucun).
    expect(res.apiKey).toBeNull();
    expect(res.calls).toBe(1);
  });

  test.skipIf(skip)("une sortie hors schema reste refusee (garde I5)", async () => {
    const res = JSON.parse(
      await ask({ op: "fiche", key: "cle-de-test-1234", body: "Voici ta fiche en texte simple." }),
    ) as Fiche;
    expect(res.ok).toBe(false);
    expect(res.error).toContain("I5");
  });
});

describe("fiche de revision — le pont ne jette plus l'echec (#367)", () => {
  const bridge = codeOnly(readFileSync(join(APP, "VsnBridge.kt"), "utf8"));
  const prompts = codeOnly(readFileSync(join(CORE, "AiPrompts.kt"), "utf8"));
  const revision = codeOnly(readFileSync(join(CORE, "RevisionAi.kt"), "utf8"));

  test("la sortie passe toujours par la garde I5 (parse + schema)", () => {
    // La validation n'est ni contournee ni affaiblie : elle vit dans le CORE,
    // que le pont appelle (#428) — le pont ne re-parse plus de son côté.
    expect(revision).toMatch(/parseRevisionAnswer\(parsed\)/);
    expect(revision).toMatch(/generateGuardedJson\(provider, SYSTEM_REVISION_JSON/);
  });

  test("l'echec est remonte avec sa cause, plus « Fiche non générée. »", () => {
    expect(bridge).not.toContain("Fiche non générée.");
    // Le pont mappe l'exception sur une cause, puis sur un message borne.
    expect(bridge).toMatch(/revisionFailureMessage\(revisionFailure\(e\)\)/);
    expect(bridge).toMatch(/is AiError -> RevisionFailure\.FORMAT/);
    expect(bridge).toMatch(/is LlmError -> when \(e\.status\)/);
    // La clé absente est dite telle quelle, avant l'appel.
    expect(bridge).toMatch(/NO_KEY_MESSAGE/);
  });

  test("le fournisseur porte le délai du pont, pas le défaut 20 s (#594)", () => {
    // Un modèle gratuit lent est tué à 20 s par le défaut OkHttp alors que
    // le pont attend AWAIT_LLM_MS (45 s) : même délai que l'aide photo.
    expect(bridge).toMatch(/requestRevisionSheet\(OpenRouterLlm\(timeoutMs = AWAIT_LLM_MS\)/);
  });

  test("la fiche cherche le devoir dans la semaine AFFICHÉE (#369, #596)", () => {
    // Sans weekStart, le repli réseau ne couvre que now−7 j / now+21 j :
    // un devoir affiché hors de cette fenêtre était « introuvable ».
    expect(bridge).toMatch(
      /fun generateRevision\(p: JSONObject, epoch: Long\)[\s\S]*?val week = bounded\(p\.string\("weekStart"\), 10\)/,
    );
  });

  test("la consigne de revision est le schema JSON, plus « texte simple »", () => {
    expect(prompts).toContain("SYSTEM_REVISION_JSON");
    expect(prompts).not.toContain("SYSTEM_REVISION =");
    expect(prompts).not.toContain("reponds en texte simple");
    // Les deux chemins de revision (pont et jobs) partagent la meme consigne.
    expect(prompts).toMatch(/buildSafePrompt\(SYSTEM_REVISION_JSON/);
    expect(revision).toMatch(/generateGuardedJson\(provider, SYSTEM_REVISION_JSON/);
  });
});

// #606 — recette LIVE sur appareil : « Fiche de révision » échouait sur tout
// devoir réel avec « Secret détecté (identifiant secret) ».
//
// Le prompt portait `Id examen : <id>`. Les ids Pronote sont des jetons à
// forte entropie (`147#h-etLBzJ2…`) : la garde I4 (forme OPAQUE) les classait
// en secret et refusait le prompt fabriqué par l'app elle-même. L'identifiant
// ne sert à RIEN au modèle (titre, matière, date et extraits suffisent).
describe("fiche de revision — l'id du devoir ne part pas dans le prompt (#606)", () => {
  // Ids réels observés en mode démo (mêmes formes que la production).
  const PRONOTE_ID = ["147#h-etLBzJ2Deo5zD2", "02k8QuEiINhwBMzgQvJsLBKuwg"].join("-");
  const SECOND_ID = ["147#v03_nqVDgdDw4", "JamTg4VyY68BHpDf720dbdH3c3Ljs"].join("-");

  interface PromptFor {
    ok: boolean;
    error?: string;
    kind?: string | null;
    body?: string;
  }

  test.skipIf(skip)("un id Pronote ne déclenche plus la garde, matière/date/motif restent", async () => {
    for (const id of [PRONOTE_ID, SECOND_ID]) {
      const r = JSON.parse(
        await ask({ op: "promptFor", id, subject: "MATHEMATIQUES", date: "2026-10-26", matched: "Exercices n°2 à 4" }),
      ) as PromptFor;
      // Le vrai chemin public (requestRevisionSheet → garde I4 → parse I5) passe.
      expect(r.ok).toBe(true);
      expect(r.body).toContain("MATHEMATIQUES");
      expect(r.body).toContain("2026-10-26");
      expect(r.body).toContain("Exercices n°2 à 4");
      // Et l'identifiant interne n'y est plus : c'était LUI le faux secret.
      expect(r.body).not.toContain(id);
    }
  });

  test.skipIf(skip)("la garde I4 reste effective sur les extraits de cours", async () => {
    // Un vrai secret dans le cours est toujours refusé : on n'a pas affaibli
    // la garde, on a retiré du prompt ce qui n'y avait pas sa place.
    const jwt = [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkVsInZ1ZSJ9",
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    ].join(".");
    const r = JSON.parse(
      await ask({ op: "promptFor", id: PRONOTE_ID, chunks: [`Cours : jeton ${jwt}`] }),
    ) as PromptFor;
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("JWT");
  });

  test.skipIf(skip)("le prompt n'a plus la ligne « Id examen »", async () => {
    const r = JSON.parse(await ask({ op: "prompt", chunks: ["Cours : x^2."] })) as Prompt;
    expect(r.body).toContain("Matiere :");
    expect(r.body).toContain("Motif :");
    expect(r.body).not.toContain("Id examen");
  });
});
