CREATE TABLE "rate_limiters" (
	"name" text PRIMARY KEY NOT NULL,
	"theoretical_arrival_at" timestamp with time zone NOT NULL,
	"held_until" timestamp with time zone NOT NULL
);
