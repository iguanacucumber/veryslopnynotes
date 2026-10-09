// Messagerie : fils, messages, destinataires, et les 4 ÉCRITURES
// (actions APP confirmées, I7 — #80, #197). Déplacé tel quel depuis
// pronote-client-reader.ts.
import type { Discussion, Message, Recipient, RecipientKind } from "../../../shared/contracts/models";
import {
  DISCUSSION_ID_MAX_CHARS,
  DISCUSSION_MAX_PARTICIPANTS,
  DISCUSSION_MAX_UNREAD,
  DISCUSSION_PARTICIPANT_MAX_CHARS,
  DISCUSSION_SUBJECT_MAX_CHARS,
  isDiscussion,
  isMessage,
  isRecipient,
  MESSAGE_AUTHOR_MAX_CHARS,
  MESSAGE_BODY_MAX_CHARS,
  RECIPIENT_NAME_MAX_CHARS,
} from "../../../shared/contracts/models";
import type { PronotePage, PronotePageOptions } from "../../domain/ports";
import { PronoteReadError, PronoteWriteError, untrusted } from "../../domain/ports";
import type { ReaderCtx } from "./primitives";
import {
  bounded,
  clampLimit,
  parseOffset,
  resolveAccount,
  toIso,
  toReadError,
  toWriteError,
} from "./primitives";

 // --- #80 messagerie : lectures + ÉCRITURES (actions APP confirmées, I7) ---
// Les 4 écritures (create/reply/read-state/delete) n'ont qu'une seule porte
// d'entrée : les routes POST /v1/discussions/* de server/api/discussions.ts,
// donc un geste CONFIRMÉ de l'app — jamais une sortie LLM (I7). Le port de
// LECTURE PronoteReader n'expose aucune écriture (voir ports.ts).
// ponytail: ce bloc vit dans le reader comme `setAssignmentDone` (#75) : la
// session Pronote reste côté serveur, jamais dans l'app (I2).

/**
 * Liste des fils de discussion. `null` = onglet Discussions indisponible
 * (absent de l'installation, droits refusés, panne) → page VIDE côté lecture
 * et 409 sur une écriture, jamais une erreur 500. Seule la session morte
 * remonte (l'app doit se ré-appairer).
 */
async function discussionList(
  ctx: ReaderCtx,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  what: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[] | null> {
  if (typeof client?.discussions !== "function") {
    ctx.logger(`${what} -> onglet Discussions absent`);
    return null;
  }
  try {
    const raw = (await client.discussions()) as unknown[];
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    const mapped = toReadError(err, what);
    if (mapped.code === "session_expired") {
      ctx.logger(`${what} -> error ${mapped.code}`);
      throw mapped;
    }
    ctx.logger(`${what} -> indisponible (${mapped.code})`);
    return null;
  }
}

/** Fil visé par une écriture ; absent = `not_found` (409), jamais de faux succès. */
async function requireDiscussion(
  ctx: ReaderCtx,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  discussionId: string,
  what: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const list = await discussionList(ctx, client, what);
  const found = list === null ? undefined : list.find((d) => (d as { id?: unknown })?.id === discussionId);
  if (!found) throw new PronoteWriteError(`${what} not found`, "not_found");
  return found;
}

/**
 * Fils de discussion (parité Papillon onglet Discussions). Onglet inactif =
 * page VIDE (l'app masque l'onglet), jamais une erreur de lecture.
 * ponytail: `participants()` + `messages()` = 2 requêtes Pronote par fil, donc
 * enrichissement plafonné à DISCUSSION_ENRICH_LIMIT ; au-delà le fil reste
 * listé (participants vides, `updatedAt` = heure de lecture).
 */
export async function getDiscussions(ctx: ReaderCtx, accountId: string, page?: PronotePageOptions): Promise<PronotePage<Discussion>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("discussions session expired", "session_expired");
  const limit = clampLimit(page?.limit);
  const offset = parseOffset(page?.cursor);
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "discussions");
    ctx.logger(`discussions -> error ${mapped.code}`);
    throw mapped;
  }
  const list = await discussionList(ctx, client, "discussions");
  if (list === null) return { items: untrusted([]), nextCursor: null };
  const out: Discussion[] = [];
  for (const [i, raw] of list.slice(offset, offset + limit).entries()) {
    const mapped = await mapDiscussion(offset + i, raw, offset + i < DISCUSSION_ENRICH_LIMIT);
    if (mapped) out.push(mapped);
  }
  const nextCursor = offset + limit < list.length ? String(offset + limit) : null;
  ctx.logger(`discussions -> ok ${out.length}`);
  return { items: untrusted(out), nextCursor };
}

