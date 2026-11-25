ALTER TABLE "queries" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "queries" ADD COLUMN "chart_type" text;--> statement-breakpoint
ALTER TABLE "queries" ADD COLUMN "edited" boolean DEFAULT false NOT NULL;