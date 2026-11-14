// Public Code 128 barcode images for ShipStation packing slips:
//   <img src="https://<order tracker>/barcode/[Order #].png">
// A plain path (no query string), because ShipStation's slip renderer drops images whose
// URL has one. Only digits, letters and - are accepted; an order number is not a secret.
import { Router } from "express";
import bwipjs from "bwip-js";

export const barcodeRouter = Router();

barcodeRouter.get("/:code.png", async (req, res) => {
  const code = String(req.params.code ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(code)) { res.status(400).send("bad code"); return; }
  try {
    const png = await bwipjs.toBuffer({ bcid: "code128", text: code, scale: 3, height: 12, includetext: true, textxalign: "center" });
    res.set({ "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" }).send(png);
  } catch {
    res.status(400).send("bad code");
  }
});
