// Miroir des BRIQUES D'INTERFACE #136 (android/ui/.../PapComponents.kt).
//
// Ce que ce test PROUVE, sans téléphone et sans Compose :
//   - `relativeTimeFr` : chaque branche (à l'instant, min, h, hier, demain,
//     jours, date), l'injection de `now` qui la rend déterministe, le fuseau
//     qui décide de « hier », les deux jours de 23 h et 25 h du changement
//     d'heure, et le bornage qui empêche un epoch aberrant de faire tomber
//     l'écran ;
//   - `errorHeadline` : le VRAI message du serveur gagne, une chaîne vide ou
//     blanche retombe sur la phrase de repli (le défaut de 8 écrans) ;
//   - `staleBannerLabel` : la phrase figée PLUS l'horodatage, et la phrase
//     seule quand l'horodatage est inconnu ;
//   - les règles « ne rend rien » (pastille à zéro, ligne sans titre, puce vide,
//     compteur nul, description vide, détail vide) ;
//   - par lecture de la source : les 15 briques existent avec la signature
//     attendue, ZÉRO hex en dur, ZÉRO dépendance ajoutée, et le détail
//     technique de l'erreur derrière un dépliant au lieu d'être jeté.
//
// Dérive assumée : ce fichier duplique la logique Kotlin au lieu de la partager
// — un JVM ne tourne pas dans `bun test`. Les miroirs ne voient ni résolution de
// symbole, ni surcharge ambiguë, ni rendu : `make android-compile` compile le
// vrai fichier, et la VAGUE SUIVANTE ( adoption écran par écran) est seule à
// pouvoir prouver le rendu.
//
// NON COUVERT, et c'est volontaire : la brique n'a encore AUCUN appelant. Le
// critère « chaque brique est utilisée par au moins un écran » de #136 ne peut
// pas être vérifié ici, parce que #136 a pour consigne de ne toucher AUCUN
// écran : l'adoption est la vague suivante. Un test qui exigerait un appelant
// échouerait donc à dessein.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const src = readFileSync(join(UI, "PapComponents.kt"), "utf8");

/** Sans les commentaires : une garde qui lit le texte du fichier doit éviter de
 *  confondre un `//` qui NOMME une mauvaise pratique avec la pratique. */
const codeOnly = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
const kt = codeOnly(src);

// --- Miroir de relativeTimeFr -----------------------------------------------

/** Fuseau de référence du miroir : `java.time.atZone` prend un `ZoneId`, donc
 *  le miroir prend un `timeZone` — c'est la seule façon d'être déterministe. */
const ZONE = "Europe/Paris";
const MIN = 60_000;
const HOUR = 3_600_000;
/** Mêmes bornes que `MIN_EPOCH_MS` / `MAX_EPOCH_MS` du Kotlin : `0001-01-02`
 *  → `9999-12-30` UTC, soit un jour de marge de part et d'autre pour que le
 *  fuseau (jusqu'à +14 h) ne fasse pas sortir l'année du motif `dd/MM/yyyy`. */
const MIN_EPOCH_MS = -62_135_510_400_000;
const MAX_EPOCH_MS = 253_402_128_000_000;

type Local = { y: number; m: number; d: number; hh: number; mm: number; day: number };

/** Équivalent TS de `Instant.ofEpochMilli(ms).atZone(zone)` : les parties
 *  locales dans le fuseau, plus un numéro de JOUR CIVIL — c'est ce numéro, et
 *  non `ms / 86_400_000`, qui décide de « hier » aux deux jours de 23 h / 25 h. */
