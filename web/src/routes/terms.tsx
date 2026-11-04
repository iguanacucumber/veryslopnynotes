import terms from "../../../TERMS.md?raw";
import "../features/legal/legal.css";
import TermsScreen from "../features/legal/TermsScreen";

export default function TermsRoute() {
  return <TermsScreen markdown={terms} />;
}
