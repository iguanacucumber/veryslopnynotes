import type { ReactNode } from "react";
import type { SessionStatus } from "../bridge/types";
import { sessionKnown } from "../lib/session";

/** Bloque les routes tant que le natif n'a pas dit l'état de la session : un
 *  écran monté lirait le pont (cache, ressources) avant `session.restore`. */
export function SessionGate({ status, children }: { status: SessionStatus | null; children: ReactNode }) {
  if (!sessionKnown(status)) {
    return (
      <div className="shell">
        <main id="main" tabIndex={-1} className="main">
          <div className="card card--flat" role="status" aria-live="polite" aria-busy="true">
            <p className="t-body-m" style={{ margin: 0 }}>
              Vérification…
            </p>
          </div>
        </main>
      </div>
    );
  }
  return <>{children}</>;
}
