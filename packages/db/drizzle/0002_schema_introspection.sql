CREATE TABLE "schema_columns" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"column_name" text NOT NULL,
	"data_type" text NOT NULL,
	"nullable" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"is_primary_key" boolean DEFAULT false NOT NULL,
	"fk_ref" jsonb,
	"description" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schema_columns_table_column_uq" UNIQUE("table_id","column_name")
);
--> statement-breakpoint
CREATE TABLE "schema_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"schema_name" text NOT NULL,
	"table_name" text NOT NULL,
	"kind" text DEFAULT 'table' NOT NULL,
	"description" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"sample_rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schema_tables_connection_table_uq" UNIQUE("connection_id","schema_name","table_name")
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "has_write_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "schema_truncated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "introspected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schema_columns" ADD CONSTRAINT "schema_columns_table_id_schema_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."schema_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_tables" ADD CONSTRAINT "schema_tables_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;