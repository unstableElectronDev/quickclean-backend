import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { FILTER_KEYS, getAllowedFilterKeys } from "../lib/filter-permissions";

export const filterPermissionsRouter = Router();
filterPermissionsRouter.use(requireAuth);

filterPermissionsRouter.get("/mine", async (req, res) => {
  const allowed = await getAllowedFilterKeys(req.user!.role);
  res.json({ filterKeys: Array.from(allowed) });
});

filterPermissionsRouter.get("/", requireRole("admin"), async (_req, res) => {
  const rows = await prisma.filterPermission.findMany({ orderBy: { filterKey: "asc" } });
  res.json({ permissions: rows });
});

const ROLES = ["sales_head", "executive"] as const;
const updateSchema = z.object({
  permissions: z.array(
    z.object({
      filterKey: z.enum(FILTER_KEYS),
      allowedRoles: z.array(z.enum(ROLES)),
    })
  ),
});

filterPermissionsRouter.put("/", requireRole("admin"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const userId = BigInt(req.user!.id);
  await prisma.$transaction(
    parsed.data.permissions.map((p) =>
      prisma.filterPermission.upsert({
        where: { filterKey: p.filterKey },
        update: { allowedRoles: p.allowedRoles, updatedById: userId },
        create: { filterKey: p.filterKey, allowedRoles: p.allowedRoles, updatedById: userId },
      })
    )
  );

  const rows = await prisma.filterPermission.findMany({ orderBy: { filterKey: "asc" } });
  res.json({ permissions: rows });
});
