// Le lock vendorisé (`skills-lock.json`) est DÉCORATIF : son `computedHash`
// vient de l'outil `npx skills`, dont l'algorithme n'est pas documenté dans le
// dépôt — il n'est donc pas recalculable ici (vérifié : aucune combinaison
// simple de fichier/contenu ne redonne le hash). Sans contrôle, une skill
// vendorisée pouvait être ÉDITÉE à la main : c'est le dossier le moins
// contrôlé du dépôt, et le seul dont le contenu imite des secrets (I11).
//
// Ce test est le VERROU vérifiable du dépôt : sha256 de chaque arbre de skill
// (chemins relatifs triés + contenu), comparé à une table ci-dessous. Une
// mise à jour (`npx skills update`) fait échouer le test : la table est alors
// mise à jour au même moment que le lock amont — le changement devient
// VISIBLE dans la PR, au lieu d'être silencieux.
//
// ponytail: une table dans le test, pas un nouveau fichier de lock : le dépôt
// n'a pas de format de lock maison, et un fichier de plus serait une source
// de vérité de plus à garder en sync.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "../unit/fixtures/kotlin-harness";

const AGENTS = join(ROOT, ".agents");
const SKILLS = join(AGENTS, "skills");

/** sha256 de l'ARBRE d'une skill : chemins relatifs triés + contenu. */
function treeHash(dir: string): string {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(dir, file));
    hash.update("\0");
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

/**
 * Empreintes ET PROVENANCE attendues des skills vendorisées.
 *
 * À mettre à jour SEULEMENT avec le lock amont (`npx skills update`), dans la
 * même PR : la PR montre alors le contenu tiers qui change.
 *
 * #534 : la provenance est ÉPINGLÉE, pas seulement le contenu. Avant, le test
 * comparait les NOMS du lock amont au disque : éditer `skills-lock.json` pour
 * pointer `source` vers un autre dépôt laissait le test VERT — le lock était
 * décoratif côté provenance, et `npx skills update` irait chercher le contenu
 * ailleurs. Le verrou vérifiable (`treeHash`) protège le CONTENU sur disque ;
 * il ne dit pas d'où il vient. Une seule table pour les deux : une mise à jour
 * amont les touche dans la MÊME PR.
 */
const ATTENDU: Record<
  string,
  { source: string; sourceType: string; skillPath: string; computedHash: string; arbre: string }
> = {
  "code-review": {
    source: "mattpocock/skills",
    sourceType: "github",
    skillPath: "skills/engineering/code-review/SKILL.md",
    computedHash: "57cfd4ceb011f05e58a1a4f4cad3b2e03419d371f8990f4bcb32ff0d435a039f",
    arbre: "5c784252646f78647d682f1ed3a2f0a87e836723869d07b2587ef52d6fec6a91",
  },
  "impeccable": {
    source: "pbakaus/impeccable",
    sourceType: "github",
    skillPath: ".agents/skills/impeccable/SKILL.md",
    computedHash: "43e71626e3d14a9ed877d00a924e2fb04631004f927914f2db26aa0af0eb54f3",
    arbre: "5b6976fc7757938909a89e203015dd32f2d63e170253a956a3043e7bc362e635",
  },
  "kotlin-specialist": {
    source: "jeffallan/claude-skills",
    sourceType: "github",
    skillPath: "skills/kotlin-specialist/SKILL.md",
    computedHash: "708b9ecdef50aa46582eba4efefef66129905e732704cbb59e74c3779f1ca522",
    arbre: "413b67a01ad985a94baa5137c12c8c0d3e1ca47fcc5915625597c78bdc4afcf2",
  },
  "playwright-best-practices": {
    source: "currents-dev/playwright-best-practices-skill",
    sourceType: "github",
    skillPath: "playwright-best-practices/SKILL.md",
    computedHash: "7eb144f734450fee649dc1d209114775ddda07cbf45be84fe969d3d4f3971dce",
    arbre: "68fa97dd4ff0cb6829ecd5198814a2d4c23e039d24f1d13d840ca2d2fc2beb0e",
  },
  "security-review": {
    source: "github/awesome-copilot",
    sourceType: "github",
    skillPath: "skills/security-review/SKILL.md",
    computedHash: "9b1791054c648b84ca424fc1342dede2e04759dc73436bb91d21675d5a4c13ea",
    arbre: "db4c7df72d5a14fbf7fa8051a95177f7192b3eeb8c593f3012bc4ba71586604e",
  },
  "systematic-debugging": {
    source: "obra/superpowers",
    sourceType: "github",
    skillPath: "skills/systematic-debugging/SKILL.md",
    computedHash: "276fb0aadb002ab930cc2a56de89e16995a2e3e70b33587652bf0a5fb123148d",
    arbre: "cf38cce969d8c7f156d5919356d4a6a31a3ac943d3da6d25c021ad5a472a21b2",
  },
  "vercel-react-best-practices": {
    source: "vercel-labs/agent-skills",
    sourceType: "github",
    skillPath: "skills/react-best-practices/SKILL.md",
    computedHash: "ca7b0c0c6e5f2750043f7f0cd72d16ac4e2abc48f9b5500d047a4b77a2506212",
    arbre: "06c92a29e848b85ceb9b0367d4384f67c51c20b0013dd29679a3d5163e8a34b7",
  },
  "web-design-guidelines": {
    source: "vercel-labs/agent-skills",
    sourceType: "github",
    skillPath: "skills/web-design-guidelines/SKILL.md",
    computedHash: "f3bc47f890f42a44db1007ab390709ec368e4b8c089baee6b0007182236ac474",
    arbre: "d5cb29ea15d5ceeb4ef0802e75c17ef4287c6f60ff8aa05e46c6080f615178bc",
  },
};

