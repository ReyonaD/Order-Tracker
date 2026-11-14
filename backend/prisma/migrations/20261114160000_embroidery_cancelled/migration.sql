-- cancelled orders show CANCELED in the order status column too
INSERT INTO "EmbOption" ("id","column","value","color","position")
VALUES ('embopt_os_cancel','orderStatus','CANCELED','#dc2626',1)
ON CONFLICT ("column","value") DO NOTHING;
UPDATE "EmbOrder" SET "orderStatus" = 'CANCELED' WHERE "ssStatus" = 'cancelled' AND "orderStatus" IS NULL;
