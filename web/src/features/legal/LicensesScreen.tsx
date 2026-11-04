import { Card, Page, Section } from "../../ui/components";
import { LegalDocument } from "./LegalDocument";
import { LICENSE_TEXTS } from "./legal";

/** Notices de tiers et textes intégraux : chaque texte est déjà dans le
 *  bundle, donc l'écran reste hors ligne et le retour système garde la SPA. */
export default function LicensesScreen({
  notices,
  texts,
}: {
  notices: string;
  texts: Record<string, string>;
}) {
  return (
    <Page className="legal">
      <Card className="card--flat legal-document-card">
        <LegalDocument markdown={notices} />
      </Card>

      <Section title="Textes intégraux">
        <Card className="card--flat">
          <p className="legal-copy">
            Chaque texte complet est embarqué dans l’application, sans réseau.
          </p>
          <ul className="legal-license-list">
            {LICENSE_TEXTS.map(({ file, label, detail }) => (
              <li key={file}>
                <details className="legal-license">
                  <summary className="legal-license__summary">
                    <span>{label}</span>
                    <span className="legal-license-list__detail">{detail}</span>
                  </summary>
                  <pre className="legal-license__text" tabIndex={0}>
                    {texts[file] ?? ""}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      </Section>
    </Page>
  );
}
