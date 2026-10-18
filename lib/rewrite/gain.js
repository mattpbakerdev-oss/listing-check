// The rewrite only touches the title and the description, so the most it can recover is what those
// two are short of full marks. Shown on the Rewrite tab before a rewrite, as "worth up to N points".
export function projectedGain(fields) {
  const deficit = (id, max) => {
    const f = fields.find((x) => x.field === id);
    return Math.round(((f?.points ?? max) - (f?.earned ?? 0)) * 10) / 10;
  };
  const title = deficit("title", 10), description = deficit("description", 15);
  return { points: Math.round((title + description) * 10) / 10, title, description };
}
