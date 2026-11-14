-- the old sheet's real choices
DELETE FROM "EmbOption" WHERE "id" IN ('embopt_lt_logo','embopt_lt_text');
UPDATE "EmbOption" SET "value" = 'NEED MOCKUP' WHERE "id" = 'embopt_os_mock';
UPDATE "EmbOrder" SET "orderStatus" = 'NEED MOCKUP' WHERE "orderStatus" = 'NEED MOCK';
INSERT INTO "EmbOption" ("id","column","value","color","position") VALUES
 ('embopt_os_hold','orderStatus','HOLD','#fde68a',2),
 ('embopt_lt_jlogo','logoOrText','JUST LOGO','#d9f99d',0),
 ('embopt_lt_jtext','logoOrText','JUST TEXT','#ddd6fe',1),
 ('embopt_lt_both','logoOrText','LOGO AND TEXT','#fecaca',2)
ON CONFLICT ("column","value") DO NOTHING;
