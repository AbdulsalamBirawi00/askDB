import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const userRole = pgEnum("user_role", ["user", "demo"]);

/**
 * App users. Property names follow Better Auth's core user model (the Drizzle
 * adapter maps by property name); column names are snake_case.
 * Guests ("Try as guest") are anonymous users with role `demo`.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRole("role").notNull().default("user"),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/**
 * Saved database connections. `encrypted_url` is AES-256-GCM ciphertext bound to the row id.
 * `is_demo` marks the shared Northwind connection: every signed-in user can read it,
 * only its owner (the system demo user) can change it. Deleting a user deletes theirs.
 */
export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    encryptedUrl: text("encrypted_url").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    /** The role can write or create objects; the UI shows a warning. */
    hasWriteAccess: boolean("has_write_access").notNull().default(false),
    /** More tables than the introspection limit; only the first ones are stored. */
    schemaTruncated: boolean("schema_truncated").notNull().default(false),
    introspectedAt: timestamp("introspected_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("connections_user_id_idx").on(t.userId)],
);

export type SampleRow = Record<string, unknown>;
export type ColumnReference = { schema: string; table: string; column: string };

/** Tables found by introspection, with the user's note and visibility. */
export const schemaTables = pgTable(
  "schema_tables",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    schemaName: text("schema_name").notNull(),
    tableName: text("table_name").notNull(),
    kind: text("kind", { enum: ["table", "view"] })
      .notNull()
      .default("table"),
    description: text("description"),
    hidden: boolean("hidden").notNull().default(false),
    /** Up to 3 rows, without columns that were sensitive at introspection time. */
    sampleRows: jsonb("sample_rows").$type<SampleRow[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("schema_tables_connection_table_uq").on(t.connectionId, t.schemaName, t.tableName),
  ],
);

export const schemaColumns = pgTable(
  "schema_columns",
  {
    id: text("id").primaryKey(),
    tableId: text("table_id")
      .notNull()
      .references(() => schemaTables.id, { onDelete: "cascade" }),
    columnName: text("column_name").notNull(),
    dataType: text("data_type").notNull(),
    nullable: boolean("nullable").notNull().default(true),
    position: integer("position").notNull(),
    isPrimaryKey: boolean("is_primary_key").notNull().default(false),
    fkRef: jsonb("fk_ref").$type<ColumnReference>(),
    description: text("description"),
    hidden: boolean("hidden").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [unique("schema_columns_table_column_uq").on(t.tableId, t.columnName)],
);

/** A thread of follow-up questions against one connection. */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("conversations_user_id_idx").on(t.userId)],
);

export const queryStatus = pgEnum("query_status", [
  "ok",
  "clarification",
  "rejected",
  "error",
  "timeout",
]);

/** Every question asked: the generated SQL, the outcome, and model metadata. */
export const queries = pgTable(
  "queries",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    sql: text("sql"),
    status: queryStatus("status").notNull(),
    /** Safe, user-facing reason (rejection or execution error). */
    error: text("error"),
    provider: text("provider"),
    model: text("model"),
    tokens: integer("tokens"),
    durationMs: integer("duration_ms"),
    rowCount: integer("row_count"),
    repaired: boolean("repaired").notNull().default(false),
    /** 1 = helpful, -1 = not helpful (Stage 5). */
    rating: integer("rating"),
    createdAt: createdAt(),
  },
  (t) => [index("queries_conversation_id_idx").on(t.conversationId)],
);
