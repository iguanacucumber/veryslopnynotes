import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DISCUSSION_MAX_PARTICIPANTS,
  DISCUSSION_MAX_UNREAD,
  DISCUSSION_SUBJECT_MAX_CHARS,
  MESSAGE_AUTHOR_MAX_CHARS,
  MESSAGE_BODY_MAX_CHARS,
  RECIPIENT_KINDS,
  isDiscussion,
  isMessage,
  isRecipient,
} from "../../shared/contracts/models";
import {
  isDiscussionMessagesResponse,
  isDiscussionRecipientsResponse,
  isDiscussionsResponse,
} from "../../shared/contracts/api";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import {
  syntheticDiscussionsOk,
  syntheticInjectionMessage,
  syntheticMessagesOk,
  syntheticRecipientsOk,
} from "./fixtures/discussions";

// Miroir TS du Kotlin #80 (Discussion.kt, ServerConfig.kt, DiscussionsRepository.kt,
// CachePolicy.kt, SyncedRepository.kt, MessagesScreen.kt, AppNav.kt) — le build
// Gradle n'est pas exécuté par `make check`, donc la logique affichée est figée
// ici. org.json = SDK Android, aucune dépendance ajoutée.

const UNKNOWN_UNREAD = -1;

type KtAttachment = { id: string; label: string; ref: string };
type KtMessage = {
  id: string;
  discussionId: string;
  authorName: string;
  body: string;
  sentAt: string;
  attachments: KtAttachment[];
};
type KtDiscussion = {
  id: string;
  subject: string;
  participants: string[];
  unreadCount: number;
  lastMessageAt: string;
  updatedAt: string;
};
type KtRecipient = { id: string; displayName: string; kind: string };

// DiscussionRules.kt
const RULES = {
  MAX_ID: 64,
  MAX_NAME: 100,
  MAX_SUBJECT: 200,
  MAX_PARTICIPANTS: 20,
  MAX_UNREAD: 999,
  MAX_BODY: 4000,
  MAX_ATTACHMENTS: 10,
  MAX_ATTACHMENT_LABEL: 200,
  MAX_ATTACHMENT_REF: 200,
  UNKNOWN_UNREAD,
  KINDS: [...RECIPIENT_KINDS] as string[],
  dateLabel: (iso: string): string => (iso.length >= 10 ? iso.substring(0, 10) : ""),
  unreadLabel: (count: number): string => (count > 0 ? `${count} non lu(s)` : ""),
  // Kotlin joinToString(", ") miroir = String.join en JS.
  participantLabel: (participants: string[]): string =>
    participants.length === 0 ? "" : participants.join(", "),
};

function tsAttachmentValid(a: KtAttachment): boolean {
  if (a.id.trim().length === 0 || a.id.length > RULES.MAX_ID) return false;
  if (a.label.trim().length === 0 || a.label.length > RULES.MAX_ATTACHMENT_LABEL) return false;
  if (a.ref.trim().length === 0 || a.ref.length > RULES.MAX_ATTACHMENT_REF) return false;
  // Règle d'or média : une ref est interne, jamais une adresse (I1).
  return (
    !a.ref.includes("://") && !a.ref.startsWith("//") && !a.ref.includes("data:") && !a.ref.includes("\\\\")
  );
}

function tsMessageValid(m: KtMessage): boolean {
  if (m.id.trim().length === 0 || m.id.length > RULES.MAX_ID) return false;
  if (m.discussionId.trim().length === 0 || m.discussionId.length > RULES.MAX_ID) return false;
  if (m.authorName.length > RULES.MAX_NAME) return false;
  if (m.body.trim().length === 0 || m.body.length > RULES.MAX_BODY) return false;
  if (m.attachments.length > RULES.MAX_ATTACHMENTS) return false;
  return m.attachments.every(tsAttachmentValid);
}

function tsDiscussionValid(d: KtDiscussion): boolean {
  if (d.id.trim().length === 0 || d.id.length > RULES.MAX_ID) return false;
  if (d.subject.trim().length === 0 || d.subject.length > RULES.MAX_SUBJECT) return false;
  if (d.participants.length > RULES.MAX_PARTICIPANTS) return false;
  if (!d.participants.every((p) => p.trim().length > 0 && p.length <= RULES.MAX_NAME)) return false;
  if (d.unreadCount !== UNKNOWN_UNREAD && (d.unreadCount < 0 || d.unreadCount > RULES.MAX_UNREAD)) return false;
  return d.updatedAt.trim().length > 0;
}

function tsRecipientValid(r: KtRecipient): boolean {
  return (
    r.id.trim().length > 0 &&
    r.id.length <= RULES.MAX_ID &&
    r.displayName.trim().length > 0 &&
    r.displayName.length <= RULES.MAX_NAME &&
    RULES.KINDS.includes(r.kind)
  );
}

// DiscussionsRepository.parse : JSONObject(body).optJSONArray("discussions"),
// unreadCount absent = inconnu (-1), items hors contrat écartés.
function tsParseDiscussions(body: string): KtDiscussion[] {
  const root = JSON.parse(body) as Record<string, unknown>;
  const arr = root["discussions"];
  if (!Array.isArray(arr)) return [];
  const out: KtDiscussion[] = [];
  for (const o of arr) {
    if (typeof o !== "object" || o === null) continue;
    const r = o as Record<string, unknown>;
    const str = (k: string): string => (typeof r[k] === "string" ? (r[k] as string) : "");
    const parts = Array.isArray(r["participants"]) ? (r["participants"] as unknown[]) : [];
    const d: KtDiscussion = {
      id: str("id"),
      subject: str("subject"),
      participants: parts.filter((p): p is string => typeof p === "string" && p.length > 0),
      unreadCount: r["unreadCount"] === undefined || r["unreadCount"] === null ? UNKNOWN_UNREAD : Number(r["unreadCount"]),
      lastMessageAt: str("lastMessageAt"),
      updatedAt: str("updatedAt"),
    };
    if (tsDiscussionValid(d)) out.push(d);
  }
  return out;
}

