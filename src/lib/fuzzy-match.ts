function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bigrams(s: string): string[] {
  const padded = ` ${s} `;
  const grams: string[] = [];
  for (let i = 0; i < padded.length - 1; i++) {
    grams.push(padded.slice(i, i + 2));
  }
  return grams;
}

// Sorensen-Dice coefficient over character bigrams — simple, dependency-free,
// and good enough for "does this hotel name look like that hotel name."
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const gramsA = bigrams(na);
  const gramsB = bigrams(nb);
  if (gramsA.length === 0 || gramsB.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const g of gramsA) counts.set(g, (counts.get(g) ?? 0) + 1);

  let overlap = 0;
  for (const g of gramsB) {
    const count = counts.get(g) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(g, count - 1);
    }
  }

  return (2 * overlap) / (gramsA.length + gramsB.length);
}
