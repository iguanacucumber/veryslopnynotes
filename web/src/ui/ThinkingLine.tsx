import { useEffect, useState } from "react";

/** Pouls + temps écoulé : le même statut pour tous les appels d'IA. */
export function ThinkingLine({ title, startedAt }: { title: string; startedAt?: number }) {
  const [start] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(start);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - start) / 1000));
  return (
    <div className="ai-thinking">
      <span className="ai-pulse" aria-hidden="true" />
      <span className="ai-thinking__title">{title}</span>
      <span className="ai-thinking__time" aria-hidden="true">
        {elapsed} s
      </span>
    </div>
  );
}
