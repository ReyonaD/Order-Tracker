-- orders made with a ready-made design: picked here, they leave the "No design yet" list
INSERT INTO "EmbOption" ("id","column","value","color","position")
VALUES ('embopt_ds_ready','designStatus','READY DESIGN','#a7f3d0',0)
ON CONFLICT ("column","value") DO NOTHING;
