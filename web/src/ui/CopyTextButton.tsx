import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "./icons";

type State = "idle" | "copied" | "failed";

/** Action « Copier » d'un tour d'assistant : un geste, un retour court. */
export function CopyTextButton({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function settle(next: State): void {
    setState(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  }

  async function copy(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        settle("copied");
        return;
      }
    } catch {
      // Clipboard refusé : le repli ci-dessous reste local.
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    settle(ok ? "copied" : "failed");
  }

  const label = state === "copied" ? "Copié" : state === "failed" ? "Copie impossible" : "Copier";

  return (
    <button
      type="button"
      className={`ai-action${className ? ` ${className}` : ""}`}
      aria-label={state === "failed" ? "Copie impossible" : "Copier la réponse"}
      data-state={state}
      onClick={() => void copy()}
    >
      {state === "copied" ? <IconCheck size={16} /> : <IconCopy size={16} />}
      <span>{label}</span>
    </button>
  );
}