/**
 * Messages d'UN fil (borne d'affichage). Fil inconnu, fermé ou illisible =
 * page VIDE, jamais une erreur : la lecture ne doit pas casser l'écran.
 */
export async function getDiscussionMessages(ctx: ReaderCtx, accountId: string, discussionId: string): Promise<PronotePage<Message>> {
  const id = (accountId ?? "").trim();
  const target = (discussionId ?? "").trim();
  if (!id) throw new PronoteReadError("messages session expired", "session_expired");
  if (target === "") return { items: untrusted([]), nextCursor: null };
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "messages");
    ctx.logger(`messages -> error ${mapped.code}`);
    throw mapped;
  }
  const list = await discussionList(ctx, client, "messages");
  if (list === null) return { items: untrusted([]), nextCursor: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = list.find((d) => (d as any)?.id === target);
  if (!raw) {
    ctx.logger("messages -> fil introuvable, page vide");
    return { items: untrusted([]), nextCursor: null };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = typeof raw?.messages === "function" ? ((await raw.messages()) as unknown[]) : [];
    const out: Message[] = [];
    for (const [i, m] of (Array.isArray(rows) ? rows : []).slice(0, DISCUSSION_MESSAGE_LIMIT).entries()) {
      const mapped = mapDiscussionMessage(target, m, i);
      if (mapped) out.push(mapped);
    }
    ctx.logger(`messages -> ok ${out.length}`);
    return { items: untrusted(out), nextCursor: null };
  } catch (err) {
    const mapped = toReadError(err, "messages");
    if (mapped.code === "session_expired") {
      ctx.logger(`messages -> error ${mapped.code}`);
      throw mapped;
    }
    ctx.logger(`messages -> illisibles (${mapped.code}), page vide`);
    return { items: untrusted([]), nextCursor: null };
  }
}

/** Destinataires proposables (nouvelle discussion). Onglet absent = page vide. */
export async function getDiscussionRecipients(ctx: ReaderCtx, accountId: string): Promise<PronotePage<Recipient>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("recipients session expired", "session_expired");
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "recipients");
    ctx.logger(`recipients -> error ${mapped.code}`);
    throw mapped;
  }
  if (typeof client?.getRecipients !== "function") {
    ctx.logger("recipients -> onglet absent, page vide");
    return { items: untrusted([]), nextCursor: null };
  }
  try {
    const raw = (await client.getRecipients()) as unknown[];
    const out: Recipient[] = [];
    const seen = new Set<string>();
    for (const r of (Array.isArray(raw) ? raw : []).slice(0, DISCUSSION_RECIPIENT_LIMIT)) {
      const mapped = mapRecipient(r);
      if (mapped && !seen.has(mapped.id)) {
        seen.add(mapped.id);
        out.push(mapped);
      }
    }
    ctx.logger(`recipients -> ok ${out.length}`);
    return { items: untrusted(out), nextCursor: null };
  } catch (err) {
    const mapped = toReadError(err, "recipients");
    if (mapped.code === "session_expired") {
      ctx.logger(`recipients -> error ${mapped.code}`);
      throw mapped;
    }
    ctx.logger(`recipients -> indisponible (${mapped.code}), page vide`);
    return { items: untrusted([]), nextCursor: null };
  }
}

/**
 * Nouvelle discussion — ÉCRITURE, action APP confirmée (I7).
 * Destinataires : ids résolus côté serveur via les RESSOURCES de l'établissement ; un id
 * demandé mais absent = 409 (jamais une discussion adressée à un id inventé).
 * ponytail: pronotets `newDiscussion` ne renvoie rien (pas d'id) : la réponse
 * API est un `ok` + invalidation de cache, l'app recharge la liste.
 */
