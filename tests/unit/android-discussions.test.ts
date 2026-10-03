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
      event: { v: "0.3.0", type: "CacheInvalidated", at: "2026-10-03T09:00:00.000Z", data: { resource: "discussions", reason: "manual" } },
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