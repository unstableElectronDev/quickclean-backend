import { randomBytes } from "crypto";

export const INVITE_EXPIRY_DAYS = 7;

export function generateInviteToken() {
  return randomBytes(32).toString("hex");
}

export function inviteExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + INVITE_EXPIRY_DAYS);
  return d;
}
