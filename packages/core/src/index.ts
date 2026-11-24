/**
 * @askdb/core — the engine. Takes a connection, a question, and options; returns a result.
 * Never imports from apps/*, Next.js, or the auth library.
 */
export { decryptSecret, DecryptionError, encryptSecret, parseEncryptionKey } from "./crypto";
export {
  ConnectionFailedError,
  inspectDatabase,
  MAX_TABLES,
  testConnection,
  type ColumnReference,
  type DatabaseInspection,
  type IntrospectedColumn,
  type IntrospectedTable,
} from "./schema/introspect";
export { isSensitiveColumnName } from "./schema/sensitive";
export {
  assertPublicHost,
  ConnectionUrlError,
  isPrivateAddress,
  parseConnectionUrl,
  validateConnectionUrl,
  type LookupFn,
} from "./sql/connection-url";
