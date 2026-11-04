// Le support est un contrat public : canal unique, délais, rapport utile,
// diagnostic borné et frontière avec la sécurité. Le test vérifie la forme et
// le câblage ; il ne promet aucune réponse réelle.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const FILE = "docs/SUPPORT.md";
const SUPPORT = read(FILE);
const README = read("README.md");
const SECURITY = read("SECURITY.md");
const HELP = read("web/src/features/help/HelpScreen.tsx");
const CONFIG = read(".github/ISSUE_TEMPLATE/config.yml");
const INCIDENTS = read("docs/INCIDENTS.md");

const ISSUES = "https://github.com/iguanacucumber/veryslopnynotes/issues/new/choose";
const ADVISORY = "https://github.com/iguanacucumber/veryslopnynotes/security/advisories/new";
const RELEASES = "https://github.com/iguanacucumber/veryslopnynotes/releases";

const SECTIONS = [
  "Canal et délais",
  "Ouvrir un rapport utile",
  "Données interdites",
  "Diagnostic exporté",
  "Problèmes connus",
  "Versions et release",
  "Support, bug ou sécurité",
] as const;

function relativeLinks(md: string): string[] {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1]!)
    .filter((target) => !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(target))
    .map((target) => decodeURIComponent(target.split("#")[0]!))
    .filter((target) => target.length > 0);
}

const exists = (path: string) => {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
};

describe("support et problèmes connus (#959)", () => {
  test("le document existe et porte les sections requises", () => {
    expect({ fichier: FILE, existe: exists(FILE) }).toEqual({ fichier: FILE, existe: true });
    for (const section of SECTIONS) {
      expect({ section, présente: new RegExp(`^## ${section}$`, "m").test(SUPPORT) }).toEqual({
        section,
        présente: true,
      });
    }
  });

  test("GitHub Issues est le seul canal, sans adresse inventée", () => {
    expect(SUPPORT).toContain("uniquement par GitHub Issues");
    expect(SUPPORT).toContain(ISSUES);
    expect(SUPPORT).toContain(ADVISORY);
    expect(SUPPORT).toMatch(/aucun\s+courriel/i);
    expect(SUPPORT).not.toMatch(/mailto:|support@|contact@/i);
    // Aucune autre origine : pas de domaine, de formulaire ni de miroir inventé.
    for (const match of SUPPORT.matchAll(/https?:\/\/[^\s)>]+/g)) {
      expect({ url: match[0], github: match[0].startsWith("https://github.com/iguanacucumber/veryslopnynotes/") }).toEqual({
        url: match[0],
        github: true,
      });
    }
  });

  test("les délais et le contenu d'un rapport utile sont explicites", () => {
    for (const terme of [
      "≤ 4 h",
      "≤ 1 jour ouvré",
      "≤ 3 jours ouvrés",
      "≤ 5 jours ouvrés",
      "pas un engagement contractuel",
      "une issue par problème",
      "version de l'application",
      "version d'Android",
      "version de la WebView",
      "écran concerné",
      "étapes exactes",
      "comportement attendu",
      "état de l'appairage",
    ]) {
      expect({ terme, présent: SUPPORT.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("les données scolaires et les secrets sont interdits", () => {
    for (const terme of [
      "nom ou prénom",
      "URL d'établissement",
      "note",
      "message",
      "QR",
      "PIN",
      "jeton de session",
      "clé OpenRouter",
      "capture non caviardée",
      "identifiant d'appareil",
    ]) {
      expect({ terme, présent: SUPPORT.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("le diagnostic reprend les champs réels et ne part jamais seul", () => {
    for (const terme of [
      "Réglages → Aide → Exporter un diagnostic",
      "L'aperçu affiché **est** le fichier partagé",
      "Rien n'est envoyé automatiquement",
      "sélecteur Android",
      "veryslopnynotes.diagnostic",
      "version de schéma",
      "date de génération",
      "version de l'application",
      "niveau d'API Android",
      "version de la WebView",
      "dernier code d'erreur",
      "ressource concernée",
      "niveau de classe",
      "état de la session",
      "volontairement exclues",
      "Aucun envoi réseau",
      "purgé avec le compte",
    ]) {
      expect({ terme, présent: SUPPORT.includes(terme) }).toEqual({ terme, présent: true });
    }
    expect(SUPPORT).toContain("`unknown`");
  });

  test("l'issue épinglée known-issues garde le format unique", () => {
    expect(SUPPORT).toContain("`[known-issues] vX.Y.Z`");
    expect(SUPPORT).toContain("label `bug`");
    for (const terme of ["épinglée", "contournement", "propriétaire", "version cible"]) {
      expect({ terme, présent: SUPPORT.includes(terme) }).toEqual({ terme, présent: true });
    }
    expect(INCIDENTS).toContain("`[known-issues] vX.Y.Z`");
  });

  test("la page Releases est la seule source de téléchargement", () => {
    expect(SUPPORT).toContain(RELEASES);
    expect(SUPPORT).toContain("seule source de téléchargement officielle");
    expect(SUPPORT).toContain("Aucune release n'est encore publiée");
  });

  test("la frontière support, bug et sécurité est explicite", () => {
    for (const terme of [
      "modèle **Bug**",
      "GitHub Security Advisories",
      "vulnérabilité",
      "Demande de fonctionnalité",
      "MFA/SSO",
    ]) {
      expect({ terme, présent: SUPPORT.includes(terme) }).toEqual({ terme, présent: true });
    }
    expect(SUPPORT).toContain("Un rapport de sécurité n'est pas une demande de support");
  });

  test("chaque lien relatif résout depuis le document", () => {
    const links = relativeLinks(SUPPORT);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect({ lien: link, résout: exists(join(dirname(FILE), link)) }).toEqual({
        lien: link,
        résout: true,
      });
    }
  });

  test("README, aide, sécurité et modèle d'issue pointent vers le support", () => {
    expect(README).toContain("(docs/SUPPORT.md)");
    expect(HELP).toContain("docs/SUPPORT.md");
    expect(HELP).toContain('id="aide-support"');
    expect(SECURITY).toContain("(docs/SUPPORT.md)");
    expect(CONFIG).toContain("/blob/main/docs/SUPPORT.md");
  });

  test("sabotage : une adresse de courriel inventée est rouge", () => {
    const fake = `${SUPPORT}\nÉcrire à support@example.test.`;
    expect(fake).toMatch(/mailto:|support@|contact@/i);
    expect(SUPPORT).not.toMatch(/mailto:|support@|contact@/i);
  });
});
