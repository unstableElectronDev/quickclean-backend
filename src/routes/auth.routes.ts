import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { generateInviteToken, inviteExpiryDate } from "../lib/invite";
import {
  signSession,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_MS,
} from "../lib/jwt";
import { requireAuth, requireRole } from "../middleware/auth";

export const authRouter = Router();

const isProd = process.env.NODE_ENV === "production";

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || user.status !== "active") {
    return res.status(401).json({ error: "Incorrect email or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }

  const token = signSession({
    id: user.id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  });
  setSessionCookie(res, token);

  return res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const setPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

authRouter.post("/set-password", async (req, res) => {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { token, password } = parsed.data;

  const user = await prisma.user.findFirst({ where: { inviteToken: token } });
  if (!user || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
    return res.status(400).json({ error: "This invite link is invalid or has expired" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      status: "active",
      inviteToken: null,
      inviteExpiresAt: null,
    },
  });

  res.json({ ok: true });
});

const resendSchema = z.object({
  userId: z.string().min(1),
});

authRouter.post("/resend-invite", requireRole("admin"), async (req, res) => {
  const parsed = resendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.findUnique({ where: { id: BigInt(parsed.data.userId) } });
  if (!user || user.status !== "invited") {
    return res.status(400).json({ error: "User is not in an invited state" });
  }

  const inviteToken = generateInviteToken();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      inviteToken,
      inviteExpiresAt: inviteExpiryDate(),
      updatedById: BigInt(req.user!.id),
    },
  });

  const inviteLink = `${process.env.FRONTEND_URL}/set-password?token=${inviteToken}`;
  res.json({ inviteLink });
});
