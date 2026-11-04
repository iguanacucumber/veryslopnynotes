import { Card, Page } from "../../ui/components";
import { LegalDocument } from "./LegalDocument";

/** La notice complète vient du fichier de référence : aucune copie ne peut
 *  dériver de `PRIVACY.md`. */
export default function PrivacyScreen({ markdown }: { markdown: string }) {
  return (
    <Page className="legal">
      <Card className="card--flat legal-document-card">
        <LegalDocument markdown={markdown} />
      </Card>
    </Page>
  );
}
