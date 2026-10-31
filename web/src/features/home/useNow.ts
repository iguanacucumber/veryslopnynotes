import { useEffect, useState } from "react";

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), Math.max(15_000, intervalMs));
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
