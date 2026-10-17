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
