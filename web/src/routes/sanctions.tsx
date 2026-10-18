import { useMemo } from "react";
import { useResource } from "../ui/AppContext";
import { SanctionsScreen } from "../features/attendance/SchoolLifeScreens";
import { parsePunishments } from "../features/attendance/model";

export default function SanctionsRoute() {
  const punishments = useResource("punishments");
  const rows = useMemo(() => parsePunishments(punishments.payload), [punishments.payload]);

  return (
    <SanctionsScreen
      rows={rows}
      loading={punishments.loading}
      error={punishments.error}
      stale={punishments.stale}
      onRefresh={punishments.refresh}
    />
  );
}