export async function createDiscussion(ctx: ReaderCtx, accountId: string, subject: string, body: string, recipientIds: string[]): Promise<void> {
  const id = resolveAccount(ctx, accountId);
  // Bornes appliquées ici aussi (défense en profondeur : l'appelant est la
  // route, mais rien ne doit envoyer un texte arbitrairement long à Pronote).
  const titre = bounded(subject ?? "", DISCUSSION_SUBJECT_MAX_CHARS);
  const text = bounded(body ?? "", MESSAGE_BODY_MAX_CHARS);
  const wanted = [
    ...new Set(
      (recipientIds ?? [])
        .map((r) => bounded(r ?? "", DISCUSSION_ID_MAX_CHARS))
        .filter((r) => r !== "" && r.length <= DISCUSSION_ID_MAX_CHARS),
    ),
  ];
  if (!id) throw new PronoteWriteError("discussion session expired", "session_expired");
  if (titre === "" || text === "" || wanted.length === 0) {
    throw new PronoteWriteError("discussion not found", "not_found");
  }
  try {
    const client = ctx.sessions.requireClient(id);
    if (
      typeof client?.discussions !== "function" ||
      typeof client?.newDiscussion !== "function" ||
      typeof client?.getRecipients !== "function"
    ) {
      throw new PronoteWriteError("discussion unsupported", "unsupported");
    }
    const raw = (await client.getRecipients()) as unknown[];
    const list = Array.isArray(raw) ? raw : [];
    const picked: unknown[] = [];
    for (const rid of wanted) {
      const hit = list.find((r) => (r as { id?: unknown })?.id === rid);
      if (!hit) throw new PronoteWriteError("discussion recipient not found", "not_found");
      picked.push(hit);
    }
    await client.newDiscussion(titre, text, picked);
    // Compteurs seuls dans les logs : ni sujet, ni corps, ni destinataires (PII).
    ctx.logger(`discussions -> create ok ${picked.length}`);
  } catch (err) {
    const mapped = toDiscussionWriteError(err, "discussion");
    ctx.logger(`discussions -> create error ${mapped.code}`);
    throw mapped;
  }
}

/** Réponse dans un fil — ÉCRITURE, action APP confirmée (I7). */
export async function replyToDiscussion(ctx: ReaderCtx, accountId: string, discussionId: string, body: string): Promise<void> {
  const id = resolveAccount(ctx, accountId);
  const target = bounded(discussionId ?? "", DISCUSSION_ID_MAX_CHARS);
  const text = bounded(body ?? "", MESSAGE_BODY_MAX_CHARS);
  if (!id) throw new PronoteWriteError("reply session expired", "session_expired");
  if (target === "" || text === "") throw new PronoteWriteError("reply not found", "not_found");
  try {
    const client = ctx.sessions.requireClient(id);
    const found = await requireDiscussion(ctx, client, target, "reply");
    if (typeof found?.reply !== "function") throw new PronoteWriteError("reply unsupported", "unsupported");
    await found.reply(text);
    // Compteur seul dans les logs : jamais le contenu du message (I6/PII).
    ctx.logger("discussions -> reply ok");
  } catch (err) {
    const mapped = toDiscussionWriteError(err, "reply");
    ctx.logger(`discussions -> reply error ${mapped.code}`);
    throw mapped;
  }
}

/** Marquer lu / non-lu — ÉCRITURE, action APP confirmée (I7). */
export async function setDiscussionRead(ctx: ReaderCtx, accountId: string, discussionId: string, read: boolean): Promise<void> {
  const id = resolveAccount(ctx, accountId);
  const target = bounded(discussionId ?? "", DISCUSSION_ID_MAX_CHARS);
  if (!id) throw new PronoteWriteError("read-state session expired", "session_expired");
  if (target === "") throw new PronoteWriteError("read-state not found", "not_found");
  try {
    const client = ctx.sessions.requireClient(id);
    const found = await requireDiscussion(ctx, client, target, "read-state");
    if (typeof found?.markAs !== "function") {
      throw new PronoteWriteError("read-state unsupported", "unsupported");
    }
    await found.markAs(read === true);
    ctx.logger("discussions -> read-state ok");
  } catch (err) {
    const mapped = toDiscussionWriteError(err, "read-state");
    ctx.logger(`discussions -> read-state error ${mapped.code}`);
    throw mapped;
  }
}

