/** Motif de refus typé : le serveur l'expose à l'appelant (jamais l'URL). */
export type ScrapeRefusal =
  | "private_host"
  | "unresolved_host"
  | "timeout"
  | "login_required"
  | "too_large"
  | "not_text"
  | "generic";

export class ScrapeManualsError extends Error {
  /** Motif du refus : `private_host` = garde SSRF (403), `timeout` = 504, `generic` = 502. */
  readonly reason: ScrapeRefusal;
  constructor(message: string, reason: ScrapeRefusal = "generic") {
    super(message);
    this.name = "ScrapeManualsError";
    this.reason = reason;
  }
}
