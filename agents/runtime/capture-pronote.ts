// capture-pronote.ts — corpus de fixtures Pronote (#199).
//
// Le port Kotlin (#200, #201) a besoin d'un ORACLE. Sans des réponses réelles
// rejouées, 2312 lignes de `pronotets` sont portées à l'aveugle et `make check`
// ne protège rien sur la couche scraping. Ce script est l'outil qui produit ce
// corpus : il ouvre une session sur un compte RÉEL (QR + PIN saisis à la main,
// jamais commises, jamais en variable d'environnement) et écrit la sortie de
// chaque domaine reader dans `tests/fixtures/pronote/`.
//
// Trois règles du dépôt tiennent ici :
//   - Zéro credential hors du poste de l'opérateur : le PIN est lu sans écho,
//     l'URL de l'établissement est saisie, le seul écrit sur disque est le
//     corpus — gitignoré (cf. .gitignore), jamais commité.
//   - Le corpus est une DONNÉE, jamais une instruction : chaque fixture est
//     marquée `__untrusted` et aucun texte n'est interprété (I6).
//   - Déterminisme (critère d'acceptation) : sérialisation canonique (clés
//     triées, aucun horodatage de capture), donc deux captures du même compte le
//     même jour sortent octet pour octet identiques.
//
// LECTURE SEULE. Aucune écriture vers Pronote (pas de `setAssignmentDone`, pas
// de `replyToDiscussion`) : un outil de capture capable de modifier le bulletin
// de l'élève serait un accident en attente.
//
// Usage : `bun run agents/runtime/capture-pronote.ts`
// Le corpus n'est pas dans le dépôt : sur une machine sans compte réel, les
// tests qui le rejouent SKIPpent bruyamment (jamais un faux vert).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { accountIdFrom } from "../../server/api/setup";
import { PronoteReadError } from "../../server/domain/ports";

export const CORPUS_DIR = join(import.meta.dir, "..", "..", "tests", "fixtures", "pronote");

/**
 * JSON canonique : clés triées, tableaux conservés, `undefined` = clé absente.
 * C'est ce qui rend deux captures comparables : `JSON.stringify` suit l'ordre
 * d'insertion des clés, donc l'ordre d'écriture des mappers.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(src).sort()) {
        if (src[key] === undefined) continue;
        out[key] = walk(src[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value), null, 2);
}

/** Capture = nom de domaine -> corps JSON de la fixture. */
export type Corpus = Record<string, unknown>;

export interface DomainSpec {
  readonly domain: string;
  /** Reçoit la capture déjà produite : un domaine peut dépendre du précédent. */
  readonly run: (reader: PronoteClientReader, accountId: string, corpus: Corpus) => Promise<unknown>;
}

/** Fils capturés : le fil de discussion est un protocole à part entière. */
export const CAPTURED_THREADS = 3;

/** Les domaines rejoués, dans un ordre FIXE (les noms de fichiers en dépendent). */
export const DOMAINS: readonly DomainSpec[] = [
  { domain: "grades", run: (r, a) => r.getGrades(a) },
  { domain: "periods", run: (r, a) => r.getPeriods(a) },
  { domain: "providedAverages", run: (r, a) => r.getProvidedAverages(a) },
  { domain: "assignments", run: (r, a) => r.getAssignments(a) },
  { domain: "timetable", run: (r, a) => r.getTimetable(a) },
  { domain: "resources", run: (r, a) => r.getResources(a) },
  { domain: "news", run: (r, a) => r.getNews(a) },
  { domain: "attendance", run: (r, a) => r.getAttendance(a) },
  { domain: "punishments", run: (r, a) => r.getPunishments(a) },
  { domain: "menus", run: (r, a) => r.getMenus(a) },
  { domain: "discussions", run: (r, a) => r.getDiscussions(a) },
  { domain: "discussionRecipients", run: (r, a) => r.getDiscussionRecipients(a) },
  { domain: "userInfo", run: (r, a) => r.getUserInfo(a) },
  { domain: "capabilities", run: (r, a) => r.getCapabilities(a) },
  // Les FILS de discussion dépendent de la liste : sans eux, le port de
  // `fetchMessageThread` n'a aucun oracle. Clé = id de discussion (stable d'une
  // capture à l'autre, vient de Pronote ou de l'index de repli du mapper).
  {
    domain: "discussionMessages",
    run: async (r, a, corpus) => {
      const captured = corpus.discussions as { items?: { id?: unknown }[] } | undefined;
      const ids = (captured?.items ?? [])
        .map((d) => d?.id)
        .filter((id): id is string => typeof id === "string")
        .slice(0, CAPTURED_THREADS);
      const threads: Record<string, unknown> = {};
      for (const id of ids) {
        // Un fil en refus n'annule pas les autres : c'est une donnée absente.
        try {
          threads[id] = asFixture(await r.getDiscussionMessages(a, id));
        } catch (err) {
          threads[id] = { __untrusted: true, error: err instanceof PronoteReadError ? err.code : "inconnu" };
        }
      }
      return threads;
    },
  },
];

