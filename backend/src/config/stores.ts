// Store configuration extracted from the original Apps Script.
// Used to seed the Store table. After seeding, stores are managed in the DB.
//
// Cutoff hours: orders placed after this hour roll their deadline to the next day.
// GANGROLL used 11:00 in the original code; all others 14:00, WESTCOAST 15:00.
// Timezones are best-guess defaults — confirm real store timezones before go-live.

export interface StoreSeed {
  code: string;
  name: string;
  color: string;
  shopifyIdentifier: string;
  timezone: string;
  pickupCutoffHour: number;
  shippingCutoffHour: number;
}

export const STORE_SEEDS: StoreSeed[] = [
  { code: "PICASSO",   name: "Picasso Prints",    color: "#00C2E2", shopifyIdentifier: "picassoprints", timezone: "America/Chicago",     pickupCutoffHour: 14, shippingCutoffHour: 14 },
  { code: "CHEETAH",   name: "Cheetah DTF",       color: "#F7B509", shopifyIdentifier: "616038-64",     timezone: "America/Chicago",     pickupCutoffHour: 14, shippingCutoffHour: 14 },
  { code: "GANGROLL",  name: "Gang Roll",         color: "#FF857F", shopifyIdentifier: "bs0ymc-dz",     timezone: "America/Chicago",     pickupCutoffHour: 11, shippingCutoffHour: 11 },
  { code: "INDIANA",   name: "Indiana DTF",       color: "#FFD8A9", shopifyIdentifier: "cf456a-4a",     timezone: "America/Indiana/Indianapolis", pickupCutoffHour: 14, shippingCutoffHour: 14 },
  { code: "BOSTONIAN", name: "Bostonian",         color: "#8ED081", shopifyIdentifier: "4f529a-f8",     timezone: "America/New_York",    pickupCutoffHour: 14, shippingCutoffHour: 14 },
  { code: "LUISVILLE", name: "Louisville",        color: "#ecc688", shopifyIdentifier: "rqs5hs-e0",     timezone: "America/New_York",    pickupCutoffHour: 14, shippingCutoffHour: 14 },
  { code: "MUSICCITY", name: "Music City",        color: "#f756d9", shopifyIdentifier: "7ef9fd-9c",     timezone: "America/Chicago",     pickupCutoffHour: 14, shippingCutoffHour: 14 },
  { code: "WESTCOAST", name: "West Coast",        color: "#B39DDB", shopifyIdentifier: "be6aef-8b",     timezone: "America/Los_Angeles", pickupCutoffHour: 15, shippingCutoffHour: 15 },
  { code: "PROMO",     name: "DTF Promo",         color: "#F8873F", shopifyIdentifier: "dtfpromo",      timezone: "America/Chicago",     pickupCutoffHour: 14, shippingCutoffHour: 14 },
  { code: "MISSOURI",  name: "Missouri DTF",      color: "#775CAD", shopifyIdentifier: "9c2725-85",     timezone: "America/Chicago",     pickupCutoffHour: 14, shippingCutoffHour: 14 },
];
