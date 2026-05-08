// Presentation helpers shared between the Deliver stage page and the
// stand-alone Constellation projects page. Keep this module thin — it owns
// the rules that translate Constellation's project status / health-status
// strings into UI tokens (colors, labels, Badge variants) so the two pages
// can't drift apart.

export function healthColor(status: string | null): string {
  if (!status) return "text-muted-foreground";
  const s = status.toLowerCase();
  if (s === "green" || s === "on_track") return "text-emerald-400";
  if (s === "amber" || s === "at_risk") return "text-amber-400";
  if (s === "red" || s === "off_track") return "text-rose-400";
  return "text-muted-foreground";
}

export function healthLabel(status: string | null): string {
  if (!status) return "—";
  const map: Record<string, string> = {
    green: "On track",
    on_track: "On track",
    amber: "At risk",
    at_risk: "At risk",
    red: "Off track",
    off_track: "Off track",
  };
  return map[status.toLowerCase()] ?? status;
}

export function projectStatusVariant(
  status: string,
): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "completed") return "secondary";
  return "outline";
}
