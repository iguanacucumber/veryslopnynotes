import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { bridge } from "../../bridge/client";
import type { AppVersion } from "../../bridge/types";
import { Card, Page, Section } from "../../ui/components";
import {
  RELEASES_URL,
  releaseNotesUrl,
  REPO_URL,
  SECURITY_URL,
  sourceTag,
  SUPPORT_URL,
} from "./legal";

const FINGERPRINT_PATTERN = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** Le pont est une frontière : une réponse malformée ne devient jamais un
 *  numéro ou une empreinte affichés. Champs invalides = repli explicite. */
export function parseAppVersion(value: unknown): AppVersion | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const version = typeof raw.version === "string" ? raw.version.trim().slice(0, 40) : "";
  if (!version) return null;
  const code =
    typeof raw.versionCode === "number" &&
    Number.isSafeInteger(raw.versionCode) &&
    raw.versionCode >= 0
      ? raw.versionCode
      : -1;
  return {
    version,
    versionCode: code,
    fingerprint:
      typeof raw.fingerprint === "string" && FINGERPRINT_PATTERN.test(raw.fingerprint)
        ? raw.fingerprint
        : null,
    debug: raw.debug === true,
  };
}

function useAppVersion(): AppVersion | null {
  const [identity, setIdentity] = useState<AppVersion | null>(null);
  useEffect(() => {
    let alive = true;
    void bridge
      .version()
      .then((result) => {
        if (alive) setIdentity(parseAppVersion(result));
      })
      .catch(() => {
        // Identité absente : l'écran le dit, il n'invente ni numéro ni empreinte.
      });
    return () => {
      alive = false;
    };
  }, []);
  return identity;
}

function fingerprintLabel(identity: AppVersion | null): string {
  if (!identity) return "Empreinte indisponible : le pont natif n’a pas répondu.";
  if (identity.fingerprint) return identity.fingerprint;
  return identity.debug
    ? "Empreinte du certificat indisponible (build de développement ou paquet non signé)."
    : "Empreinte du certificat indisponible (paquet non signé).";
}

function ContactLine({ label, url }: { label: string; url: string }) {
  return (
    <div className="legal-contact">
      <strong>{label}</strong>
      <span className="legal-contact__url">{url}</span>
    </div>
  );
}

export function AboutContent({ identity }: { identity: AppVersion | null }) {
  const code = identity && identity.versionCode >= 0 ? ` · versionCode ${identity.versionCode}` : "";
  const tag = identity ? sourceTag(identity.version) : null;
  const notes = tag ? releaseNotesUrl(tag) : RELEASES_URL;
  return (
    <Page className="legal">
      <Card className="card--flat legal-lead">
        <strong className="legal-lead__name">VerySlopyNyNotes</strong>
        <span className="legal-lead__version">
          {identity ? `Version ${identity.version}${code}` : "Version indisponible"}
        </span>
        <p className="legal-lead__body">
          Client Android open source pour Pronote : le QR et le PIN restent sur
          ton téléphone, sans serveur du projet.
        </p>
      </Card>

      <Section title="Identification de l’installation">
        <Card className="card--flat legal-stack">
          <div>
            <strong>Empreinte du certificat (SHA-256)</strong>
            <p className="legal-contact__url">{fingerprintLabel(identity)}</p>
          </div>
          {identity?.debug ? (
            <p className="legal-note">
              Build de développement : cette empreinte peut être celle du
              certificat de debug, pas celle d’une release publiée.
            </p>
          ) : null}
          <p className="legal-note">
            Empreinte lue localement sur l’appareil, sans réseau ni service
            Google.
          </p>
        </Card>
      </Section>

      <Section title="Informations légales">
        <nav className="legal-links" aria-label="Informations légales">
          <Link className="legal-link" to="/privacy">
            Confidentialité
          </Link>
          <Link className="legal-link" to="/terms">
            Conditions d’utilisation
          </Link>
          <Link className="legal-link" to="/licenses">
            Licences et notices de tiers
          </Link>
        </nav>
      </Section>

      <Section title="Source et contact">
        <Card className="card--flat legal-stack">
          <ContactLine label="Code source" url={REPO_URL} />
          <ContactLine label="Tag source" url={tag ?? "Indisponible"} />
          <ContactLine label="Notes de version" url={notes} />
          <ContactLine label="Support et bogues" url={SUPPORT_URL} />
          <ContactLine label="Faille de sécurité" url={SECURITY_URL} />
          <p className="legal-note">
            GitHub est le seul canal officiel : le projet ne publie ni adresse
            e-mail, ni adresse postale. Pour une faille, n’ouvre pas d’issue
            publique. Ne joins jamais de note, de message, de QR, de PIN ou de
            clé.
          </p>
        </Card>
      </Section>

      <Section title="Licence">
        <Card className="card--flat legal-stack">
          <p className="legal-copy">
            VerySlopyNyNotes est distribué sous <strong>GPL-3.0-only</strong>.
            Tu peux exécuter, étudier, modifier et redistribuer le code selon
            les termes de cette licence.
          </p>
          <p className="legal-copy">
            Les polices, icônes et composants tiers gardent leurs licences
            respectives. Les textes intégraux sont embarqués dans l’application.
          </p>
          <Link className="legal-link" to="/licenses">
            Lire la licence complète
          </Link>
        </Card>
      </Section>

      <Section title="Non-affiliation">
        <Card className="card--flat">
          <p className="legal-copy">
            VerySlopyNyNotes n’est ni édité, ni approuvé, ni parrainé par
            Pronote, Index Éducation, OpenRouter ou un établissement scolaire.
            Pronote et Index Éducation sont des marques de leurs titulaires
            respectifs.
          </p>
        </Card>
      </Section>
    </Page>
  );
}

export default function AboutScreen() {
  return <AboutContent identity={useAppVersion()} />;
}
