import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { bridge } from "../../bridge/client";
import { Card, Page, Section } from "../../ui/components";
import { REPO_URL, SECURITY_URL, SUPPORT_URL } from "./legal";

function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void bridge
      .version()
      .then((result) => {
        if (alive && typeof result.version === "string" && result.version.trim()) {
          setVersion(result.version.trim().slice(0, 40));
        }
      })
      .catch(() => {
        // Version absente : l'écran le dit, il n'invente pas un numéro.
      });
    return () => {
      alive = false;
    };
  }, []);
  return version;
}

function ContactLine({ label, url }: { label: string; url: string }) {
  return (
    <div className="legal-contact">
      <strong>{label}</strong>
      <span className="legal-contact__url">{url}</span>
    </div>
  );
}

export default function AboutScreen() {
  const version = useAppVersion();
  return (
    <Page className="legal">
      <Card className="card--flat legal-lead">
        <strong className="legal-lead__name">VerySlopyNyNotes</strong>
        <span className="legal-lead__version">
          {version ? `Version ${version}` : "Version indisponible"}
        </span>
        <p className="legal-lead__body">
          Client Android open source pour Pronote : le QR et le PIN restent sur
          ton téléphone, sans serveur du projet.
        </p>
      </Card>

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
          <div>
            <strong>Code source</strong>
            <p className="legal-copy">
              Le dépôt public publie le code, les releases et la documentation :
              <span className="legal-contact__url"> {REPO_URL}</span>
            </p>
          </div>
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
