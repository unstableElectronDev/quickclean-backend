import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { generateInviteToken, inviteExpiryDate } from "../lib/invite";
import { requireRole } from "../middleware/auth";

export const usersRouter = Router();

usersRouter.use(requireRole("admin"));

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ users });
});

const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(160),
  role: z.enum(["admin", "sales_head", "executive"]),
});

usersRouter.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { name, email, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const inviteToken = generateInviteToken();
  const user = await prisma.user.create({
    data: {
      name,
      email,
      role,
      status: "invited",
      inviteToken,
      inviteExpiresAt: inviteExpiryDate(),
      createdById: BigInt(req.user!.id),
    },
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: BigInt(req.user!.id),
      action: "user.invite",
      entity: "users",
      entityId: user.id,
    },
  });

  const inviteLink = `${process.env.FRONTEND_URL}/set-password?token=${inviteToken}`;
  res.status(201).json({ user, inviteLink });
});

const updateUserSchema = z.object({
  role: z.enum(["admin", "sales_head", "executive"]).optional(),
  status: z.enum(["invited", "active", "deactivated"]).optional(),
});

usersRouter.patch("/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.update({
    where: { id: BigInt(req.params.id) },
    data: { ...parsed.data, updatedById: BigInt(req.user!.id) },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: BigInt(req.user!.id),
      action: "user.update",
      entity: "users",
      entityId: user.id,
      meta: parsed.data,
    },
  });

  res.json({ user });
});

usersRouter.delete("/:id", async (req, res) => {
  const user = await prisma.user.update({
    where: { id: BigInt(req.params.id) },
    data: { status: "deactivated", updatedById: BigInt(req.user!.id) },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: BigInt(req.user!.id),
      action: "user.deactivate",
      entity: "users",
      entityId: user.id,
    },
  });

  res.json({ user });
});
