import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptSecret, DecryptionError, encryptSecret, parseEncryptionKey } from "../src";

const key = randomBytes(32);
const url =
  "postgres://readonly_demo:S3cr3t-P%40ss@ep-cool-name.eu-central-1.aws.neon.tech/neondb?sslmode=require";

describe("connection URL encryption", () => {
  it("T2.4 encrypt then decrypt returns the exact original URL", () => {
    expect(decryptSecret(encryptSecret(url, key, "conn-1"), key, "conn-1")).toBe(url);
  });

  it("T2.3 the stored value is ciphertext that does not contain the URL or its parts", () => {
    const stored = encryptSecret(url, key, "conn-1");
    for (const part of [url, "readonly_demo", "S3cr3t", "neon.tech", "neondb", "postgres"]) {
      expect(stored).not.toContain(part);
    }
    expect(stored).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    // A fresh IV each time: the same URL never produces the same ciphertext.
    expect(encryptSecret(url, key, "conn-1")).not.toBe(stored);
  });

  it("refuses a wrong key, a different row (context), or a tampered value", () => {
    const stored = encryptSecret(url, key, "conn-1");
    expect(() => decryptSecret(stored, randomBytes(32), "conn-1")).toThrow(DecryptionError);
    expect(() => decryptSecret(stored, key, "conn-2")).toThrow(DecryptionError);
    const [v, iv, tag, ct] = stored.split(".");
    const flipped = ct!.startsWith("A") ? `B${ct!.slice(1)}` : `A${ct!.slice(1)}`;
    expect(() => decryptSecret([v, iv, tag, flipped].join("."), key, "conn-1")).toThrow(
      DecryptionError,
    );
    expect(() => decryptSecret("garbage", key, "conn-1")).toThrow(DecryptionError);
  });

  it("accepts only a 32-byte base64 key", () => {
    expect(parseEncryptionKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
