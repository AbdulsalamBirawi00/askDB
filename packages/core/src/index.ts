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
export {
  dropHiddenColumns,
  GUARD_MESSAGES,
  guardSql,
  type GuardReason,
  type GuardResult,
  type GuardSchema,
} from "./sql/guard";
export {
  executeReadOnly,
  ExecutorConnectionError,
  MAX_ROWS,
  QUERY_TIMEOUT_MS,
  QueryExecutionError,
  QueryTimeoutError,
  type QueryResult,
  type ResultColumn,
} from "./sql/execute";
export {
  configuredModels,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_OLLAMA_MODEL,
  generateWithFallback,
  NoProviderError,
  ProvidersFailedError,
  shouldFallBack,
  type Generation,
  type ProviderConfig,
  type ProviderName,
} from "./ai/providers";
export {
  buildSqlPrompt,
  CHART_TYPES,
  describeSchema,
  SQL_INSTRUCTIONS,
  sqlGenerationSchema,
  type ChartType,
  type PromptTable,
  type SqlGeneration,
} from "./ai/prompt";
export { askQuestion, promptTables, type AskOutcome, type AskTable } from "./ask";
