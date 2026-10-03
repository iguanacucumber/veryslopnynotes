// ENT Ninegate Réunion (Hubix → EduConnect → portail → tuile Pronote SSO).
// Chaîne validée live 2026-10-02 (spike #73, sans secret en repo).
// Étapes : Hubix /go/ELEVE → SAMLRequest → EduConnect login (?execution e1s1→e1s2)
// → SAMLResponse → Hubix → sso.ac-reunion.fr → portail → tuile SSO → eleve.html.
// Sort un CookieJar (tough-cookie) pour Client pronotets (MIT).
// Secrets (username/password) en body POST uniquement, jamais en log/URL.
// ponytail: réutilise HttpSession pronotets (jar + redirects), pas de nouveau client.
// Upgrade: autres ENT = autre fonction même signature (type ENTFunction).
// Note: HttpSession (dist/http.js) fait partie de la lib pronotets MIT :
// import profond documenté, une seule lib réseau Pronote (I2 : aucun fetch
// direct vers Pronote/ENT ici, tout passe par HttpSession pronotets).
import { CookieJar } from "tough-cookie";
import { load } from "cheerio";

// Déclaration locale du sous-module (types dist/http.d.ts).
// Reste compatible I2 (réseau via pronotets uniquement).
import type { CookieJar as JarType } from "tough-cookie";

interface SessionResponse {
  readonly status: number;
  readonly url: string;
  readonly text: string;
}

interface HttpSessionLike {
  readonly jar: JarType;
  get(url: string, opts?: { headers?: Record<string, string>; data?: Record<string, string | undefined> }): Promise<SessionResponse>;
  post(url: string, opts?: { headers?: Record<string, string>; data?: Record<string, string | undefined> }): Promise<SessionResponse>;
}

// import via alias de secours : bun résout le fichier dist même sans export map.
import { HttpSession } from "../../node_modules/pronotets/dist/http.js";

function newSession(headers: Record<string, string>, jar?: JarType): HttpSessionLike {
  return new HttpSession(headers, jar) as unknown as HttpSessionLike;
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:73.0) Gecko/20100101 Firefox/73.0",
};

function samlInput(html: string, name: "SAMLRequest" | "SAMLResponse"): string | null {
  const $ = load(html);
  const el = $(`input[name="${name}"]`);
  if (!el.length) return null;
  return el.attr("value") ?? "";
}

function formAction(html: string, base: string, formName?: string): string | null {
  const $ = load(html);
  const form = formName ? $(`form[name="${formName}"]`) : $("form").first();
  const action = form.attr("action");
  if (!action) return null;
  try {
    return new URL(action, base).toString();
  } catch {
    return null;
  }
}

/** Origine (`scheme://host[:port]`) d'une URL, "" si illisible. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function formInputs(html: string, formName?: string): Record<string, string> {
  const $ = load(html);
  const out: Record<string, string> = {};
  const sel = formName ? `form[name="${formName}"] input` : "form input";
  $(sel).each((_, el) => {
    const name = $(el).attr("name");
    if (name) out[name] = $(el).attr("value") ?? "";
  });
  return out;
}

/** Suit les auto-posts SAML (SAMLRequest/SAMLResponse) jusqu'à page sans SAML. */
async function followSamlPosts(
  session: HttpSessionLike,
  response: SessionResponse,
  logger?: (message: string) => void,
): Promise<SessionResponse> {
  let current = response;
  for (let i = 0; i < 12; i++) {
    const samlResponse = samlInput(current.text, "SAMLResponse");
    const samlRequest = samlResponse === null ? samlInput(current.text, "SAMLRequest") : null;
    const kind = samlResponse !== null ? "SAMLResponse" : samlRequest !== null ? "SAMLRequest" : null;
    if (kind === null) return current;
    const value = kind === "SAMLResponse" ? samlResponse : samlRequest;
    const $ = load(current.text);
    const relay = $('input[name="RelayState"]');
    const data: Record<string, string> = { [kind]: value ?? "" };
    if (relay.length) data["RelayState"] = relay.attr("value") ?? "";
    const action = formAction(current.text, current.url);
    if (!action) return current;
    current = await session.post(action, { headers: HEADERS, data });
    logger?.(`sso saml ${kind} -> ${current.status}`);
  }
  return current;
}

