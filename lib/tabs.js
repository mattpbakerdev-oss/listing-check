// On phones the one screen becomes four tabs. Desktop shows everything at once; the tab only
// decides what is visible under 900px. Targets are element ids a step, a Next button or the
// header ring can scroll to.
export const TABS = Object.freeze([
  { id: "draft", label: "Draft" },
  { id: "check", label: "Check" },
  { id: "rewrite", label: "Rewrite" },
  { id: "export", label: "Export" },
]);

export function tabForTarget(id) {
  if (id === "results") return "check";
  if (id === "rewrite" || id === "export") return id;
  return "draft";
}

// What each tab's mark shows, from the same step statuses that drive the desktop stepper.
// "done" is a tick, "partial" a small amber dot, "none" nothing. Check has no step of its own.
export function tabStatuses(steps) {
  const by = Object.fromEntries(steps.map((s) => [s.id, s.status]));
  const form = ["listing", "unit", "price"].map((id) => by[id]);
  const draft = form.every((s) => s === "done") ? "done" : form.some((s) => s === "done" || s === "partial") ? "partial" : "none";
  const of = (id) => (by[id] === "done" ? "done" : "none");
  return { draft, check: "none", rewrite: of("rewrite"), export: of("export") };
}
