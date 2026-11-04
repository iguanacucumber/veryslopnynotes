import apache from "../../public/licenses/APACHE-2.0.txt?raw";
import gpl from "../../public/licenses/APP-GPL-3.0-ONLY.txt?raw";
import papicons from "../../public/licenses/PAPICONS-MIT.txt?raw";
import pronotets from "../../public/licenses/PRONOTETS-MIT.txt?raw";
import react from "../../public/licenses/REACT-MIT.txt?raw";
import router from "../../public/licenses/REACT-ROUTER-DOM-MIT.txt?raw";
import rolldown from "../../public/licenses/ROLLDOWN-MIT.txt?raw";
import snPro from "../../public/licenses/SN-PRO-OFL.txt?raw";
import notices from "../../../THIRD_PARTY_NOTICES.md?raw";
import "../features/legal/legal.css";
import LicensesScreen from "../features/legal/LicensesScreen";

const TEXTS: Record<string, string> = {
  "APP-GPL-3.0-ONLY.txt": gpl,
  "APACHE-2.0.txt": apache,
  "REACT-MIT.txt": react,
  "REACT-ROUTER-DOM-MIT.txt": router,
  "PRONOTETS-MIT.txt": pronotets,
  "ROLLDOWN-MIT.txt": rolldown,
  "PAPICONS-MIT.txt": papicons,
  "SN-PRO-OFL.txt": snPro,
};

export default function LicensesRoute() {
  return <LicensesScreen notices={notices} texts={TEXTS} />;
}
