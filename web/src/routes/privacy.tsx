import privacy from "../../../PRIVACY.md?raw";
import "../features/legal/legal.css";
import PrivacyScreen from "../features/legal/PrivacyScreen";

export default function PrivacyRoute() {
  return <PrivacyScreen markdown={privacy} />;
}
