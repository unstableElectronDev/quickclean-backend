import type { Request, Response, NextFunction } from "express";
import { verifySession, SESSION_COOKIE_NAME, type SessionPayload } from "../lib/jwt";

declare global {
  namespace Express {
    interface Request {
      user?: SessionPayload;
    }
  }
}

export function attachSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (token) {
    const session = verifySession(token);
    if (session) req.user = session;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

export function requireRole(...roles: SessionPayload["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