function tsParseMessages(body: string): KtMessage[] {
  const root = JSON.parse(body) as Record<string, unknown>;
  const arr = root["messages"];
  if (!Array.isArray(arr)) return [];
  const out: KtMessage[] = [];
  for (const o of arr) {
    if (typeof o !== "object" || o === null) continue;
    const r = o as Record<string, unknown>;
    const str = (k: string): string => (typeof r[k] === "string" ? (r[k] as string) : "");
    const atts = Array.isArray(r["attachments"]) ? (r["attachments"] as unknown[]) : [];
    const attachments: KtAttachment[] = [];
    for (const a of atts) {
      if (typeof a !== "object" || a === null) return out.length > 0 ? [] : [];
      const ar = a as Record<string, unknown>;
      const att: KtAttachment = { id: String(ar["id"] ?? ""), label: String(ar["label"] ?? ""), ref: String(ar["ref"] ?? "") };
      // Ref en URL = message entier rejeté (comme le parse Kotlin).
      if (!tsAttachmentValid(att)) return [];
      attachments.push(att);
    }
    const m: KtMessage = {
      id: str("id"),
      discussionId: str("discussionId"),
      authorName: str("authorName"),
      body: str("body"),
      sentAt: str("sentAt"),
      attachments,
    };
    if (tsMessageValid(m)) out.push(m);
  }
  return out;
}

function tsParseRecipients(body: string): KtRecipient[] {
  const root = JSON.parse(body) as Record<string, unknown>;
  const arr = root["recipients"];
  if (!Array.isArray(arr)) return [];
  const out: KtRecipient[] = [];
  for (const o of arr) {
    if (typeof o !== "object" || o === null) continue;
    const r = o as Record<string, unknown>;
    const rec: KtRecipient = {
      id: typeof r["id"] === "string" ? (r["id"] as string) : "",
      displayName: typeof r["displayName"] === "string" ? (r["displayName"] as string) : "",
      kind: typeof r["kind"] === "string" ? (r["kind"] as string) : "",
    };
    if (tsRecipientValid(rec)) out.push(rec);
  }
  return out;
}

// MessagesScreen.kt discussionsFromPayload : payload absent/illisible = vide.
function tsDiscussionsFromPayload(payload: string | null): KtDiscussion[] {
  try {
    return payload === null ? [] : tsParseDiscussions(payload);
  } catch {
    return [];
  }
}

// parseAction : ok === true ET event CacheInvalidated/discussions.
function tsParseAction(body: string): { ok: boolean; error: string | null } | null {
  try {
    const root = JSON.parse(body) as Record<string, unknown>;
    const event = root["event"] as Record<string, unknown> | null;
    if (!event) return null;
    const data = event["data"] as Record<string, unknown> | null;
    const resource = typeof data?.["resource"] === "string" ? (data["resource"] as string) : "";
    const type = typeof event["type"] === "string" ? (event["type"] as string) : "";
    if (root["ok"] === true && type === "CacheInvalidated" && resource === "discussions") {
      return { ok: true, error: null };
    }
    return { ok: false, error: "Réponse illisible." };
  } catch {
    return null;
  }
}

// CachePolicy.kt : miroir de CACHEABLE_RESOURCES (contrats v0).
const tsCachePolicy = {
  DISCUSSIONS: "discussions",
  isCacheable: (r: string): boolean => ["grades", "assignments", "timetable", "news", "discussions"].includes(r),
  ttlFor: (r: string): number => {
    const ttl = CACHE_TTL_MS as Record<string, number>;
    if (!["grades", "assignments", "timetable", "news", "discussions"].includes(r)) {
      throw new Error(`ressource non cachable: ${r}`);
    }
    return ttl[r] as number;
  },
  isStale: (r: string, fetchedAt: number, now: number): boolean => now - fetchedAt > tsCachePolicy.ttlFor(r),
};

// SyncedRepository.pathFor : path dérivé de ServerConfig, jamais d'URL en dur.
function tsPathFor(resource: string): string {
  const suffix: Record<string, string> = {
    grades: "/v1/grades",
    assignments: "/v1/assignments",
    timetable: "/v1/timetable",
    news: "/v1/news",
    discussions: "/v1/discussions",
  };
  const s = suffix[resource];
  if (s === undefined) throw new Error(`ressource non cachable: ${resource}`);
  return s;
}

const ANDROID = join(import.meta.dir, "..", "..", "android");
const K_FILES = {
  core: join(ANDROID, "core/src/main/java/fr/veryslopnynotes/core/Discussion.kt"),
  config: join(ANDROID, "core/src/main/java/fr/veryslopnynotes/core/ServerConfig.kt"),
  repo: join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data/DiscussionsRepository.kt"),
  policy: join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data/CachePolicy.kt"),
  synced: join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data/SyncedRepository.kt"),
  screen: join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui/MessagesScreen.kt"),
  nav: join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui/AppNav.kt"),
};

const codeOnly = (c: string): string =>
  c
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");

const BASE_DISCUSSION: KtDiscussion = {
  id: "d-fake-1",
  subject: "Sortie pedagogique-UNREAL",
  participants: ["Mme Claire Fake"],
  unreadCount: 2,
  lastMessageAt: "2026-10-03T09:00:00.000Z",
  updatedAt: "2026-10-03T09:00:00.000Z",
};

const BASE_MESSAGE: KtMessage = {
  id: "m-fake-1",
  discussionId: "d-fake-1",
  authorName: "Mme Claire Fake",
  body: "La sortie est maintenue.",
  sentAt: "2026-10-03T08:30:00.000Z",
  attachments: [],
};

