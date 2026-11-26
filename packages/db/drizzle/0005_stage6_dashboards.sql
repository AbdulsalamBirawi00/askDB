CREATE TABLE "dashboard_items" (
	"id" text PRIMARY KEY NOT NULL,
	"dashboard_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"title" text NOT NULL,
	"sql" text NOT NULL,
	"chart_type" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"share_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboards_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "query_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"result_json" jsonb NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_items" ADD CONSTRAINT "dashboard_items_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_items" ADD CONSTRAINT "dashboard_items_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_cache" ADD CONSTRAINT "query_cache_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_items_dashboard_id_idx" ON "dashboard_items" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "dashboards_user_id_idx" ON "dashboards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "query_cache_connection_id_idx" ON "query_cache" USING btree ("connection_id");