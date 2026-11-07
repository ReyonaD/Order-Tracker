-- Gildan 3000 Heather Dark Grey also comes in Small (left out of the first seed).
INSERT INTO "StockProduct" ("name", "category", "unit", "minStock", "shopifyKey")
VALUES ('Gildan 3000 · Heather Dark Grey · S', 'T-Shirt', 'pcs', 3, 'cheetah|gildan light cotton t-shirt|small/dark grey heather')
ON CONFLICT DO NOTHING;

INSERT INTO "StockLevel" ("warehouseId", "productId", "quantity", "tracked")
SELECT w."id", p."id", 0, (upper(w."name") = 'CHEETAH')
FROM "StockProduct" p CROSS JOIN "StockWarehouse" w
WHERE p."shopifyKey" = 'cheetah|gildan light cotton t-shirt|small/dark grey heather'
ON CONFLICT DO NOTHING;