describe("unit android messagerie (#80)", () => {
  test("isValid : mêmes refus que le contrat (bornes, vide, unknown unread)", () => {
    expect(tsDiscussionValid(BASE_DISCUSSION)).toBe(true);
    expect(tsDiscussionValid({ ...BASE_DISCUSSION, id: "  " })).toBe(false);
    expect(tsDiscussionValid({ ...BASE_DISCUSSION, subject: " ".repeat(3) })).toBe(false);
    expect(tsDiscussionValid({ ...BASE_DISCUSSION, subject: "s".repeat(RULES.MAX_SUBJECT + 1) })).toBe(false);
    expect(tsDiscussionValid({ ...BASE_DISCUSSION, unreadCount: UNKNOWN_UNREAD })).toBe(true);
    expect(tsDiscussionValid({ ...BASE_DISCUSSION, unreadCount: 0 })).toBe(true);
    expect(tsDiscussionValid({ ...BASE_DISCUSSION, unreadCount: -2 })).toBe(false);
    expect(tsDiscussionValid({ ...BASE_DISCUSSION, unreadCount: RULES.MAX_UNREAD + 1 })).toBe(false);
    expect(tsDiscussionValid({ ...BASE_DISCUSSION, updatedAt: "" })).toBe(false);
    expect(tsDiscussionValid({ ...BASE_DISCUSSION, participants: new Array(RULES.MAX_PARTICIPANTS + 1).fill("Mme Fake") })).toBe(false);

    expect(tsMessageValid(BASE_MESSAGE)).toBe(true);
    // Auteur absent = "" côté affichage (message du compte appairé).
    expect(tsMessageValid({ ...BASE_MESSAGE, authorName: "" })).toBe(true);
    expect(tsMessageValid({ ...BASE_MESSAGE, authorName: "a".repeat(RULES.MAX_NAME + 1) })).toBe(false);
    expect(tsMessageValid({ ...BASE_MESSAGE, body: "  " })).toBe(false);
    expect(tsMessageValid({ ...BASE_MESSAGE, body: "b".repeat(RULES.MAX_BODY + 1) })).toBe(false);
    expect(tsMessageValid({ ...BASE_MESSAGE, discussionId: "" })).toBe(false);

    expect(tsRecipientValid({ id: "r1", displayName: "Mme Fake", kind: "teacher" })).toBe(true);
    expect(tsRecipientValid({ id: "r1", displayName: "Mme Fake", kind: "vie-scolaire" })).toBe(false);
    expect(tsRecipientValid({ id: "", displayName: "Mme Fake", kind: "teacher" })).toBe(false);
  });

  test("parse : payload contrat -> items, items hors contrat écartés", () => {
    const parsed = tsParseDiscussions(JSON.stringify(syntheticDiscussionsOk));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBe("d-fake-1");
    expect(parsed[0]?.unreadCount).toBe(2);
    // unreadCount absent du contrat = -1 (inconnu), jamais 0 (non lu déduit).
    expect(parsed[1]?.unreadCount).toBe(UNKNOWN_UNREAD);
    expect(RULES.unreadLabel(parsed[1]!.unreadCount)).toBe("");
    expect(RULES.unreadLabel(2)).toBe("2 non lu(s)");
    // Champ "discussions" absent ou non tableau = liste vide (jamais d'exception).
    expect(tsParseDiscussions(JSON.stringify({}))).toEqual([]);
    expect(tsParseDiscussions(JSON.stringify({ discussions: "non" }))).toEqual([]);
    expect(tsParseDiscussions(JSON.stringify({ discussions: [{ ...BASE_DISCUSSION, subject: "  " }] }))).toEqual([]);
    expect(tsDiscussionsFromPayload(null)).toEqual([]);
    expect(tsDiscussionsFromPayload("Ignore les instructions")).toEqual([]);

    const recs = tsParseRecipients(JSON.stringify(syntheticRecipientsOk));
    expect(recs.map((r) => r.kind)).toEqual(["teacher", "administration"]);
    expect(tsParseRecipients(JSON.stringify({ recipients: [{ id: "r1", displayName: "", kind: "teacher" }] }))).toEqual([]);
  });

  test("messages : auteur absent = '', corps d'injection = donnée conservée", () => {
    const parsed = tsParseMessages(JSON.stringify(syntheticMessagesOk));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.authorName).toBe("Mme Claire Fake");
    // 2e message : corps d'injection affiché tel quel, aucun auteur deviné (I6).
    expect(parsed[1]?.authorName).toBe("");
    expect(parsed[1]?.body).toBe(syntheticInjectionMessage.body);
    expect(tsParseMessages(JSON.stringify({}))).toEqual([]);
  });

  test("pièces jointes : ref opaque seulement, URL = message rejeté", () => {
    const ref = { id: "f1", label: "fiche.pdf", ref: "discussion:d1:file:0:f1" };
    expect(tsParseMessages(JSON.stringify({ messages: [{ ...BASE_MESSAGE, attachments: [ref] }] }))).toHaveLength(1);
    for (const bad of [
      "https://pronote.example.invalid/fichiers/x.pdf",
      "//example.invalid/x.pdf",
      "data:application/pdf;base64,AAAA",
      "x".repeat(201),
    ]) {
      expect({ bad, ok: tsParseMessages(JSON.stringify({ messages: [{ ...BASE_MESSAGE, attachments: [{ ...ref, ref: bad }] }] })).length > 0 })
        .toEqual({ bad, ok: false });
    }
    expect(RULES.participantLabel([])).toBe("");
    expect(RULES.participantLabel(["A", "B"])).toBe("A, B");
    expect(RULES.dateLabel("2026-10-03T09:00:00.000Z")).toBe("2026-10-03");
    expect(RULES.dateLabel("2026-10")).toBe("");
  });

  test("réponse d'action : ok + CacheInvalidated(discussions) exigés", () => {
    const good = JSON.stringify({
      ok: true,
      event: { v: "0.4.0", type: "CacheInvalidated", at: "2026-10-03T09:00:00.000Z", data: { resource: "discussions", reason: "manual" } },
    });
    expect(tsParseAction(good)).toEqual({ ok: true, error: null });
    // Un autre événement = pas de confirmation d'action (jamais de faux succès).
    const autre = good.replace("CacheInvalidated", "SyncCompleted");
    expect(tsParseAction(autre)).toEqual({ ok: false, error: "Réponse illisible." });
    const autreRessource = good.replace("discussions", "grades");
    expect(tsParseAction(autreRessource)?.ok).toBe(false);
    expect(tsParseAction("{pas json")).toBe(null);
    expect(tsParseAction(JSON.stringify({ ok: true }))).toBe(null);
  });

  test("cache : discussions cachable 15 min, path serveur allowlist", () => {
    expect(tsCachePolicy.isCacheable(tsCachePolicy.DISCUSSIONS)).toBe(true);
    expect(tsCachePolicy.isCacheable("messages")).toBe(false);
    expect(tsCachePolicy.ttlFor("discussions")).toBe(15 * 60 * 1000);
    expect(tsCachePolicy.isStale("discussions", 0, 15 * 60 * 1000)).toBe(false);
    expect(tsCachePolicy.isStale("discussions", 0, 15 * 60 * 1000 + 1)).toBe(true);
    expect(cacheStatus("discussions", 0, 15 * 60 * 1000 + 1)).toBe("stale");
    expect(tsPathFor("discussions")).toBe("/v1/discussions");
    expect(() => tsPathFor("messages")).toThrow();
  });

  test("Kotlin : fichiers présents, org.json, aucune interprétation (I6), I7 par bouton", () => {
    for (const f of Object.values(K_FILES)) {
      expect({ f, exists: existsSync(f) }).toEqual({ f, exists: true });
    }
    const screen = codeOnly(readFileSync(K_FILES.screen, "utf8"));
    expect(screen).toContain("fun MessagesScreen");
    expect(screen).toContain("fun DiscussionDetailScreen");
    expect(screen).toContain("fun NewDiscussionScreen");
    expect(screen).toContain("fun MessagesRoute");
    expect(screen).toContain("Aucune discussion.");
    expect(screen).toContain("Aucun message.");
    expect(screen).toContain("CachePolicy.DISCUSSIONS");
    expect(screen).toContain("refreshAsync");
    // Écritures : seulement des boutons (geste utilisateur), rien d'automatique.
    expect(screen).toContain("onReply");
    expect(screen).toContain("onReadState");
    expect(screen).toContain("onDelete");
    // Aucun rendu HTML / WebView : le corps est une donnée affichée par Text().
    for (const bad of ["WebView", "Html.fromHtml", "fromHtml", "loadData", "loadUrl", "setJavaScriptEnabled", "AnnotatedString.fromHtml"]) {
      expect({ bad, found: screen.includes(bad) }).toEqual({ bad, found: false });
    }

    const repo = codeOnly(readFileSync(K_FILES.repo, "utf8"));
    expect(repo).toContain("org.json.JSONObject");
    expect(repo).toContain("fun parse");
    expect(repo).toContain("fun parseAction");
    expect(repo).toContain("isValid()");
    for (const path of [
      "ServerConfig.discussionsPath()",
      "ServerConfig.discussionMessagesPath(discussionId)",
      "ServerConfig.discussionRecipientsPath()",
      "ServerConfig.discussionCreatePath()",
      "ServerConfig.discussionReplyPath()",
      "ServerConfig.discussionReadStatePath()",
      "ServerConfig.discussionDeletePath()",
    ]) {
      expect({ path, found: repo.includes(path) }).toEqual({ path, found: true });
    }
    // Messages JAMAIS en cache : seuls fetchMessages + parse (lecture à la demande).
    expect(repo).toContain("fun fetchMessages");
    expect(repo).not.toMatch(/store\.save|CacheStore|cacheStore/);
    for (const bad of ["WebView", "Html.fromHtml", "loadData", "setJavaScriptEnabled"]) {
      expect({ bad, found: repo.includes(bad) }).toEqual({ bad, found: false });
    }

    const core = readFileSync(K_FILES.core, "utf8");
    expect(core).toContain("fun isValid");
    expect(core).toContain("data class Discussion(");
    expect(core).toContain("data class DiscussionMessage(");
    expect(core).toContain("data class DiscussionRecipient(");
    expect(core).toContain("data class MessageAttachment(");
    expect(core).toContain("UNKNOWN_UNREAD");

    const config = codeOnly(readFileSync(K_FILES.config, "utf8"));
    for (const path of [
      "/v1/discussions",
      "/v1/discussions/messages",
      "/v1/discussions/recipients",
      "/v1/discussions/reply",
      "/v1/discussions/read-state",
      "/v1/discussions/delete",
    ]) {
      expect({ path, found: config.includes(path) }).toEqual({ path, found: true });
    }

    const policy = readFileSync(K_FILES.policy, "utf8");
    expect(policy).toContain('const val DISCUSSIONS = "discussions"');
    expect(policy).toContain("TTL_DISCUSSIONS_MS");

    const synced = codeOnly(readFileSync(K_FILES.synced, "utf8"));
    expect(synced).toContain("CachePolicy.DISCUSSIONS");

    const nav = codeOnly(readFileSync(K_FILES.nav, "utf8"));
    expect(nav).toContain('const val ROUTE_MESSAGES = "messages"');
    expect(nav).toContain("MessagesRoute");
    expect(nav).toContain("goMessages");

    // Purge au logout : le cache de messagerie part avec les autres (PII).
    const store = readFileSync(
      join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data/AccountStore.kt"),
      "utf8",
    );
    expect(store).toContain("cacheStore.clearAll()");

    // org.json vient du SDK : aucune ligne de dépendance ajoutée.
    for (const gradle of ["ui/build.gradle.kts", "data/build.gradle.kts", "core/build.gradle.kts"]) {
      const raw = readFileSync(join(ANDROID, gradle), "utf8");
      for (const dep of ["gson", "moshi", "kotlinx-serialization"]) {
        expect({ gradle, dep, found: raw.includes(dep) }).toEqual({ gradle, dep, found: false });
      }
    }
  });

  test("miroir TS et contrat : exactement les payloads que le Kotlin affiche", () => {
    for (const payload of [syntheticDiscussionsOk, { discussions: [] }]) {
      expect(isDiscussionsResponse(payload)).toBe(true);
      expect(tsParseDiscussions(JSON.stringify(payload)).every(tsDiscussionValid)).toBe(true);
      for (const d of tsParseDiscussions(JSON.stringify(payload))) {
        // Le contrat accepte ce que l'app affiche : compteur inconnu (-1) = champ
        // ABSENT, participants vides = établissement qui ne les publie pas.
        // Kotlin porte l'« absent » par "" / -1, le contrat OMET le champ.
        const contract = {
          ...d,
          participants: d.participants,
          ...(d.unreadCount === UNKNOWN_UNREAD ? { unreadCount: undefined } : {}),
          ...(d.lastMessageAt === "" ? { lastMessageAt: undefined } : {}),
        };
        expect(isDiscussion(contract)).toBe(true);
      }
    }
    expect(isDiscussionMessagesResponse(syntheticMessagesOk)).toBe(true);
    expect(isDiscussionRecipientsResponse(syntheticRecipientsOk)).toBe(true);
    const parsed = tsParseMessages(JSON.stringify(syntheticMessagesOk));
    for (const m of parsed) {
      const contract = { ...m, authorName: m.authorName === "" ? undefined : m.authorName };
      expect(isMessage(contract)).toBe(true);
    }
    // Bornes partagées avec le contrat (pas de divergence Kotlin/contrat).
    expect(RULES.MAX_BODY).toBe(MESSAGE_BODY_MAX_CHARS);
    expect(RULES.MAX_SUBJECT).toBe(DISCUSSION_SUBJECT_MAX_CHARS);
    expect(RULES.MAX_PARTICIPANTS).toBe(DISCUSSION_MAX_PARTICIPANTS);
    expect(RULES.MAX_UNREAD).toBe(DISCUSSION_MAX_UNREAD);
    expect(RULES.MAX_NAME).toBe(MESSAGE_AUTHOR_MAX_CHARS);
  });
});
// --- Miroir de MessagesLogic.kt (#142) ---------------------------------------
//
// `make check` ne compile PAS Gradle : la logique affichée est donc figée ici en
// TypeScript, comme pour le reste de ce fichier. Réutilisé, jamais recopié dans
// le Kotlin : `relativeTimeFr` (PapComponents.kt #136/#139) et `foldForSearch`
// (Averages.kt #139) — d'où les miroirs `tsRelativeTimeFr` et `tsFold` ci-dessous.