/** Suppression (corbeille) — ÉCRITURE, action APP confirmée (I7). */
export async function deleteDiscussion(ctx: ReaderCtx, accountId: string, discussionId: string): Promise<void> {
  const id = resolveAccount(ctx, accountId);
  const target = bounded(discussionId ?? "", DISCUSSION_ID_MAX_CHARS);
  if (!id) throw new PronoteWriteError("delete session expired", "session_expired");
  if (target === "") throw new PronoteWriteError("delete not found", "not_found");
  try {
    const client = ctx.sessions.requireClient(id);
    const found = await requireDiscussion(ctx, client, target, "delete");
    if (typeof found?.delete !== "function") throw new PronoteWriteError("delete unsupported", "unsupported");
    await found.delete();
    ctx.logger("discussions -> delete ok");
  } catch (err) {
    const mapped = toDiscussionWriteError(err, "delete");
    ctx.logger(`discussions -> delete error ${mapped.code}`);
    throw mapped;
  }
}

// --- #80 mappers messagerie (défensifs, données bornées, I6) ---
// pronotets : `client.discussions()` → Discussion {id, objet, nbNonLus},
// `discussion.participants()` → string[], `discussion.messages()` → Message
// {id, contenu, public_gauche, date}, `client.getRecipients()` → Recipient
// {id, name, type}. Tout le texte est une DONNÉE : borné, jamais interprété.
// Champ illisible = champ OMIS (jamais de "" bidon, jamais de date devinée).
// ponytail: `participants()` et `messages()` coûtent 1 requête Pronote par fil,
// donc l'enrichissement est plafonné (DISCUSSION_ENRICH_LIMIT) ; au-delà, les
// participants restent vides et `updatedAt` vaut l'horodatage de lecture
// (comme les autres mappers quand la date n'est pas publiée).
const DISCUSSION_ENRICH_LIMIT = 12;
/** Messages affichés d'un fil (plafond d'affichage, pas de thread infini). */
const DISCUSSION_MESSAGE_LIMIT = 200;
/** Ressources de destinataires lues pour le sélecteur de l'app (plafond). */
const DISCUSSION_RECIPIENT_LIMIT = 40;

/**
 * Erreur d'écriture messagerie : fil FERMÉ ou fonctionnalité absente.
 * pronotets fixe `name = nomDuConstructeur` sur ses exceptions, donc on lit le
 * nom (`DiscussionClosed`, `UnsupportedOperation`) avant le message.
 * `DiscussionClosed` → 409 conflict (« pas d'action possible sur ce fil »),
 * `UnsupportedOperation` → 501 (jamais de faux succès).
 * ponytail: détection par nom/message plutôt que par import de la classe : le
 * reader reste dépendant des ports, pas des classes de la lib.
 */
function toDiscussionWriteError(err: unknown, what: string): PronoteWriteError {
  if (err instanceof PronoteWriteError) return err;
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  if (name === "DiscussionClosed" || /closed|ferme/i.test(message)) {
    return new PronoteWriteError(`${what} closed`, "not_found");
  }
  if (name === "UnsupportedOperation" || /unsupported|not.?implemented/i.test(message)) {
    return new PronoteWriteError(`${what} unsupported`, "unsupported");
  }
  return toWriteError(err, what);
}

/** Non-lus publiés : hors borne = compteur omis (jamais un nombre aberrant). */
function toUnreadCount(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return undefined;
  return raw >= 0 && raw <= DISCUSSION_MAX_UNREAD ? raw : undefined;
}