/** Entrée du lock amont, telle que `npx skills` l'écrit. */
interface LockEntry {
  readonly source: string;
  readonly sourceType: string;
  readonly skillPath: string;
  readonly computedHash: string;
}

const LOCK = JSON.parse(readFileSync(join(AGENTS, "..", "skills-lock.json"), "utf8")) as {
  skills: Record<string, LockEntry>;
};

/**
 * Écarts entre le lock amont et la provenance épinglée.
 *
 * Fonction PURE : le test la compare à la table, et le test de sabotage
 * l'appelle avec un lock truqué — donc le défaut (#534) est vérifié par le
 * CODE de la vérification, pas par une comparaison recopiée dans le test.
 */
export function lockEcart(
  lock: { skills: Record<string, LockEntry> },
  attendu: Record<
    string,
    { source: string; sourceType: string; skillPath: string; computedHash: string }
  >,
): string[] {
  const ecarts: string[] = [];
  for (const [skill, attenduSkill] of Object.entries(attendu)) {
    const reel = lock.skills[skill];
    if (!reel) {
      ecarts.push(`${skill}: absent du lock amont`);
      continue;
    }
    for (const champ of ["source", "sourceType", "skillPath", "computedHash"] as const) {
      if (reel[champ] !== attenduSkill[champ]) {
        ecarts.push(
          `${skill}.${champ}: lock « ${reel[champ]} » ≠ attendu « ${attenduSkill[champ]} »`,
        );
      }
    }
  }
  for (const skill of Object.keys(lock.skills)) {
    if (!(skill in attendu)) {
      ecarts.push(`${skill}: dans le lock amont, absent de la table attendue`);
    }
  }
  return ecarts;
}

describe("skills vendorisées : le lock est vérifiable", () => {
  test("chaque skill vendorisée a l'empreinte attendue", () => {
    const vues: Record<string, string> = {};
    for (const skill of Object.keys(ATTENDU).sort()) {
      vues[skill] = treeHash(join(SKILLS, skill));
    }
    expect(vues).toEqual(
      Object.fromEntries(Object.entries(ATTENDU).map(([k, v]) => [k, v.arbre])),
    );
  });

  test("le lock amont et le dépôt vendorisé portent les MÊMES skills", () => {
    expect(Object.keys(LOCK.skills).sort()).toEqual(Object.keys(ATTENDU).sort());
    // Une skill présente sur le disque mais absente du lock amont (ou
    // l'inverse) = une copie non tracée.
    const surDisque = readdirSync(SKILLS).sort();
    expect(surDisque).toEqual(Object.keys(ATTENDU).sort());
  });

  // #534 : le lock amont ne vaut que si sa PROVENANCE est épinglée. Le test
  // comparait les noms : éditer `source` vers un autre dépôt laissait le test
  // vert, et `npx skills update` irait alors chercher le contenu ailleurs.
  test("la provenance du lock amont est ÉPINGLÉE (source, sourceType, skillPath)", () => {
    expect(lockEcart(LOCK, ATTENDU)).toEqual([]);
  });

  test("un lock pointant vers un AUTRE dépôt échoue le gate", () => {
    // Le défaut exact : éditer `source` laissait le test VERT.
    const truque = {
      skills: {
        ...LOCK.skills,
        "code-review": { ...LOCK.skills["code-review"]!, source: "attaquant/ Skills" },
      },
    };
    const ecarts = lockEcart(truque, ATTENDU);
    expect(ecarts.length).toBeGreaterThan(0);
    expect(ecarts.join("\n")).toContain("code-review.source");
  });
});
