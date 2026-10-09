-- RUSH: a priority level above urgent, set by the floor when a file name starts with "+++".
ALTER TABLE "Order" ADD COLUMN "rush" BOOLEAN NOT NULL DEFAULT false;
