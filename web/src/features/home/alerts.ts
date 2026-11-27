// Alertes et capacités de navigation : une capacité inconnue montre tout.
import { asObject, boundedText, payloadRoot, rowsOf } from "./payload";

export interface Alert {
  id: string;
  kind: string;
  excerpt: string;
  source: string;
}

export function parseAlerts(payload: string | null): Alert[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: Alert[] = [];
  for (const row of rowsOf(root, "alerts", 50)) {
    const item = asObject(row);
    if (!item) continue;
    out.push({
      id: boundedText(item["id"], 64),
      kind: boundedText(item["kind"], 40),
      excerpt: boundedText(item["excerpt"], 200),
      source: boundedText(item["source"], 100),
    });
  }
  return out;
}

export function alertCountLabel(count: number): string {
  if (count <= 0) return "Aucune alerte";
  return count === 1 ? "1 alerte" : `${count} alertes`;
}

/** `null` = inconnu, donc on montre tout : jamais une navigation amputée sur
 *  une supposition. */
export function parseCapabilities(payload: string | null): string[] | null {
  const root = payloadRoot(payload);
  if (!root) return null;
  const holder = asObject(root["capabilities"]) ?? asObject(root["items"]);
  if (!holder) return null;
  const tabs = holder["tabs"];
  if (!Array.isArray(tabs)) return null;
  const out: string[] = [];
  for (const raw of tabs.slice(0, 40)) {
    const tab = boundedText(raw, 40);
    if (tab && !out.includes(tab)) out.push(tab);
  }
  return out;
}

export function tabVisible(capabilities: string[] | null, tab: string): boolean {
  return capabilities === null || capabilities.includes(tab);
}
