import { useMemo, useState } from "react";
import { useResource } from "../ui/AppContext";
import { AttendanceScreen } from "../features/attendance/SchoolLifeScreens";
import { parseAttendance, parseCapabilities } from "../features/attendance/model";

export default function AttendanceRoute() {
  const attendance = useResource("attendance");
  const capabilities = useResource("capabilities");
  const [onlyPending, setOnlyPending] = useState(false);

  const data = useMemo(() => parseAttendance(attendance.payload), [attendance.payload]);
  const tabs = useMemo(() => parseCapabilities(capabilities.payload), [capabilities.payload]);

  return (
    <AttendanceScreen
      rows={data.absences}
      loading={attendance.loading}
      error={attendance.error}
      stale={attendance.stale}
      onlyPending={onlyPending}
      canSeeSanctions={tabs.includes("punishments")}
      onOnlyPendingChange={setOnlyPending}
      onRefresh={attendance.refresh}
    />
  );
}
