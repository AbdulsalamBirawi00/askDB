import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

export class DecryptionError extends Error {
  constructor() {
    super("Could not decrypt the stored value");
    this.name = "DecryptionError";
  }
}

/** Decodes a base64 key and checks it is exactly 32 bytes (AES-256). */
export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes, base64-encoded");
  return key;
}

const b64 = (buf: Buffer) => buf.toString("base64url");

/**
 * AES-256-GCM. `context` is bound as associated data (for example the connection id),
 * so a ciphertext copied to another row will not decrypt.
 * Output: `v1.<iv>.<tag>.<ciphertext>`, base64url parts.
 */
export function encryptSecret(plaintext: string, key: Buffer, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join(".");
}

export function decryptSecret(payload: string, key: Buffer, context: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new DecryptionError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DecryptionError();
  }
}
