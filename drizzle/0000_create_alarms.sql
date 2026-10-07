CREATE TABLE "alarms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"recipient_ids" text[] NOT NULL,
	"status" text NOT NULL,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alarms_kind_check" CHECK ("alarms"."kind" in ('BULK', 'URGENT')),
	CONSTRAINT "alarms_status_check" CHECK ("alarms"."status" in ('DRAFT', 'DISPATCHING', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX "alarms_created_at_id_idx" ON "alarms" USING btree ("created_at","id");