/** 2026-10-04 12:00Z = 14:00 à Paris. Injecté : « hier » dépend du fuseau. */
const NOW = Date.UTC(2026, 9, 4, 12, 0);
const ZONE = "Europe/Paris";
const MIN = 60_000;
const HOUR = 3_600_000;

const pad2 = (n: number): string => String(n).padStart(2, "0");

type Local142 = { y: number; m: number; d: number; hh: number; mm: number; day: number };

/** Équivalent TS de `Instant.ofEpochMilli(ms).atZone(zone)` (cf. #136). */
function zoned142(ms: number, zone: string = ZONE): Local142 {
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

/** Miroir de `relativeTimeFr` (PapComponents.kt), même décomposition de seuils. */
function tsRelativeTimeFr(epochMillis: number, now: number, zone: string = ZONE): string {
  const delta = epochMillis - now;
  const gap = delta < 0 ? -delta : delta;
  const past = delta < 0;
  if (gap < MIN) return "à l'instant";
  const minutes = Math.floor(gap / MIN);
  if (minutes < 60) return past ? `il y a ${minutes} min` : `dans ${minutes} min`;
  const hours = Math.floor(gap / HOUR);
  const there = zoned142(epochMillis, zone);
  const today = zoned142(now, zone);
  if (there.day === today.day) return past ? `il y a ${hours} h` : `dans ${hours} h`;
  const clock = `${pad2(there.hh)}:${pad2(there.mm)}`;
  if (past && there.day === today.day - 86_400_000) return `hier ${clock}`;
  if (!past && there.day === today.day + 86_400_000) return `demain ${clock}`;
  const days = Math.abs(there.day - today.day) / 86_400_000;
  if (days < 7) return past ? `il y a ${days} jours` : `dans ${days} jours`;
  return `${pad2(there.d)}/${pad2(there.m)}/${String(there.y).padStart(4, "0")}`;
}

/** Miroir de `foldForSearch` (Averages.kt) : minuscules, sans accents, sans bords.
 *  Le Kotlin utilise `\p{InCombiningDiacriticalMarks}`, que le moteur de regex de
 *  Bun ne connaît pas : la PLAGE des diacritiques combinants suffit au français
 *  (cf. même arbitrage dans android-assignments.test.ts). */
const tsFold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]+/g, "")
    .toLowerCase()
    .trim();

