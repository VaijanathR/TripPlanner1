// Deterministic, pleasant gradient for a trip that has no photo yet. The same
// trip always gets the same colours.
const COVERS = [
  ["#0b5f73", "#38b6c1"],
  ["#ff8a63", "#f2b544"],
  ["#3b5ba9", "#6fb1e8"],
  ["#2f8f6b", "#a6d96a"],
  ["#8a4fbf", "#f08cc0"],
  ["#c2483d", "#ffb37a"],
];

export function coverGradient(seed) {
  const text = String(seed ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  const [from, to] = COVERS[hash % COVERS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