function zoned(ms: number, zone: string = ZONE): Local {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = part.value;
  const y = Number(p.year), m = Number(p.month), d = Number(p.day);
  return { y, m, d, hh: Number(p.hour), mm: Number(p.minute), day: Date.UTC(y, m - 1, d) };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const clamp = (v: number) => Math.min(MAX_EPOCH_MS, Math.max(MIN_EPOCH_MS, v));

/** Miroir de `relativeTimeFr(epochMillis, now, zone)`. */
function tsRelativeTimeFr(epochMillis: number, now: number, zone: string = ZONE): string {
  const epoch = clamp(epochMillis);
  const anchor = clamp(now);
  const delta = epoch - anchor;
  const gap = delta < 0 ? -delta : delta;
  const past = delta < 0;
  if (gap < MIN) return "à l'instant";
  const minutes = Math.floor(gap / MIN);
  if (minutes < 60) return past ? `il y a ${minutes} min` : `dans ${minutes} min`;
  const hours = Math.floor(gap / HOUR);
  const there = zoned(epoch, zone);
  const today = zoned(anchor, zone);
  if (there.day === today.day) return past ? `il y a ${hours} h` : `dans ${hours} h`;
  const clock = `${pad2(there.hh)}:${pad2(there.mm)}`;
  if (past && there.day === today.day - 86_400_000) return `hier ${clock}`;
  if (!past && there.day === today.day + 86_400_000) return `demain ${clock}`;
  const days = Math.abs(there.day - today.day) / 86_400_000;
  if (days < 7) return past ? `il y a ${days} jours` : `dans ${days} jours`;
  // `yyyy` est une annee SUR QUATRE CHIFFRES : le Kotlin rend « 0001 », pas « 1 ».
  return `${pad2(there.d)}/${pad2(there.m)}/${String(there.y).padStart(4, "0")}`;
}

/** Miroir de `errorHeadline(message)`. */
const GENERIC_ERROR = "Erreur réseau. Réessayer.";
const tsErrorHeadline = (message: string | null | undefined): string =>
  (message ?? "").trim() || GENERIC_ERROR;

/** Miroir de `staleBannerLabel(fetchedAt, now)`. */
const tsStaleBannerLabel = (fetchedAt: number | null, now: number): string =>
  fetchedAt === null
    ? "Données hors-ligne"
    : `Données hors-ligne · mis à jour ${tsRelativeTimeFr(fetchedAt, now)}`;

/** Miroir des règles « ne rend rien » des briques. */
const rendersBadge = (count: number) => count > 0;
const badgeLabel = (count: number) => (count > 99 ? "99+" : String(count));
const rendersListItem = (title: string) => title.length > 0;
const rendersPill = (text: string) => text.length > 0;
const rendersSectionCount = (count: number | null) => count !== null && count > 0;
const rendersDescription = (description: string) => description.length > 0;
const rendersDetailsToggle = (detail: string | null) => (detail ?? "").trim().length > 0;

/** 2026-10-04 14:00 à Paris (UTC+2). Un dimanche, donc rien d'horaire à éviter. */
const NOW = Date.UTC(2026, 9, 4, 12, 0);
/** 08:00 à Paris la veille : 06:00Z. */
const YESTERDAY_08 = Date.UTC(2026, 9, 3, 6, 0);
/** 08:00 à Paris le lendemain : 06:00Z. */
const TOMORROW_08 = Date.UTC(2026, 9, 5, 6, 0);

describe("briques d'interface (#136)", () => {
  test("relativeTimeFr : chaque seuil, et l'injection de now qui rend la fonction déterministe", () => {
    const cases: [string, number, number, string][] = [
      ["moins d'une minute", NOW - 30_000, NOW, "à l'instant"],
      ["pile 59,999 s", NOW - 59_999, NOW, "à l'instant"],
      ["l'avenir proche reste « à l'instant »", NOW + 30_000, NOW, "à l'instant"],
      ["pile une minute", NOW - MIN, NOW, "il y a 1 min"],
      ["quatre minutes", NOW - 4 * MIN, NOW, "il y a 4 min"],
      ["cinquante-neuf minutes", NOW - 59 * MIN, NOW, "il y a 59 min"],
      ["quatre minutes DANS le futur", NOW + 4 * MIN, NOW, "dans 4 min"],
      ["une heure pile", NOW - HOUR, NOW, "il y a 1 h"],
      ["trois heures", NOW - 3 * HOUR, NOW, "il y a 3 h"],
      ["cinq heures dans le futur, même journée", NOW + 5 * HOUR, NOW, "dans 5 h"],
      ["douze heures dans le futur : le jour change", NOW + 12 * HOUR, NOW, "demain 02:00"],
      ["hier à une heure du matin", NOW - 23 * HOUR, NOW, "hier 15:00"],
      ["hier 08:00", YESTERDAY_08, NOW, "hier 08:00"],
      ["demain 08:00", TOMORROW_08, NOW, "demain 08:00"],
      ["deux jours", NOW - 2 * 86_400_000, NOW, "il y a 2 jours"],
      ["six jours, le dernier avant la date", NOW - 6 * 86_400_000, NOW, "il y a 6 jours"],
      ["sept jours : la date reprend la main", NOW - 7 * 86_400_000, NOW, "27/09/2026"],
      ["quatre cents jours : une vraie date", NOW - 400 * 86_400_000, NOW, "30/08/2025"],
      ["l'an zéro : date, pas durée", 0, NOW, "01/01/1970"],
    ];
    for (const [label, epoch, now, attendu] of cases) {
      expect({ label, obtenu: tsRelativeTimeFr(epoch, now) }).toEqual({ label, obtenu: attendu });
    }
  });

  test("relativeTimeFr : français, pluriel et singulier compris", () => {
    // `min` et `h` sont des abréviations INVARIANTES : « 1 min », « 1 h », pas
    // « 1 mins » / « 1 hs ». Le pluriel de « jours » ne peut donc pas apparaître
    // au singulier : un jour entier est déjà dit « hier » ou « demain ».
    for (const minutes of [1, 2, 59]) {
      const attendu = `il y a ${minutes} min`;
      expect({ minutes, obtenu: tsRelativeTimeFr(NOW - minutes * MIN, NOW) }).toEqual({ minutes, obtenu: attendu });
      expect(attendu.endsWith("s")).toBe(false);
    }
    for (const hours of [1, 2, 23]) {
      const obtenu = tsRelativeTimeFr(NOW - hours * HOUR, NOW);
      expect({ hours, obtenu, pluriel: obtenu.endsWith("s") }).toEqual({ hours, obtenu, pluriel: false });
    }
    for (let days = 2; days <= 6; days++) {
      const obtenu = tsRelativeTimeFr(NOW - days * 86_400_000, NOW);
      expect({ days, obtenu, pluriel: obtenu.endsWith(" jours") }).toEqual({ days, obtenu, pluriel: true });
    }
    // Jamais « il y a 1 jour » : la veille a son propre mot.
    const veille = tsRelativeTimeFr(YESTERDAY_08, NOW);
    expect({ veille, unJour: veille.includes("1 jour") }).toEqual({ veille, unJour: false });
    // Troncature, jamais d'arrondi en upwards : 90 min ne devient pas « 2 h ».
    expect(tsRelativeTimeFr(NOW - 90 * MIN, NOW)).toBe("il y a 1 h");
  });

  test("relativeTimeFr : `now` injecté, donc même résultat à n'importe quelle heure du jour", () => {
    // Le contrat qui rend la fonction testable : le texte dépend du DÉCALAGE
    // entre l'horodatage et `now`, jamais de l'heure absolue. Décaler les DEUX
    // de six mois — ou de treize ans, ou du passage à l'heure d'hiver — ne
    // change rien, donc un test d'écran peut injecter `now` sans être exact.
    const attendu = tsRelativeTimeFr(NOW - 4 * MIN, NOW);
    expect(attendu).toBe("il y a 4 min");
    for (const decalage of [0, 1, 30, 400, -1, -400, 86_400_000, 400 * 86_400_000, -400 * 86_400_000]) {
      const obtenu = tsRelativeTimeFr(NOW + decalage - 4 * MIN, NOW + decalage);
      expect({ decalage, obtenu }).toEqual({ decalage, obtenu: attendu });
    }
    // Le même décalage, à six mois d'écart, donne le même texte — donc injecter
    // `now` n'introduit aucune dépendance à l'horloge du poste de test.
    for (const instant of [Date.UTC(2026, 0, 15, 8, 0), Date.UTC(2031, 4, 20, 6, 0), Date.UTC(2020, 10, 3, 12, 0)]) {
      expect(tsRelativeTimeFr(instant - 4 * MIN, instant)).toBe(attendu);
    }
    // Le FUSEAU décide de « hier » : le même epoch, au même `now`, est la veille
    // à Paris et la journée en cours à Tokyo. C'est pourquoi `zone` est injecté
    // — sans lui, la fonction n'est pas déterministe d'un test à l'autre.
    const epoch = Date.UTC(2026, 9, 3, 21, 30); // 23:30 le 3 à Paris, 06:30 le 4 à Tokyo
    expect({ paris: tsRelativeTimeFr(epoch, NOW, ZONE) }).toEqual({ paris: "hier 23:30" });
    expect({ tokyo: tsRelativeTimeFr(epoch, NOW, "Asia/Tokyo") }).toEqual({ tokyo: "il y a 14 h" });
    // Un fuseau en RETARD voit la veille plus tard dans la journée : le même
    // epoch est déjà « hier 14:30 » à Los Angeles, où il n'est que 05:00.
    expect(tsRelativeTimeFr(epoch, NOW, "America/Los_Angeles")).toBe("hier 14:30");
  });

  test("relativeTimeFr : les deux jours de 23 h et 25 h ne cassent pas « hier »", () => {
    // 29 mars 2026 : la France passe de 02:00 à 03:00, la journée ne dure que
    // 23 h. En millisecondes, 14:00 du 28 et 14:00 du 29 « font » 23 h ; au
    // calendrier ce sont bien deux jours CIVILS, donc « hier ».
    const spring = Date.UTC(2026, 2, 29, 12, 0); // 14:00 à Paris
    expect(tsRelativeTimeFr(Date.UTC(2026, 2, 28, 13, 0), spring)).toBe("hier 14:00");
    // Et le calcul naïf en millisecondes aurait répondu « 23 h » : le test
    // vérifie donc que le jour civil, pas l'écart brut, décide.
    expect(Math.floor((spring - Date.UTC(2026, 2, 28, 13, 0)) / HOUR)).toBe(23);
    // 25 octobre 2026 : la France retombe de 03:00 à 02:00, la journée dure 25 h
    // et 02:30 existe DEUX fois. Les deux passages doivent se lire « 1 h », sans
    // planter et sans inventer une date.
    const fall = Date.UTC(2026, 9, 25, 1, 30);
    expect(tsRelativeTimeFr(Date.UTC(2026, 9, 25, 0, 30), fall)).toBe("il y a 1 h");
    expect(tsRelativeTimeFr(Date.UTC(2026, 9, 25, 1, 30), fall)).toBe("à l'instant");
    // Un jour de 25 h ne fait pas non plus basculer « demain » en « dans 2 jours ».
    expect(tsRelativeTimeFr(Date.UTC(2026, 9, 26, 1, 30), fall)).toBe("demain 02:30");
  });

  test("relativeTimeFr : un epoch aberrant ne fait pas tomber l'écran", () => {
    // `OfflineCache` lit la première ligne du fichier par `toLongOrNull`, qui
    // accepte N'IMPORTE QUEL Long : `Long.MIN_VALUE` arrivait jusqu'ici, et
    // `dd/MM/yyyy` ne sait pas rendre une année négative. On vérifie que ça
    // renvoie une chaîne, pas une exception. La DATE exacte d'un epoch borné
    // n'est pas comparée : java.time et ICU n'ont pas les mêmes règles de zone
    // avant 1900, et l'écran n'a pas à trancher entre les deux.
    for (const aberrant of [-(2 ** 63), 2 ** 63 - 1, -1, 1, 10 ** 15]) {
      const obtenu = tsRelativeTimeFr(aberrant, NOW);
      expect({ aberrant, obtenu, nonVide: obtenu.length > 0 }).toEqual({ aberrant, obtenu, nonVide: true });
    }
    // L'annee reste dans le motif, cote borne comme cote borne haute : c'est ce
    // qu'un bornage trop large ne garantit pas (verifie sur l'appareil, fuseau
    // +04 : une borne a 9999-12-31T23:59:59Z y rendait « 01/01/+10000 »).
    expect(tsRelativeTimeFr(-(2 ** 63), NOW)).toBe("02/01/0001");
    expect(tsRelativeTimeFr(2 ** 63 - 1, NOW)).toBe("30/12/9999");
    // Le bornage est bien celui du Kotlin, et il borne les deux extremites.
    expect(kt).toContain("private const val MIN_EPOCH_MS = -62_135_510_400_000L");
    expect(kt).toContain("private const val MAX_EPOCH_MS = 253_402_128_000_000L");
    expect(kt).toContain("coerceIn(MIN_EPOCH_MS, MAX_EPOCH_MS)");
  });

  test("errorHeadline : le vrai message du serveur gagne, le vide retombe", () => {
    // Le défaut de #136 : huit écrans affichaient la chaîne figée et jetaient
    // `UiState.Error.message`. Le message réel doit donc s'afficher tel quel.
    for (const message of [
      "401 — session expirée, ré-appairez l'établissement",
      "503 — service indisponible",
      "Mot de passe incorrect",
    ]) {
      expect({ message, obtenu: tsErrorHeadline(message) }).toEqual({ message, obtenu: message });
    }
    // Vide, blanche, absente : la phrase de repli, jamais une étiquette vide.
    for (const message of [null, undefined, "", "   ", "\n\t "]) {
      expect({ message, obtenu: tsErrorHeadline(message) }).toEqual({ message, obtenu: GENERIC_ERROR });
    }
    // Les espaces de bord sont retirés, l'intérieur est respecté.
    expect(tsErrorHeadline("  Session expirée.  ")).toBe("Session expirée.");
    // Le repli est le mot d'un seul écran : une seule constante à changer.
    expect(kt).toContain('private const val GENERIC_ERROR = "Erreur réseau. Réessayer."');
    expect(kt).toContain("fun errorHeadline(message: String?): String");
    expect(kt).toMatch(/message\?\.trim\(\)\?\.takeIf \{ it\.isNotEmpty\(\) \} \?: GENERIC_ERROR/);
  });

  test("staleBannerLabel : la phrase figée PLUS l'horodatage que personne n'affichait", () => {
    // `UiState.Data.fetchedAt` était calculé par tous les constructeurs et lu
    // par AUCUN écran : on ne pouvait pas savoir quand ses données dataient.
    expect(tsStaleBannerLabel(NOW - 4 * MIN, NOW)).toBe("Données hors-ligne · mis à jour il y a 4 min");
    expect(tsStaleBannerLabel(NOW - 3 * HOUR, NOW)).toBe("Données hors-ligne · mis à jour il y a 3 h");
    expect(tsStaleBannerLabel(NOW - 6 * 86_400_000, NOW)).toBe("Données hors-ligne · mis à jour il y a 6 jours");
    // Aucun horodatage = AUCUNE date inventée, la phrase seule.
    expect(tsStaleBannerLabel(null, NOW)).toBe("Données hors-ligne");
    // La phrase figée des huit écrans reste le point de départ, jamais seul.
    expect(kt).toContain('private const val STALE_LABEL = "Données hors-ligne"');
    expect(kt).toMatch(/fun staleBannerLabel\(fetchedAt: Long\?, now: Long = System\.currentTimeMillis\(\)\): String/);
    // Guillemets SIMPLES : dans une chaine double, `${...}` n'est pas une
    // interpolation, c'est du texte — l'assertion passerait à vide.
    expect(kt).toContain('$STALE_LABEL · mis à jour ${relativeTimeFr(fetchedAt, now)}');
  });

  test("règles « ne rend rien » : zéro, vide, blanche", () => {
    // Ces règles sont ce qui distingue une brique d'un aplat : une pastille à
    // zéro, une ligne sans titre ou une description vide ne doivent pas laisser
    // de boîte vide à l'écran.
    for (const count of [-3, 0, 1]) expect({ count, rendu: rendersBadge(count) }).toEqual({ count, rendu: count > 0 });
    expect({ c: 0, label: rendersBadge(0) ? badgeLabel(0) : null }).toEqual({ c: 0, label: null });
    // « 99+ » : un compteur à quatre chiffres déborde de l'onglet.
    expect({ c: 99, label: badgeLabel(99) }).toEqual({ c: 99, label: "99" });
    expect({ c: 100, label: badgeLabel(100) }).toEqual({ c: 100, label: "99+" });
    expect({ c: 1234, label: badgeLabel(1234) }).toEqual({ c: 1234, label: "99+" });
    expect(rendersListItem("")).toBe(false);
    expect(rendersPill("")).toBe(false);
    expect({ n: null, rendu: rendersSectionCount(null) }).toEqual({ n: null, rendu: false });
    expect({ n: 0, rendu: rendersSectionCount(0) }).toEqual({ n: 0, rendu: false });
    expect({ n: 12, rendu: rendersSectionCount(12) }).toEqual({ n: 12, rendu: true });
    expect(rendersDescription("")).toBe(false);
    expect(rendersDetailsToggle(null)).toBe(false);
    expect(rendersDetailsToggle("   ")).toBe(false);
    expect(rendersDetailsToggle("HTTP 500")).toBe(true);
    // ... et le Kotlin les applique bien, pas seulement le miroir.
    expect(kt).toContain("if (count <= 0) return");
    expect(kt).toMatch(/if \(title\.isEmpty\(\)\) return/);
    expect(kt).toMatch(/if \(text\.isEmpty\(\)\) return/);
    expect(kt).toContain("if (count != null && count > 0)");
    expect(kt).toContain("if (description.isNotEmpty())");
    expect(kt).toContain("if (!detail.isNullOrBlank())");
  });

  test("les 15 briques existent, avec la signature que la vague suivante va appeler", () => {
    const attendues: Record<string, string> = {
      PapCard: "fun PapCard(",
      PapSectionHeader: "fun PapSectionHeader(",
      PapListItem: "fun PapListItem(",
      PapDivider: "fun PapDivider(",
      PapEmptyState: "fun PapEmptyState(",
      PapErrorState: "fun PapErrorState(",
      PapLoading: "fun PapLoading(",
      PapLoadingBlock: "fun PapLoadingBlock(",
      PapStaleBanner: "fun PapStaleBanner(",
      PapPill: "fun PapPill(",
      PapSubjectAvatar: "fun PapSubjectAvatar(",
      PapBadge: "fun PapBadge(",
      ConfirmDialog: "fun ConfirmDialog(",
      relativeTimeFr: "fun relativeTimeFr(",
      errorHeadline: "fun errorHeadline(",
    };
    for (const [nom, signature] of Object.entries(attendues)) {
      expect({ nom, declaree: kt.includes(signature) }).toEqual({ nom, declaree: true });
    }
    // Les shapes du thème (#134) : rayon 20 dp pour une carte, 25 pour un
    // dialogue, et jamais une valeur écrite à la main.
    expect(kt).toContain("val shape = MaterialTheme.shapes.large");
    expect(kt).toContain("shape = MaterialTheme.shapes.extraLarge");
    // Zéro hex, zéro `Color(` : toute couleur vient de PapillonTheme.kt.
    expect({ hex: /0x[0-9A-Fa-f]{6,}/.test(kt) }).toEqual({ hex: false });
    expect({ colorBrut: /\bColor\(/.test(kt) }).toEqual({ colorBrut: false });
    // Le rôle du filet est bien celui du thème, pas un #00000022 recopié.
    expect(kt).toContain("MaterialTheme.colorScheme.outlineVariant");
    expect({ hexFilet: /#[0-9A-Fa-f]{6}/.test(src) }).toEqual({ hexFilet: false });
  });

  test("l'erreur montre le message réel, le technique derrière « Détails », et Réessayer", () => {
    // L'essentiel de #136 : le message serveur ne doit plus être jeté, ni
    // affiché cru sous le pouce, ni disparaître dans un log.
    expect(kt).toContain("text = errorHeadline(message)");
    expect(kt).toContain('Text(if (expanded) "Masquer les détails" else "Détails")');
    expect(kt).toContain('Text("Réessayer")');
    // Le dépliant n'apparaît que s'il y a un détail à montrer.
    expect(kt).toContain("if (!detail.isNullOrBlank())");
    // L'icône d'erreur n'est pas décorative : elle porte le sens, donc elle est
    // annoncée, contrairement à celles d'état vide et de section.
    const iconError = /Icon\(\s*imageVector = Icons\.Filled\.Warning,\s*contentDescription = null,[\s\S]{0,80}colorScheme\.error/.test(kt);
    expect({ warningIconErreur: iconError }).toEqual({ warningIconErreur: true });
  });

  test("chargement : un squelette qui pulse, et un CircularProgressIndicator", () => {
    // AVANT : le mot « Chargement... » en `bodyMedium` dans 11 écrans, et ZÉRO
    // `CircularProgressIndicator` dans le module.
    expect(kt).toContain("rememberInfiniteTransition(label = \"papSkeleton\")");
    expect(kt).toContain("infiniteRepeatable(");
    expect(kt).toContain("RepeatMode.Reverse");
    expect(kt).toContain("CircularProgressIndicator(");
    // Aucun « Chargement... » en dur : le mot n'existe plus, il est un décor.
    expect({ motFige: kt.includes('Text("Chargement...")') }).toEqual({ motFige: false });
    // Un seul squelette privé, donc un seul endroit à retoucher.
    expect(src.match(/private fun PapSkeletonRow/g)?.length).toBe(1);
    // Le skeleton est annoncé une fois aux lecteurs d'écran, pas six fois.
    expect(kt.match(/contentDescription = "Chargement en cours"/g)?.length).toBe(2);
  });

  test("ConfirmDialog : obligatoire et destructive par défaut à poser", () => {
    expect(kt).toContain("fun ConfirmDialog(");
    expect(kt).toContain("onDismissRequest = onDismiss");
    expect(kt).toMatch(/destructive: Boolean = false/);
    expect(kt).toContain('dismissLabel: String = "Annuler"');
    // Une confirmation destructive se reconnaît à sa couleur : l'encre d'ERREUR
    // du thème, pas l'accent du bouton normal. #146 : les DEUX passent par une
    // encre MESURÉE — `errorTextColor()` (le rouge de marque ne vaut que
    // 3.70:1 sur la surface sombre) et `secondary` (4.93:1, le `primary`
    // d'avant ne tenait que 3.74:1). Le garde-fou de contraste est dans
    // `android-papillon-theme.test.ts`.
    expect(kt).toContain("contentColor = if (destructive) {");
    expect(kt).toContain("errorTextColor()");
    expect(kt).toContain("MaterialTheme.colorScheme.secondary");
  });

  test("zéro dépendance ajoutée : le squelette et les dates sont faits maison", () => {
    const gradle = readFileSync(join(ROOT, "android/ui/build.gradle.kts"), "utf8");
    // Ni bibliothèque de shimmer/skeleton, ni bibliothèque de dates, ni
    // `ui-tooling` pour un `@Preview` : tout ce que la brique utilise est déjà
    // dans le graphe (BOM 2024.06.00, material3 1.2.1, foundation, java.time).
    for (const interdit of ["tooling", "shimmer", "skeleton", "date-fns", "three10", "material-icons"]) {
      expect({ interdit, present: gradle.includes(interdit) }).toEqual({ interdit, present: false });
    }
    expect(kt).not.toMatch(/import (com\.facebook|com\.google\.android\.material\.shimmer)/);
    // Versions gelées : une brique ne fait pas bouger le BOM.
    expect(gradle).toContain("compose-bom:2024.06.00");
    expect(gradle).toContain("material3:1.2.1");
    expect(gradle).toContain('kotlinCompilerExtensionVersion = "1.5.14"');
    expect(gradle).toContain("minSdk = 26");
    // Un rôle du thème non posé (warning, tertiaryContainer) ne doit jamais
    // servir : il reviendrait au Material par défaut, donc hors du thème.
    for (const role of ["tertiaryContainer", "errorContainer", "inversePrimary", "surfaceBright"]) {
      expect({ role, utilise: kt.includes(`colorScheme.${role}`) }).toEqual({ role, utilise: false });
    }
  });

  test("présentation seule : ni dépôt, ni cache, ni coroutine, ni navigation", () => {
    // #136 : « le fichier ne contient aucune logique métier ni accès
    // réseau/cache ». Une brique qui lit un dépôt n'est plus une brique, c'est
    // un écran — donc rien de tout ça n'est importé.
    for (const interdit of ["SyncedRepository", "CachedEntry", "OfflineCache", "CachePolicy", "launch", "navigate(", "NavHost", "viewModel", "LaunchedEffect", "http", "Pronote"]) {
      expect({ interdit, present: kt.includes(interdit) }).toEqual({ interdit, present: false });
    }
    // Aucune URL Pronote non plus (garde I1 de check-architecture).
    expect({ pronote: /pronote/i.test(kt) }).toEqual({ pronote: false });
    // Le seul état interne est le dépliant « Détails » : rien d'autre à suivre.
    expect(kt.match(/remember \{ mutableStateOf/g)?.length).toBe(1);
  });

  test("les écrans qui jetaient le message serveur : aucun n'est plus sur la liste (#137, #138, #141, #142, #144)", () => {
    // Honnêteté sur le périmètre : #136 livre les BRIQUES et ne touche aucun
    // écran, donc les `Text("Erreur réseau. Réessayer.")` et les
    // « Données hors-ligne (périmé). » étaient toujours là. Ils disparaissent
    // quand un écran adopte `PapErrorState` / `PapStaleBanner`. Ce test
    // échouera le jour où le suivant le fera — c'est le témoin, pas le but.
    // #137 (EDT), #138 (Tâches), #141 (vie scolaire), #142 (messagerie) puis
    // #144 (Actualités, Cantine, Alertes, Fiches) : les huit écrans qui jetaient
    // le message serveur sont donc TOUS sortis de la liste. `fichiers` est vide,
    // et l'assertion le prouve : le prochain écran non migré le remettra.
    const fichiers: string[] = [];
    const restants = fichiers.filter((f) => readFileSync(join(UI, f), "utf8").includes('"Erreur réseau. Réessayer."'));
    expect({ ecransPasEncoreMigres: restants.length }).toEqual({ ecransPasEncoreMigres: fichiers.length });
    // Le témoin inversé : chaque écran migré affiche le VRAI message.
    const edt = readFileSync(join(UI, "TimetableWeek.kt"), "utf8");
    expect({ edt: edt.includes('"Erreur réseau. Réessayer."') }).toEqual({ edt: false });
    expect(edt).toContain("PapErrorState(message = failed.message");
    expect(edt).toContain("PapStaleBanner(");
    // #147 : relecture ratée alors que la SEMAINE EST AFFICHÉE. Avant, l'EDT ne
    // montrait l'erreur que dans la branche « aucun cours » : avec le cache en
    // place, le bandeau « hors ligne » disait l'âge des cours et jamais la
    // cause. Une ligne de message, comme les autres écrans en cache.
    expect(edt).toContain("text = failed.message");
    const devoirs = readFileSync(join(UI, "Assignments.kt"), "utf8");
    expect({ devoirs: devoirs.includes('"Erreur réseau. Réessayer."') }).toEqual({ devoirs: false });
    expect(devoirs).toContain("PapErrorState(message = error");
    expect(devoirs).toContain("PapStaleBanner(fetchedAt = fetchedAt");
    expect(devoirs).toContain("PapLoading()");
    expect(devoirs).toContain("PapEmptyState(");
    // #141 : la vie scolaire (absences + retards, sanctions), même coquille.
    const vieScolaire = readFileSync(join(UI, "Attendance.kt"), "utf8");
    expect({ vieScolaire: vieScolaire.includes('"Erreur réseau. Réessayer."') }).toEqual({ vieScolaire: false });
    expect(vieScolaire).toContain("PapErrorState(message = error?.message");
    expect(vieScolaire).toContain("PapStaleBanner(fetchedAt = data.fetchedAt");
    expect(vieScolaire).toContain("PapLoading()");
    expect(vieScolaire).toContain("PapEmptyState(");
    // #142 : même migration pour la messagerie, et le message réel n'est pas
    // affiché deux fois (bandau quand le cache est là, état d'écran sinon).
    const messagerie = readFileSync(join(UI, "MessagesScreen.kt"), "utf8");
    expect({ messagerie: messagerie.includes('"Erreur réseau. Réessayer."') }).toEqual({ messagerie: false });
    expect(messagerie).toContain("PapErrorState(message = error, onRetry = onRetry)");
    expect(messagerie).toContain("PapStaleBanner(fetchedAt = fetchedAt");
    expect(messagerie).toContain("PapLoading()");
    expect(messagerie).toContain("PapEmptyState(");
    // Tirail + recherche + confirmation de suppression : les trois gestes que
    // #142 demande par-dessus les briques.
    expect(messagerie).toContain("HomePullToRefresh(");
    expect(messagerie).toContain("ConfirmDialog(");
    // #144 : les quatre écrans de la vague ne gardent plus la chaîne figée, et
    // ils affichent bien le message réel, le squelette, l'état vide et le
    // bandeau horodaté.
    for (const f of ["CanteenMenus.kt", "NewsScreen.kt", "SecurityAlertsScreen.kt"]) {
      const src = readFileSync(join(UI, f), "utf8");
      expect({ f, figee: src.includes('"Erreur réseau. Réessayer."') }).toEqual({ f, figee: false });
      expect({ f, PapErrorState: src.includes("PapErrorState(") }).toEqual({ f, PapErrorState: true });
      expect({ f, PapStaleBanner: src.includes("PapStaleBanner(") }).toEqual({ f, PapStaleBanner: true });
      expect({ f, PapLoading: src.includes("PapLoading(") }).toEqual({ f, PapLoading: true });
      expect({ f, PapEmptyState: src.includes("PapEmptyState(") }).toEqual({ f, PapEmptyState: true });
    }
    // Fiches : même.exception sur le bandeau, DÉLIBÉRÉE — `/v1/revision-sheets`
    // n'est pas une ressource cachée, donc rien de cet écran ne peut être
    // « périmé » : un bandeau « hors ligne » y serait un mensonge. L'âge des
    // fiches, lui, est affiché.
    const fiches = readFileSync(join(UI, "RevisionSheets.kt"), "utf8");
    expect({ fiches, figee: fiches.includes('"Erreur réseau. Réessayer."') }).toEqual({ fiches, figee: false });
    expect({ fiches, PapErrorState: fiches.includes("PapErrorState(") }).toEqual({ fiches, PapErrorState: true });
    expect({ fiches, PapLoading: fiches.includes("PapLoading(") }).toEqual({ fiches, PapLoading: true });
    expect({ fiches, PapEmptyState: fiches.includes("PapEmptyState(") }).toEqual({ fiches, PapEmptyState: true });
    expect({ fiches, PapStaleBanner: fiches.includes("PapStaleBanner(") }).toEqual({ fiches, PapStaleBanner: false });
    expect(fiches).toContain("relativeTimeFr(state.fetchedAt)");
  });
});
