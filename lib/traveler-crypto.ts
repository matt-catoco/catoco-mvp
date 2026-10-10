import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-level column encryption for traveler details (AES-256-GCM). The key
 * is TRAVELER_DATA_KEY: 32 random bytes, base64 — set per environment in
 * Vercel by the founder, never in code or chat. Decryption only happens in
 * server code that has already checked who's asking and logs the view.
 * Format: "v1.<iv b64>.<tag b64>.<ciphertext b64>".
 */
function key(): Buffer | null {
  const raw = process.env.TRAVELER_DATA_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}

export function travelerCryptoConfigured(): boolean {
  return key() !== null;
}

export function encryptJson(data: unknown): string {
  const k = key();
  if (!k) throw new Error("TRAVELER_DATA_KEY is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptJson<T>(blob: string): T {
  const k = key();
  if (!k) throw new Error("TRAVELER_DATA_KEY is not configured");
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognized ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}