/** Noms de participants : bornés, dédupliqués, plafonnés (ordre published). */
function mapParticipantNames(raw: unknown): string[] {
  const out: string[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (typeof p !== "string") continue;
    const name = bounded(p, DISCUSSION_PARTICIPANT_MAX_CHARS);
    if (name === "" || out.includes(name)) continue;
    out.push(name);
    if (out.length >= DISCUSSION_MAX_PARTICIPANTS) break;
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRecipient(raw: any): Recipient | null {
  const id = typeof raw?.id === "string" ? bounded(raw.id, DISCUSSION_ID_MAX_CHARS) : "";
  const name = typeof raw?.name === "string" ? bounded(raw.name, RECIPIENT_NAME_MAX_CHARS) : "";
  // Destinataire sans id ni nom = ignoré (jamais une ligne à moitié remplie).
  if (id === "" || name === "") return null;
  // ponytail: pronotets ne distingue que `teacher` et `staff` ; `student` reste
  // une valeur de contrat (un établissement qui l'exposerait serait accepté),
  // on ne DEVINE jamais le reste : staff → administration.
  const kind: RecipientKind = raw?.type === "teacher" ? "teacher" : "administration";
  const cand: Recipient = { id, displayName: name, kind };
  return isRecipient(cand) ? cand : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDiscussionMessage(discussionId: string, raw: any, index: number): Message | null {
  const id = typeof raw?.id === "string" && raw.id ? bounded(raw.id, DISCUSSION_ID_MAX_CHARS) : `m-${index}`;
  const content = typeof raw?.content === "string" ? bounded(raw.content, MESSAGE_BODY_MAX_CHARS) : "";
  // Message sans texte lisible = ignoré (jamais de ligne vide affichée).
  if (content === "") return null;
  const author = typeof raw?.author === "string" ? bounded(raw.author, MESSAGE_AUTHOR_MAX_CHARS) : "";
  const cand: Message = {
    id,
    discussionId,
    // Auteur absent = message du compte appairé (Pronote ne le publie pas pour
    // ses propres messages) : champ OMIS, jamais un « Moi » inventé.
    ...(author !== "" ? { authorName: author } : {}),
    body: content,
    sentAt: toIso(raw?.created ?? raw?.date, new Date().toISOString()),
  };
  return isMessage(cand) ? cand : null;
}

/**
 * Fil de discussion. `enrich = false` = pas de requête participants/messages
 * (plafond de coût) : participants vides, `updatedAt` = heure de lecture.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mapDiscussion(index: number, raw: any, enrich: boolean): Promise<Discussion | null> {
  const subject = typeof raw?.subject === "string" ? bounded(raw.subject, DISCUSSION_SUBJECT_MAX_CHARS) : "";
  const id = typeof raw?.id === "string" && raw.id ? bounded(raw.id, DISCUSSION_ID_MAX_CHARS) : "";
  // Fil sans identifiant = ignoré (l'app ne peut ni l'ouvrir ni le supprimer).
  if (id === "") return null;
  let participants: string[] = [];
  let lastMessageAt: string | undefined;
  let updatedAt = new Date().toISOString();
  if (enrich) {
    try {
      participants = mapParticipantNames(typeof raw?.participants === "function" ? await raw.participants() : []);
    } catch {
      // Participants indisponibles = liste vide (add-only), jamais une erreur.
    }
    try {
      const list = typeof raw?.messages === "function" ? ((await raw.messages()) as unknown[]) : [];
      const rows = Array.isArray(list) ? list : [];
      const last = rows[rows.length - 1] as { created?: unknown; date?: unknown } | undefined;
      const first = rows[0] as { created?: unknown; date?: unknown } | undefined;
      const stamp = toIso(last?.created ?? last?.date, "");
      if (stamp !== "") lastMessageAt = stamp;
      updatedAt = stamp !== "" ? stamp : toIso(first?.created ?? first?.date, updatedAt);
    } catch {
      // Messages illisibles : on garde l'horodatage de lecture (jamais 1970).
    }
  }
  const unread = toUnreadCount(raw?.unread);
  const cand: Discussion = {
    id,
    // Sujet vide = libellé générique (comme « Devoir » / « Actualité »), jamais "".
    subject: subject || "Discussion",
    participants,
    updatedAt,
    ...(unread !== undefined ? { unreadCount: unread } : {}),
    ...(lastMessageAt !== undefined ? { lastMessageAt } : {}),
  };
  return isDiscussion(cand) ? cand : null;
}
