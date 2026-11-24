import "server-only";

import { randomUUID } from "node:crypto";

import {
  ConnectionFailedError,
  ConnectionUrlError,
  decryptSecret,
  encryptSecret,
  inspectDatabase,
  parseEncryptionKey,
  testConnection,
  validateConnectionUrl,
} from "@askdb/core";
import {
  createConnection,
  getOwnedConnectionSecret,
  getVisibleConnectionSecret,
  refreshConnectionSchema,
  type PublicConnection,
} from "@askdb/db";

import { getEnv } from "@/env";
import { getDb } from "@/lib/db";

let key: Buffer | undefined;
const encryptionKey = () => (key ??= parseEncryptionKey(getEnv().CONNECTION_ENCRYPTION_KEY));

/** Shape and SSRF checks. Private hosts only when ALLOW_PRIVATE_DB_HOSTS=true (dev, CI). */
const validate = (raw: string) =>
  validateConnectionUrl(raw, { allowPrivateHosts: getEnv().ALLOW_PRIVATE_DB_HOSTS });

export async function testUserConnection(raw: string): Promise<{ hasWriteAccess: boolean }> {
  return testConnection(await validate(raw));
}

/** Validates, introspects, encrypts (bound to the new row id), and saves. */
export async function addUserConnection(
  userId: string,
  name: string,
  raw: string,
): Promise<PublicConnection> {
  const url = await validate(raw);
  const inspection = await inspectDatabase(url);
  const id = randomUUID();
  return createConnection(getDb(), {
    id,
    userId,
    name,
    encryptedUrl: encryptSecret(url.toString(), encryptionKey(), id),
    inspection,
  });
}

/** Re-introspects an owned connection, keeping notes and hidden flags. False if not owned. */
export async function refreshUserConnection(userId: string, id: string): Promise<boolean> {
  const secret = await getOwnedConnectionSecret(getDb(), id, userId);
  if (!secret) return false;
  // Validate again: the host may resolve somewhere else now.
  const url = await validate(decryptSecret(secret.encryptedUrl, encryptionKey(), secret.id));
  const inspection = await inspectDatabase(url);
  return refreshConnectionSchema(getDb(), { id, userId, inspection });
}

/**
 * The decrypted URL of a connection the user may query (own or demo), checked again
 * against SSRF rules. Null when the user cannot see it. Never leaves the server.
 */
export async function openVisibleConnection(userId: string, id: string): Promise<URL | null> {
  const secret = await getVisibleConnectionSecret(getDb(), id, userId);
  if (!secret) return null;
  return validate(decryptSecret(secret.encryptedUrl, encryptionKey(), secret.id));
}

/** Turns a connection error into a response that reveals nothing about the URL or server. */
export function connectionErrorResponse(error: unknown): Response {
  if (error instanceof ConnectionUrlError) {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  if (error instanceof ConnectionFailedError) {
    return Response.json({ error: error.message, code: "connection_failed" }, { status: 422 });
  }
  throw error;
}
