// Port of the shipping-method / pickup logic from handleOrderCreation().

export interface ShippingResult {
  shippingMethod: string;        // raw
  displayShippingMethod: string; // label shown in the UI
  isPickup: boolean;
}

const PICKUP_KEYWORDS = [
  "pick-up",
  "pickup",
  "pick up",
  "store",
  "cheetahdtf fort worth",
  "indiana dtf print",
];

export function resolveShipping(
  storeCode: string,
  shippingLines: Array<{ title?: string }> | undefined
): ShippingResult {
  const shippingMethod =
    shippingLines && shippingLines.length > 0 && shippingLines[0].title
      ? shippingLines[0].title
      : "Pick-up";

  const lower = shippingMethod.toLowerCase();
  const isPickup =
    PICKUP_KEYWORDS.some((k) => lower.includes(k)) ||
    shippingMethod === "Pick-up" ||
    // PROMO pickup locations are named like "Houston, TX Location" (no "pickup" word).
    (storeCode === "PROMO" && lower.includes("location"));

  const isPortland = lower.includes("portland");
  const isSeattle = lower.includes("seattle");
  const isSanFrancisco = lower.includes("san francisco");

  let displayShippingMethod: string;

  if (isPickup) {
    if (storeCode === "WESTCOAST") {
      if (isPortland) displayShippingMethod = "Portland Pick-up";
      else if (isSeattle) displayShippingMethod = "Seattle Pick-up";
      else if (isSanFrancisco) displayShippingMethod = "San Francisco Pick-up";
      else displayShippingMethod = "Pick-up";
    } else if (storeCode === "PROMO") {
      // PROMO has several pickup locations — label by city, else plain "Pickup".
      if (lower.includes("houston")) displayShippingMethod = "Houston Pickup";
      else if (lower.includes("plano")) displayShippingMethod = "Plano Pickup";
      else if (lower.includes("mesquite")) displayShippingMethod = "Mesquite Pickup";
      else if (lower.includes("richardson")) displayShippingMethod = "Richardson Pickup";
      else displayShippingMethod = "Pickup";
    } else {
      // All other stores (incl. PICASSO) just show a plain "Pick-up".
      displayShippingMethod = "Pick-up";
    }
  } else {
    displayShippingMethod = shippingMethod;
  }

  return { shippingMethod, displayShippingMethod, isPickup };
}