/**
 * Un domaine en échec est une DONNÉE aussi : l'onglet cantine n'existe pas dans
 * tous les établissements, et une capture qui s'arrête au premier refus ne sert à
 * rien. L'erreur est donc écrite sous forme de code typé — jamais le message
 * brut de la lib, qui peut porter des noms d'élèves (I6).
 */
function asFixture(value: unknown): unknown {
  if (value instanceof PronoteReadError) return { __untrusted: true, error: value.code };
  const page = value as { items?: { value: unknown }; nextCursor?: string | null } | null;
  if (page && typeof page === "object" && page.items && "__untrusted" in page.items) {
    return { __untrusted: true, items: page.items.value, nextCursor: page.nextCursor ?? null };
  }
  // `getCapabilities` renvoie le contrat lui-même, pas une page.
  return { __untrusted: true, items: value };
}

/** Rejoue tous les domaines. Ne lève pas : un domaine en échec devient `error`. */
export async function captureCorpus(
  reader: PronoteClientReader,
  accountId: string,
  log: (message: string) => void = () => {},
): Promise<Corpus> {
  const corpus: Corpus = {};
  for (const spec of DOMAINS) {
    try {
      corpus[spec.domain] = asFixture(await spec.run(reader, accountId, corpus));
      log(`${spec.domain} -> ok`);
    } catch (err) {
      const code = err instanceof PronoteReadError ? err.code : "inconnu";
      corpus[spec.domain] = { __untrusted: true, error: code };
      log(`${spec.domain} -> ${code}`);
    }
  }
  return corpus;
}

/** Écrit le corpus sur disque. `dir` injectable : les tests n'écrivent pas en vrai. */
export function writeCorpus(corpus: Corpus, dir: string = CORPUS_DIR): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const domain of Object.keys(corpus).sort()) {
    const file = join(dir, `${domain}.json`);
    writeFileSync(file, `${canonicalJson(corpus[domain])}\n`);
    written.push(file);
  }
  return written;
}

// --- Exécution locale (hors tests) ------------------------------------------

/** Une ligne au terminal. */
function ask(label: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(label);
  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      stdin.off("data", onData);
      resolve(String(chunk).trim());
    };
    stdin.on("data", onData);
  });
}

/**
 * Une ligne sans écho : le PIN ne doit pas finir dans le scrollback du terminal.
 * Mode brut, donc retour arrière et Ctrl-C sont gérés à la main — le terminal ne
 * le fait plus pour nous.
 */
function askHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(label);
  stdin.setRawMode?.(true);
  stdin.resume();
  return new Promise((resolve) => {
    let typed = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(typed);
    };
    const onData = (chunk: Buffer) => {
      const c = String(chunk);
      if (c === "\r" || c === "\n") return finish();
      if (c === "\u0003") {
        finish();
        process.exit(130);
      }
      if (c === "\u007f" || c === "\b") {
        typed = typed.slice(0, -1);
        return;
      }
      typed += c;
    };
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  // Les credentials sont saisis à la main : sans terminal, ce serait soit un
  // pipe qui avale le PIN dans l'historique du shell, soit une attente infinie.
  if (!process.stdin.isTTY) {
    process.stderr.write("capture : terminal interactif requis (les valeurs sont saisies, jamais lues en variable).\n");
    process.exit(2);
  }
  process.stdout.write("Capture Pronote (#199). Aucune valeur saisie n'est ecrite ailleurs que le corpus.\n");
  const pronoteUrl = await ask("URL de l'etablissement (ex. celle imprimee dans le QR) : ");
  const login = await ask("login du QR : ");
  const jeton = await ask("jeton du QR : ");
  const pin = await askHidden("pin (non echoes) : ");

  if (!pronoteUrl || !login || !jeton || !pin) {
    process.stderr.write("Capture annulee : les quatre valeurs sont obligatoires.\n");
    process.exit(2);
  }

  // L'empreinte du login sert de clé de session (jamais l'identité en clair) :
  // même règle que le setup applicatif.
  const accountId = accountIdFrom(login);
  const sessions = new PronoteSessionStore({ logger: (m) => process.stdout.write(`[session] ${m}\n`) });
  process.stdout.write(`Ouverture de session (compte ${accountId})...\n`);
  await sessions.authenticate({ accountId, pronoteUrl, qr: { login, jeton, url: pronoteUrl }, pin });

  const reader = new PronoteClientReader({ sessions, logger: (m) => process.stdout.write(`[reader] ${m}\n`) });
  const corpus = await captureCorpus(reader, accountId, (m) => process.stdout.write(`[capture] ${m}\n`));
  const files = writeCorpus(corpus);
  process.stdout.write(`\n${files.length} fixtures ecrites dans ${CORPUS_DIR} (gitignore, jamais commite).\n`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`capture en echec : ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