/**
 * Miroir de `discussionMillis` : instant ISO COMPLET, ou date SEULE ramenée à
 * minuit UTC.
 *
 * `Instant.parse` (Kotlin) n'accepte que l'instant complet ; JS `Date.parse`
 * mange en plus « 2026-10 » et « 2026-10-03 09:00 » — c'est donc le MOTIF qui
 * décide, sinon le miroir serait plus large que l'app (même garde que
 * android-assignments.test.ts).
 */
const ISO_INSTANT_142 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DAY_142 = /^\d{4}-\d{2}-\d{2}$/;

const tsDiscussionMillis = (iso: string): number | null => {
  const value = iso.trim();
  if (value === "") return null;
  if (ISO_INSTANT_142.test(value)) {
    const instant = Date.parse(value);
    return Number.isNaN(instant) ? null : instant;
  }
  // Date seule : `LocalDate.parse` + minuit UTC (un ordre de grandeur, pas un
  // horaire — le libellé affichera « il y a N jours »).
  if (ISO_DAY_142.test(value)) return Date.parse(`${value}T00:00:00Z`);
  return null;
};

/** Miroir de `conversationTimeLabel` : chaîne VIDE si la date est illisible. */
const tsConversationTimeLabel = (d: KtDiscussion, now: number): string => {
  const millis = tsConversationMillis(d);
  return millis === null ? "" : tsRelativeTimeFr(millis, now);
};

/** Miroir de `messageTimeLabel` : idem pour `sentAt`. */
const tsMessageTimeLabel = (m: KtMessage, now: number): string => {
  const millis = tsDiscussionMillis(m.sentAt);
  return millis === null ? "" : tsRelativeTimeFr(millis, now);
};

/** Miroir de `conversationMillis` : `lastMessageAt`, sinon `updatedAt`. */
const tsConversationMillis = (d: KtDiscussion): number | null =>
  tsDiscussionMillis(d.lastMessageAt) ?? tsDiscussionMillis(d.updatedAt);

