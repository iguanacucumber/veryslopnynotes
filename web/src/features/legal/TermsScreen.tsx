import { Card, Page } from "../../ui/components";
import { LegalDocument } from "./LegalDocument";

/** Les conditions complètes viennent du fichier de référence. */
export default function TermsScreen({ markdown }: { markdown: string }) {
  return (
    <Page className="legal">
      <Card className="card--flat legal-document-card">
        <LegalDocument markdown={markdown} />
      </Card>
    </Page>
  );
}