/**
 * ENT Ninegate Réunion : Hubix Élève → EduConnect → portail.
 * Retourne le jar authentifié sur le portail (cookies SSO).
 * Lève ENTLoginError-like (Error message sans secret) si échec.
 */
export async function ninegateHubixEduconnect(
  username: string,
  password: string,
  opts: { pronote_url?: string; logger?: (message: string) => void } = {},
): Promise<CookieJar> {
  const logger = opts.logger;
  const user = (username ?? "").trim();
  const pass = password ?? "";
  if (!user || !pass) throw new Error("ninegate: identifiants requis");
  const session = newSession(HEADERS);

  // 1. Hubix profil élève → SAMLRequest vers SSO Réunion.
  const hubix = await session.get("https://hubix.ac-reunion.fr/go/ELEVE", { headers: HEADERS });
  logger?.(`sso hubix -> ${hubix.status}`);
  if (hubix.status !== 200) throw new Error("ninegate: hubix injoignable");

  // 2. POST SAMLRequest → page intermédiaire EduConnect (?execution=e1s1).
  const samlRequest = samlInput(hubix.text, "SAMLRequest");
  if (samlRequest === null) throw new Error("ninegate: SAMLRequest absent");
  const hubixForm = load(hubix.text);
  const hubixRelay = hubixForm('input[name="RelayState"]');
  const hubixData: Record<string, string> = { SAMLRequest: samlRequest };
  if (hubixRelay.length) hubixData["RelayState"] = hubixRelay.attr("value") ?? "";
  const hubixAction = formAction(hubix.text, hubix.url);
  if (!hubixAction) throw new Error("ninegate: action hubix absente");
  let edu = await session.post(hubixAction, { headers: HEADERS, data: hubixData });
  logger?.(`sso edu··· -> ${edu.status}`);

  // 3. Probe Shibboleth e1s1 (form1 sans creds) → page login e1s2.
  const probeAction = formAction(edu.text, edu.url, "form1");
  if (!probeAction) throw new Error("ninegate: probe e1s1 absente");
  edu = await session.post(probeAction, { headers: HEADERS, data: formInputs(edu.text, "form1") });
  logger?.(`sso edu··· -> ${edu.status}`);
  if (!edu.text.includes("j_username")) throw new Error("ninegate: page login absente");

  // 4. Login EduConnect (j_username/j_password + csrf, body POST uniquement).
  //    L'action du form vient du HTML servi : le mot de passe ne part que si
  //    elle reste sur l'origine qui a servi la page de login. Une page ENT
  //    substituée (ou un `action` absolu hostile) ne doit jamais capter le
  //    secret — échec franc plutôt que fuite vers un hôte arbitraire.
  const loginAction = formAction(edu.text, edu.url) ?? edu.url;
  const eduOrigin = originOf(edu.url);
  if (eduOrigin === "" || originOf(loginAction) !== eduOrigin) {
    throw new Error("ninegate: action login hors origine ENT");
  }
  const csrf = load(edu.text)('input[name="csrf_token"]').attr("value") ?? "";
  const logged = await session.post(loginAction, {
    headers: HEADERS,
    data: { csrf_token: csrf, j_username: user, j_password: pass, _eventId_proceed: "" },
  });
  logger?.(`sso edu-login -> ${logged.status}`);
  if (!logged.text.includes("SAMLResponse")) {
    throw new Error("ninegate: echec EduConnect (identifiants ou flux)");
  }

  // 5. SAMLResponse → Hubix → SSO Réunion → portail.
  let current = await followSamlPosts(session, logged, logger);
  // 6. Lien "Cliquer ici" Hubix → SSO → portail (auto-posts SAML).
  const $hubix = load(current.text);
  let next: string | null = null;
  $hubix("a").each((_, el) => {
    if (/cliquer ici/i.test($hubix(el).text() ?? "") && next === null) {
      next = $hubix(el).attr("href") ?? null;
    }
  });
  if (next) {
    current = await session.get(new URL(next, current.url).toString(), { headers: HEADERS });
    logger?.(`sso sso-reunion -> ${current.status}`);
    current = await followSamlPosts(session, current, logger);
  }
  // Portail atteint = réponse RÉELLEMENT authentifiée : le portail a établi un
  // cookie de session. Jamais un substring « ninegate » dans le HTML — une page
  // non authentifiée passerait alors pour une session valide et on rendrait un
  // jar vide au Client pronotets (échec lu comme une session morte).
  let portalBase = "";
  try {
    const u = new URL(current.url);
    portalBase = `${u.protocol}//${u.host}`;
  } catch {
    throw new Error("ninegate: base portail illisible");
  }
  if ((await session.jar.getCookieString(`${portalBase}/`)) === "") {
    throw new Error("ninegate: session portail non authentifiée");
  }
  logger?.("sso portail -> ok");
  // Base portail (jamais loggée en clair). Puis tuile auto sans navigateur.
  const tileHref = await ninegateDiscoverTile(session.jar, portalBase, logger);
  return ninegatePronoteTicket(session.jar, tileHref, logger);
}

