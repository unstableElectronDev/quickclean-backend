import jwt from "jsonwebtoken";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

const JWT_SECRET: string = requireEnv("JWT_SECRET");
const EXPIRES_IN_DAYS = Number(process.env.JWT_EXPIRES_IN_DAYS ?? 7);

export type SessionPayload = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "sales_head" | "executive";
};

export function signSession(payload: SessionPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${EXPIRES_IN_DAYS}d` });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = "qc_session";
export const SESSION_COOKIE_MAX_AGE_MS = EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000;
