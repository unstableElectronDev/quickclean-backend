import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const brandsRouter = Router();

brandsRouter.get("/", requireAuth, async (_req, res) => {
  const brands = await prisma.brand.findMany({
    select: { id: true, name: true, parentGroup: true },
    orderBy: [{ parentGroup: "asc" }, { name: "asc" }],
  });
  res.json({ brands });
});

const createBrandSchema = z.object({
  name: z.string().min(1).max(120),
  parentGroup: z.string().min(1).max(100),
});

brandsRouter.post("/", requireRole("admin"), async (req, res) => {
  const parsed = createBrandSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const brand = await prisma.brand.create({
    data: {
      name: parsed.data.name,
      parentGroup: parsed.data.parentGroup,
      createdById: BigInt(req.user!.id),
    },
    select: { id: true, name: true, parentGroup: true },
  });

  res.status(201).json({ brand });
});
