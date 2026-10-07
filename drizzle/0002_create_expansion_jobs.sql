CREATE TABLE "expansion_jobs" (
	"alarm_id" uuid PRIMARY KEY NOT NULL,
	"enqueued_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"cursor_kind" text,
	"cursor_token" text,
	"completed_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expansion_jobs_status_check" CHECK ("expansion_jobs"."status" IN ('IN_PROGRESS', 'COMPLETED', 'STOPPED')),
	CONSTRAINT "expansion_jobs_cursor_kind_check" CHECK ("expansion_jobs"."cursor_kind" IN ('FIRST', 'NEXT')),
	CONSTRAINT "expansion_jobs_in_progress_columns_check" CHECK ("expansion_jobs"."status" <> 'IN_PROGRESS' OR "expansion_jobs"."cursor_kind" IS NOT NULL),
	CONSTRAINT "expansion_jobs_next_cursor_columns_check" CHECK ("expansion_jobs"."cursor_kind" IS DISTINCT FROM 'NEXT' OR "expansion_jobs"."cursor_token" IS NOT NULL),
	CONSTRAINT "expansion_jobs_completed_columns_check" CHECK ("expansion_jobs"."status" <> 'COMPLETED' OR "expansion_jobs"."completed_at" IS NOT NULL),
	CONSTRAINT "expansion_jobs_stopped_columns_check" CHECK ("expansion_jobs"."status" <> 'STOPPED' OR "expansion_jobs"."stopped_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "expansion_jobs" ADD CONSTRAINT "expansion_jobs_alarm_id_alarms_id_fk" FOREIGN KEY ("alarm_id") REFERENCES "public"."alarms"("id") ON DELETE no action ON UPDATE no action;