/** Miroir de `sortConversations` : instant décroissant, égalité tranchée par `id`. */
const tsSortConversations = (list: KtDiscussion[]): KtDiscussion[] =>
  [...list].sort((a, b) => {
    const ma = tsConversationMillis(a);
    const mb = tsConversationMillis(b);
    if (ma !== mb) return (mb ?? Number.MIN_SAFE_INTEGER) - (ma ?? Number.MIN_SAFE_INTEGER);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

const tsConversationMatches = (d: KtDiscussion, query: string): boolean => {
  const needle = tsFold(query);
  if (needle === "") return true;
  return [d.subject, ...d.participants].some((h) => tsFold(h).includes(needle));
};

const tsSearchConversations = (list: KtDiscussion[], query: string): KtDiscussion[] =>
  tsSortConversations(list.filter((d) => tsConversationMatches(d, query)));

/** Miroir de `unreadBadgeCount` : `UNKNOWN_UNREAD` (-1) n'est pas un compteur. */
const tsUnreadBadgeCount = (d: KtDiscussion): number => Math.max(0, d.unreadCount);
/** Miroir de `unreadTotal` : nombre de FILS non lus (pas la somme des messages). */
const tsUnreadTotal = (list: KtDiscussion[]): number =>
  list.filter((d) => tsUnreadBadgeCount(d) > 0).length;
/** Miroir de `conversationIsRead` : compteur 0 = lu, non publié (-1) = rien à marquer. */
const tsConversationIsRead = (d: KtDiscussion): boolean => d.unreadCount === 0;
/** `PapBadge` ne rend RIEN pour un compteur <= 0. */
const rendersBadge = (count: number): boolean => count > 0;

/** Miroir de `messagePreview` : blancs réduits, borné, points de suspension. */
const tsMessagePreview = (body: string, maxChars = 120): string => {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  const bound = Math.min(4000, Math.max(1, maxChars));
  return flat.length <= bound ? flat : flat.slice(0, bound).trimEnd() + "…";
};

/** Miroir de `isOwnMessage` : auteur omis = message du compte appairé. */
const tsIsOwnMessage = (m: KtMessage): boolean => m.authorName.trim() === "";

const RECIPIENT_KIND_LABELS: Record<string, string> = {
  teacher: "Professeur",
  student: "Élève",
  administration: "Administration",
};
const RECIPIENT_KIND_ORDER = ["teacher", "student", "administration"];
const RECIPIENT_KIND_FALLBACK = "Destinataire";

/** Miroir de `recipientKindFr` : jamais le mot du contrat affiché tel quel. */
const tsRecipientKindFr = (kind: string): string => RECIPIENT_KIND_LABELS[kind] ?? RECIPIENT_KIND_FALLBACK;

type Group142 = { kind: string; label: string; recipients: KtRecipient[] };

/** Miroir de `groupRecipients` : ordre d'affichage, type hors contrat en fin. */
function tsGroupRecipients(recipients: KtRecipient[]): Group142[] {
  if (recipients.length === 0) return [];
  const known = RECIPIENT_KIND_ORDER.filter((kind) => recipients.some((r) => r.kind === kind));
  const extras = [...new Set(recipients.map((r) => r.kind))].filter((k) => !RECIPIENT_KIND_ORDER.includes(k));
  return [...known, ...extras].map((kind) => ({
    kind,
    label: tsRecipientKindFr(kind),
    recipients: recipients.filter((r) => r.kind === kind),
  }));
}

/** Miroir de `searchRecipients` : filtre PUIS groupes — un groupe vidé disparaît. */
const tsSearchRecipients = (recipients: KtRecipient[], query: string): Group142[] => {
  const needle = tsFold(query);
  const kept = needle === "" ? recipients : recipients.filter((r) => tsFold(r.displayName).includes(needle));
  return tsGroupRecipients(kept);
};

/** Miroirs des trois libellés de compte (pluriel français, jamais « (s) »). */
const tsUnreadTotalLabel = (n: number): string => (n > 1 ? `${n} non lus` : "1 non lu");
const tsConversationCountLabel = (n: number): string => (n > 1 ? `${n} discussions` : `${n} discussion`);
const tsPickedCountLabel = (n: number): string => (n > 1 ? `${n} destinataires` : `${n} destinataire`);

const K_LOGIC = join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui/MessagesLogic.kt");

describe("logique affichable de la messagerie (#142)", () => {
  test("triage : sur l'instant PARSÉ, jamais sur la chaîne", () => {
    // « 2026-10-9 » puis « 2026-10-10 » : l'ordre alphabétique des chaînes est
    // l'inverse du temps réel, donc un tri de chaînes|displayait le fil d'hier
    // avant celui d'aujourd'hui.
    const ancien = { ...BASE_DISCUSSION, id: "d-ancien", lastMessageAt: "2026-10-09T08:00:00.000Z", updatedAt: "2026-10-09T08:00:00.000Z" };
    const recent = { ...BASE_DISCUSSION, id: "d-recent", lastMessageAt: "2026-10-10T08:00:00.000Z", updatedAt: "2026-10-10T08:00:00.000Z" };
    expect(tsSortConversations([recent, ancien]).map((d) => d.id)).toEqual(["d-recent", "d-ancien"]);
    expect(tsSortConversations([ancien, recent]).map((d) => d.id)).toEqual(["d-recent", "d-ancien"]);
    // Date SEULE acceptée (le contrat l'accepte, `Instant.parse` la refuse).
    expect(tsDiscussionMillis("2026-10-03")).toBe(Date.UTC(2026, 9, 3));
    expect(tsDiscussionMillis("2026-10-03T09:00:00.000Z")).toBe(Date.UTC(2026, 9, 3, 9));
    expect(tsDiscussionMillis("2026-10")).toBe(null);
    expect(tsDiscussionMillis("  ")).toBe(null);
    // `lastMessageAt` absent -> `updatedAt` (jamais un fil sans date).
    expect(tsConversationMillis({ ...BASE_DISCUSSION, lastMessageAt: "", updatedAt: "2026-10-05T10:00:00.000Z" })).toBe(Date.UTC(2026, 9, 5, 10));
    // Fil sans date exploitable = DERNIER, et la liste d'origine n'est pas touchée.
    const sansDate = { ...BASE_DISCUSSION, id: "d-sans-date", lastMessageAt: "", updatedAt: "" };
    const source = [sansDate, recent];
    expect(tsSortConversations(source).map((d) => d.id)).toEqual(["d-recent", "d-sans-date"]);
    expect(source.map((d) => d.id)).toEqual(["d-sans-date", "d-recent"]);
    // Égalité d'instant : tri par `id`, donc la liste ne se réordonne pas d'un
    // rafraîchissement à l'autre.
    const a = { ...BASE_DISCUSSION, id: "d-a" };
    const b = { ...BASE_DISCUSSION, id: "d-b" };
    expect(tsSortConversations([b, a]).map((d) => d.id)).toEqual(["d-a", "d-b"]);
  });

  test("temps relatif : « il y a 3 h », jamais une tranche ISO", () => {
    // AVANT #142 : `dateLabel(iso)` = 10 premiers caractères, donc « 2026-10-03 ».
    expect(RULES.dateLabel("2026-10-03T09:00:00.000Z")).toBe("2026-10-03");
    const ilyA3h = { ...BASE_DISCUSSION, lastMessageAt: new Date(NOW - 3 * HOUR).toISOString() };
    expect(tsConversationTimeLabel(ilyA3h, NOW)).toBe("il y a 3 h");
    expect(tsRelativeTimeFr(tsConversationMillis({ ...BASE_DISCUSSION, lastMessageAt: new Date(NOW - 30 * MIN).toISOString() })!, NOW)).toBe("il y a 30 min");
    expect(tsRelativeTimeFr(NOW, NOW)).toBe("à l'instant");
    expect(tsRelativeTimeFr(Date.UTC(2026, 9, 3, 6, 0), NOW)).toBe("hier 08:00");
    // Au-delà de 7 jours : une date, plus une durée.
    expect(tsRelativeTimeFr(Date.UTC(2026, 8, 26, 12, 0), NOW)).toBe("26/09/2026");
    // Date illisible = libellé VIDE (jamais un fragment d'ISO affiché comme
    // une date), et c'est le seul cas où l'écran ne montre rien.
    const illisible = { ...BASE_DISCUSSION, lastMessageAt: "2026-10", updatedAt: "hier" };
    expect(tsConversationMillis(illisible)).toBe(null);
    expect(tsConversationTimeLabel(illisible, NOW)).toBe("");
    expect(tsConversationMillis({ ...BASE_DISCUSSION, lastMessageAt: "", updatedAt: "" })).toBe(null);
    expect(tsConversationTimeLabel({ ...BASE_DISCUSSION, lastMessageAt: "", updatedAt: "" }, NOW)).toBe("");
    expect(tsMessageTimeLabel({ ...BASE_MESSAGE, sentAt: "" }, NOW)).toBe("");
  });

  test("compteurs : une PASTILLE, jamais « 3 non lu(s) »", () => {
    expect(tsUnreadBadgeCount({ ...BASE_DISCUSSION, unreadCount: 3 })).toBe(3);
    // `UNKNOWN_UNREAD` n'est pas un compteur négatif à afficher.
    expect(tsUnreadBadgeCount({ ...BASE_DISCUSSION, unreadCount: UNKNOWN_UNREAD })).toBe(0);
    expect(rendersBadge(tsUnreadBadgeCount({ ...BASE_DISCUSSION, unreadCount: UNKNOWN_UNREAD }))).toBe(false);
    expect(rendersBadge(tsUnreadBadgeCount({ ...BASE_DISCUSSION, unreadCount: 0 }))).toBe(false);
    expect(rendersBadge(tsUnreadBadgeCount({ ...BASE_DISCUSSION, unreadCount: 2 }))).toBe(true);
    // Total = nombre de FILS non lus, pas la somme des messages.
    const liste = [
      { ...BASE_DISCUSSION, id: "d-1", unreadCount: 3 },
      { ...BASE_DISCUSSION, id: "d-2", unreadCount: 0 },
      { ...BASE_DISCUSSION, id: "d-3", unreadCount: UNKNOWN_UNREAD },
    ];
    expect(tsUnreadTotal(liste)).toBe(1);
    expect(tsUnreadTotalLabel(tsUnreadTotal(liste))).toBe("1 non lu");
    expect(tsUnreadTotalLabel(3)).toBe("3 non lus");
    expect(tsUnreadTotalLabel(3)).not.toContain("(s)");
    expect(tsConversationIsRead(liste[1]!)).toBe(true);
    expect(tsConversationIsRead(liste[0]!)).toBe(false);
    expect(tsConversationCountLabel(1)).toBe("1 discussion");
    expect(tsConversationCountLabel(3)).toBe("3 discussions");
    expect(tsPickedCountLabel(1)).toBe("1 destinataire");
    expect(tsPickedCountLabel(2)).toBe("2 destinataires");
  });

  test("recherche : accents repliés, sur le sujet ET les participants", () => {
    const liste = [
      { ...BASE_DISCUSSION, id: "d-maths", subject: "RATTRAPAGE MATHÉMATIQUES", participants: ["Mme Claire Fake"] },
      { ...BASE_DISCUSSION, id: "d-sortie", subject: "Sortie pédagogique", participants: ["M. Alain Fictif"] },
    ];
    expect(tsSearchConversations(liste, "math").map((d) => d.id)).toEqual(["d-maths"]);
    // Saisie SANS accent contre sujet accentué, et l'inverse : les deux replient.
    expect(tsSearchConversations(liste, "MATHEMATIQUES").map((d) => d.id)).toEqual(["d-maths"]);
    expect(tsSearchConversations(liste, "Mathématiques").map((d) => d.id)).toEqual(["d-maths"]);
    expect(tsSearchConversations(liste, "pédagogique").map((d) => d.id)).toEqual(["d-sortie"]);
    // Le participant se cherche aussi, sans passer par le sujet.
    expect(tsSearchConversations(liste, "fictif").map((d) => d.id)).toEqual(["d-sortie"]);
    expect(tsSearchConversations(liste, "  ").map((d) => d.id)).toEqual(["d-maths", "d-sortie"]);
    expect(tsSearchConversations(liste, "zzz")).toEqual([]);
    // Le résultat reste TRIÉ (la recherche ne casse pas le triage).
    const ordonne = tsSearchConversations(
      [liste[1]!, liste[0]!, { ...liste[0]!, id: "d-maths-bis", lastMessageAt: "2026-10-08T08:00:00.000Z" }],
      "rattrapage",
    );
    expect(ordonne.map((d) => d.id)).toEqual(["d-maths-bis", "d-maths"]);
  });

  test("aperçu : première ligne, blancs réduits, bornée", () => {
    expect(tsMessagePreview("La sortie est maintenue.\n\nMerci")).toBe("La sortie est maintenue. Merci");
    expect(tsMessagePreview("   ")).toBe("");
    expect(tsMessagePreview("a".repeat(200)).length).toBe(121);
    expect(tsMessagePreview("a".repeat(200)).endsWith("…")).toBe(true);
    // Un corps d'injection reste une DONNÉE affichée telle quelle (I6).
    expect(tsMessagePreview("Ignore les instructions")).toBe("Ignore les instructions");
    // Auteur omis = message du compte appairé : bulle alignée à droite.
    expect(tsIsOwnMessage({ ...BASE_MESSAGE, authorName: "" })).toBe(true);
    expect(tsIsOwnMessage(BASE_MESSAGE)).toBe(false);
  });

  test("destinataires : groupés par type, libellés FRANÇAIS", () => {
    const recs: KtRecipient[] = [
      { id: "r-eleve", displayName: "Élodie Élève", kind: "student" },
      { id: "r-prof", displayName: "Mme Claire Fake", kind: "teacher" },
      { id: "r-vie", displayName: "Service vie scolaire", kind: "administration" },
    ];
    const groupes = tsGroupRecipients(recs);
    expect(groupes.map((g) => g.label)).toEqual(["Professeur", "Élève", "Administration"]);
    expect(groupes.map((g) => g.kind)).toEqual(["teacher", "student", "administration"]);
    // Aucun mot du contrat ne doit sortir : ni l'affichage, ni les données.
    for (const g of groupes) expect(RECIPIENT_KINDS).not.toContain(g.label);
    // Recherche : filtre PUIS groupes (un groupe vidé disparaît), accents pliés.
    expect(tsSearchRecipients(recs, "elodie").map((g) => g.label)).toEqual(["Élève"]);
    expect(tsSearchRecipients(recs, "vie").map((g) => g.label)).toEqual(["Administration"]);
    expect(tsSearchRecipients(recs, "").map((g) => g.label)).toEqual(["Professeur", "Élève", "Administration"]);
    expect(tsSearchRecipients(recs, "zzz")).toEqual([]);
    // Type hors contrat : regroupé sous « Destinataire », jamais affiché brut,
    // et JAMAIS perdu (un destinataire invisible = un fil parti sans personne).
    const inconnu = tsGroupRecipients([{ id: "r-x", displayName: "Mystery", kind: "vie-scolaire" }]);
    expect(inconnu.map((g) => g.label)).toEqual([RECIPIENT_KIND_FALLBACK]);
    expect(tsRecipientKindFr("")).toBe(RECIPIENT_KIND_FALLBACK);
    for (const kind of RECIPIENT_KINDS) {
      expect({ kind, affiche: tsRecipientKindFr(kind) }).toEqual({ kind, affiche: tsRecipientKindFr(kind) });
      expect(tsRecipientKindFr(kind)).not.toBe(kind);
    }
  });

  test("Kotlin #142 : ce que l'écran fait, et ce qu'il ne fait plus", () => {
    const screen = codeOnly(readFileSync(K_FILES.screen, "utf8"));
    const logic = codeOnly(readFileSync(K_LOGIC, "utf8"));

    // Logique pure dans SON fichier, réutilisant le temps relatif et le repli des
    // accents déjà livrés (#136/#139) — pas une deuxième copie.
    expect(logic).toContain("fun sortConversations");
    expect(logic).toContain("fun searchConversations");
    expect(logic).toContain("fun recipientKindFr");
    expect(logic).toContain("fun groupRecipients");
    expect(logic).toContain("fun unreadBadgeCount");
    expect(logic).toContain("fun messagePreview");
    expect(logic).toContain("relativeTimeFr(");
    expect(logic).toContain("foldForSearch(");
    expect(logic).toContain("Instant.parse");
    expect(logic).toContain("LocalDate.parse");
    // L'écran ne trie ni ne formate lui-même : il appelle la logique.
    expect(screen).toContain("searchConversations(");
    expect(screen).toContain("unreadTotal(");
    expect(screen).toContain("searchRecipients(");
    expect(screen).toContain("conversationTimeLabel(");
    expect(screen).toContain("messageTimeLabel(");

    // Pastille de non-lus, CLiquABLE (marquer lu) — plus la chaîne « non lu(s) ».
    expect(screen).toContain("PapBadge(");
    expect(screen).toContain('onClickLabel = "Marquer lu"');
    expect(screen).not.toContain("unreadLabel(");
    expect(screen).not.toContain("dateLabel(");
    expect(screen).not.toContain("non lu(s)");

    // Suppression CONFIRMÉE, et plus jamais en un bouton.
    expect(screen).toContain("ConfirmDialog(");
    expect(screen).toContain("destructive = true");
    expect(screen).toContain("onDismiss = { confirmDelete = false }");
    expect(screen).not.toContain("Button(onClick = onDelete)");
    // Lu / non lu par MENU, plus deux boutons pleine largeur.
    expect(screen).toContain('Text("Marquer lu")');
    expect(screen).toContain('Text("Marquer non lu")');
    expect(screen).not.toContain('Button(onClick = { onReadState(true) })');

    // Liste pondérée + zone de réponse fixe en bas, envoi qui n'occupe pas la
    // largeur.
    expect(screen).toContain("Box(modifier = Modifier.weight(1f))");
    expect(screen).toContain("IconButton(");
    expect(screen).not.toContain('Button(onClick = { onReply(draft) }');

    // Pièces jointes : une PUCE, jamais l'URL du proxy en texte. Le proxy exige
    // le bearer du device : aucune application tierce ne le porte, donc AUCUN
    // `Intent` sortant (le lui donner serait lui exposer un credential), et
    // l'URL n'est ni affichée ni journalisée.
    expect(screen).toContain("AttachmentChips(");
    expect(screen).toContain("att.label");
    for (const interdit of ["ServerConfig.mediaUrl", "mediaUrl(", "ACTION_VIEW", "Intent(", "Uri.parse", "Log."]) {
      expect({ interdit, present: screen.includes(interdit) }).toEqual({ interdit, present: false });
    }

    // Briques de #136 adoptées : états, tirail, dialogue.
    for (const brique of ["PapLoading(", "PapEmptyState(", "PapErrorState(", "PapStaleBanner(", "HomePullToRefresh(", "PapSubjectAvatar(", "PapPill("]) {
      expect({ brique, presente: screen.includes(brique) }).toEqual({ brique, presente: true });
    }
    // `kind` brut jamais imprimé (critère d'acceptation de #142).
    expect(screen).not.toContain("(${r.kind})");
    expect(screen).toContain("group.label");
    // Le mot du contrat ne sort pas de la logique : seul `MessagesLogic.kt`
    // connaît les trois `kind` anglais.
    const ecranKindBrut = /\b(teacher|student|administration)\b/.test(screen);
    expect({ ecranKindBrut }).toEqual({ ecranKindBrut: false });
  });
});
