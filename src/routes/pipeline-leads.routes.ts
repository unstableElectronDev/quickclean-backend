import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireRole } from "../middleware/auth";

export const pipelineLeadsRouter = Router();
pipelineLeadsRouter.use(requireRole("admin", "sales_head"));

pipelineLeadsRouter.get("/", async (_req, res) => {
  const leads = await prisma.pipelineLead.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  res.json({ leads });
});
