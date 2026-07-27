import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireRole } from "../middleware/auth";

export const pipelineLeadsRouter = Router();
pipelineLeadsRouter.use(requireRole("admin", "sales_head"));

pipelineLeadsRouter.get("/", async (_req, res) => {
  const leads = await prisma.pipelineLead.findMany({
    orderBy: { createdAt: "desc" },
    // Real imports run into the thousands — this is a generous safety cap,
    // not a practical page size like the old take: 500 was.
    take: 20000,
  });
  res.json({ leads });
});

// State x Industry pivot — "Industry" is whatever free-text values the
// uploaded file actually used (Hospitality/Healthcare/Corporate/etc.), not a
// fixed enum, so this reflects real data rather than a hardcoded taxonomy.
pipelineLeadsRouter.get("/summary-by-state", async (_req, res) => {
  const groups = await prisma.pipelineLead.groupBy({
    by: ["state", "industry"],
    _count: { _all: true },
  });

  const industriesSet = new Set<string>();
  const stateMap = new Map<string, Map<string, number>>();

  for (const g of groups) {
    const state = g.state ?? "Unspecified";
    const industry = g.industry ?? "Unspecified";
    industriesSet.add(industry);
    if (!stateMap.has(state)) stateMap.set(state, new Map());
    stateMap.get(state)!.set(industry, g._count._all);
  }

  const industries = [...industriesSet].sort();
  const rows = [...stateMap.entries()]
    .map(([state, counts]) => {
      const countsByIndustry: Record<string, number> = {};
      let total = 0;
      for (const industry of industries) {
        const count = counts.get(industry) ?? 0;
        countsByIndustry[industry] = count;
        total += count;
      }
      return { state, counts: countsByIndustry, total };
    })
    .sort((a, b) => b.total - a.total);

  const grandTotals: Record<string, number> = {};
  for (const industry of industries) {
    grandTotals[industry] = rows.reduce((sum, r) => sum + r.counts[industry], 0);
  }

  res.json({ industries, rows, grandTotals });
});