/**
 * Termine le SSO portail → Pronote : suit la tuile (href découvert ou fourni)
 * et retourne le jar enrichi. Longueur seule loggée, jamais URL claire.
 */
export async function ninegatePronoteTicket(
  jar: CookieJar,
  tileHref: string,
  logger?: (message: string) => void,
): Promise<CookieJar> {
  const href = (tileHref ?? "").trim();
  if (!href || !/^https?:\/\//i.test(href)) throw new Error("ninegate: href tuile invalide");
  const session = newSession(HEADERS, jar);
  const res = await session.get(href, { headers: HEADERS });
  logger?.(`sso tuile (len ${href.length}) -> ${res.status}`);
  if (res.status !== 200) throw new Error("ninegate: tuile SSO echec");
  return session.jar;
}

/**
 * Découvre le href de la tuile Pronote depuis le portail authentifié.
 * Séquence validée live : GET /ninegate/login (finalise session portail),
 * puis GET /ninegate/page/view/-200?usage=accueil (bureau, 64kch avec tuiles),
 * extraction du premier lien dont le texte contient "pronote".
 * Le href n'est jamais loggé en clair (longueur seule).
 */
export async function ninegateDiscoverTile(
  jar: CookieJar,
  portalBase: string,
  logger?: (message: string) => void,
): Promise<string> {
  const base = (portalBase ?? "").trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) throw new Error("ninegate: base portail invalide");
  const session = newSession(HEADERS, jar);
  await session.get(`${base}/ninegate/login`, { headers: HEADERS });
  logger?.("sso portail-login -> ok");
  const view = await session.get(`${base}/ninegate/page/view/-200?usage=accueil&group=null`, {
    headers: HEADERS,
  });
  logger?.(`sso bureau (len ${view.text.length}) -> ${view.status}`);
  if (view.status !== 200) throw new Error("ninegate: bureau injoignable");
  const $ = load(view.text);
  const tiles: string[] = [];
  $("a").each((_, el) => {
    if (/pronote/i.test($(el).text() ?? "")) {
      const href = $(el).attr("href") ?? "";
      if (href) tiles.push(href);
    }
  });
  const found = tiles.find((h) => /^https?:\/\//i.test(h)) ?? null;
  if (!found) throw new Error("ninegate: tuile Pronote introuvable");
  logger?.(`sso tuile (len ${found.length}) -> ok`);
  return found;
}
