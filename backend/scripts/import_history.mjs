// One-off: import the manual monthly account-tracking CSVs (Jan-June 2026) into
// SheetEntry, classifying each product column into a Sheet category.
// DTF/UV: totalOverride + cheetahPct (warehouse split). Others: totalOverride.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const MONTHS = { OCAK: "01", SUBAT: "02", MART: "03", NISAN: "04", MAYIS: "05", HAZIRAN: "06" };
const YEAR = "2026";

// header keyword -> category (mirrors backend sheetCategories priority; supplies before UV)
const RULES = [
  ["Sublimation", /sublima/],
  ["Cleaning Solution", /cleaning/],
  ["Vinyl Remover", /vinyl/],
  ["Heat Tape", /heat\s*tape/],
  ["Teflon", /teflon/],
  ["DTF Ink", /\bink\b/],
  ["Powder", /powder/],
  ["DTF Film", /\bfilm\b/],
  ["UV", /\buv\b/],
  ["Sweatshirt", /sweat\s*shirt|hoodie|hooded|crew\s*neck/],
  ["Custom Shirt", /t-?shirt|\btee\b|tshirt|custom shirt|bella|canvas|gildan|comfort colors|apparel/],
  ["DTF", /transfer|gang sheet|\bdtf\b/],
];
function classifyHeader(h) {
  const n = (h || "").toLowerCase();
  if (!n.trim()) return null;
  for (const [key, re] of RULES) if (re.test(n)) return key;
  return null;
}

const STORES = {
  PROMO: `,DTF,,,UV,,,CUSTOM SHIRT,Sublimation,Sweatshirt&Hoodie
OCAK,8248,,,4285,,,,,
SUBAT,38739,,,724,,,,,
MART,64204,,,922,,,,,
NISAN,109455.02,44706.98,154162,3932.96,251.04,4184,9,,
MAYIS,221040,56649,277689,5738,0,5738,613,,
HAZIRAN,261431.58,57387.42,318819,7103,,7103,924,300,13`,

  WESTCOAST: `,DTF,,TOTAL,UV,,TOTAL,CUSTOM SHIRT,CLEANING SOLUTION,DTF POWDER,Sublimation
OCAK,27015,,,2010,,,,,,
SUBAT,30375,,,1845,,,,1,,
MART,43700,,,3049.5,,,,,4,
NISAN,33589.78,16544.22,50134,3294.5,,3294.5,,,,
MAYIS,37956,,,2850,,,1,,,
HAZIRAN,34927.2,8192.8,43120,3330,,3330,,,,180`,

  MISSOURI: `,DTF,,,UV,,,CUSTOM SHIRT,DTF INK,Sublimation
OCAK,11607,,,608,,,,,
SUBAT,20418,,,1263,,,,,
MART,37077,,,1735,,,,,
NISAN,25848.86,5674.14,31523,2375,0,2375,,,
MAYIS,35579,6083,41662,1750,0,1750,,,
HAZIRAN,48426.4,6603.6,55030,2915,,2915,,,60`,

  LUISVILLE: `,DTF,,,UV,,,CUSTOM SHIRT,Sweatshirt
OCAK,6812,,,415,,,13,
SUBAT,10641,,,499,,,12,
MART,19445,,,1057.5,,,34,
NISAN,20192.64,5695.36,25888,783.5,0,783.5,37,
MAYIS,26658,1945,28604,1149,0,1149,135,
HAZIRAN,20667.52,3364.48,24032,520,,520,44,`,

  BOSTONIAN: `,DTF,,,UV,,,CUSTOM SHIRT,DTF INK,POWDER,Swewatshirt,Sublimation
OCAK,28912,,,970,,,40,3,,,
SUBAT,25875,,,1080,,,,7,2,,
MART,39733,,,2180,,,57,9,2,,
NISAN,47398.77,11118.23,58517,2380,0,2380,90,6,3,,
MAYIS,43549,4412,47962,1600,0,1600,207,15,10,,
HAZIRAN,53022.15,7922.85,60945,2060,,2060,151,12,4,1,30`,

  INDIANA: `,DTF,,,UV,,,CUSTOM SHIRT,Sweatshirt,Sublimation
OCAK,35137,,,960,,,171,,
SUBAT,39379,,,1280,,,35,,
MART,55654,,,2100,,,30,,
NISAN,49756.45,8780.55,58537,1820,0,1820,25,,
MAYIS,68164,2692,70857,1410,0,1410,135,,
HAZIRAN,74786.4,8309.6,83096,1416.2,43.8,1460,269,5,150`,

  GANGROLL: `,DTF,,,UV,,,Sublimation,CUSTOM SHIRT
OCAK,28117,,,1990,,,,
SUBAT,36126,,,1110,,,,
MART,42742,,,1370,,,,
NISAN,3524.56,40532.44,44057,319.2,1360.8,1680,,
MAYIS,1178,"34,506",35684,248,1172,1420,,
HAZIRAN,22667.97,21779.03,44447,1788.6,921.4,2710,120,`,

  CHEETAH: `,DTF,,,UV,,,CUSTOM SHIRT,POWDER,DTF INK,DAMPER,DATA CABLE,CAPPING STATION,Hot Peel DTF Film,Luminous DTF Film,Gold DTF Film,UV DTF AB Film,Encoder strip,Origin sensor,Leather Journal,Vinyl Removing Solvent,UV Cleaning Solution
OCAK,183152,,,8179,,,191,,,,,,,,,,,,,,
SUBAT,205644,,,9076,,,,2,,,4,2,,,,,,,,,
MART,237140,,,12950.5,,,236,,2,2,,,1,,,1,1,1,1,,
NISAN,23896.89,241624.11,265521,1861.23,11433.27,13294.5,240,6,11,,,,4,,,,,,,3,
MAYIS,"14,920",277640,292560,1100,11546,12646,108,,1,,,,3,1,4,,,,,,1
HAZIRAN,17725.32,277696.68,295422,135.93,13457.07,13593,305,,,,,,,,,,,,,3,`,

  MUSICCITY: `,DTF,,,UV,,,SUBLIMATAION,CUSTOM SHIRT,Hoodie,DTF INK
OCAK,24672,,,1180,,,,83,,
SUBAT,38874,,,1090,,,,90,,
MART,53069,,,2750,,,,69,,2
NISAN,43799.94,10274.06,54074,5690,0,5690,,215,,
MAYIS,45796,7829,53625,3130,0,3130,,191,,5
HAZIRAN,75880.56,5711.44,81592,11620,0,11620,90,250,1,10`,

  PICASSO: `,DTF,,,UV,,,SUBLIMATION,CUSTOM SHIRT,SWEATSHIRT,HEAT TAPE,TEFLON,DTF INK,Hot Peel DTF Film,Luminous DTF Film,Vinyl Remover
OCAK,71439,,,2222,,,,199,,3,1,,,,
SUBAT,74958,,,3793,,,,159,,7,5,,,,
MART,99980.5,,,6326,,,,233,,2,1,,,,
NISAN,103011.2,25752.8,128764,7804,0,7804,,156,47,6,3,,,,
MAYIS,89547,"27,660",117207,7502,0,7502,,777,,,,11,2,1,2`,
};

function parseLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else { if (ch === ",") { out.push(cur); cur = ""; } else if (ch === '"') q = true; else cur += ch; }
  }
  out.push(cur);
  return out;
}
function num(s) {
  if (s == null) return null;
  const t = String(s).replace(/,/g, "").trim();
  if (t === "" || t === "-") return null;
  const v = Number(t);
  return isNaN(v) ? null : v;
}
function typeVals(p, c, t) {
  if (t != null) return { total: t, pct: c != null ? (c / t) * 100 : 0 };
  if (p != null) { const tot = p + (c || 0); return { total: tot, pct: c != null ? (c / tot) * 100 : 0 }; }
  return null;
}

if (!process.env.DRY) await prisma.sheetEntry.deleteMany({});
let upserts = 0;
for (const [code, raw] of Object.entries(STORES)) {
  const lines = raw.split("\n");
  const header = parseLine(lines[0]);
  // classify columns >= 7 (0=month, 1-6 = DTF/UV handled separately)
  const colCat = header.map((h, j) => (j >= 7 ? classifyHeader(h) : null));

  for (let i = 1; i < lines.length; i++) {
    const f = parseLine(lines[i]);
    const mm = MONTHS[(f[0] || "").trim().toUpperCase()];
    if (!mm) continue;
    const month = `${YEAR}-${mm}`;

    // accumulate: DTF/UV as {total,pct}; others summed by category
    const acc = {}; // key -> { total, pct } | { count }
    const dtf = typeVals(num(f[1]), num(f[2]), num(f[3]));
    if (dtf) acc["DTF"] = dtf;
    const uv = typeVals(num(f[4]), num(f[5]), num(f[6]));
    if (uv) acc["UV"] = uv;
    for (let j = 7; j < f.length; j++) {
      const cat = colCat[j];
      if (!cat) continue;
      const v = num(f[j]);
      if (v == null) continue;
      if (!acc[cat]) acc[cat] = { total: 0, pct: null, count: true };
      acc[cat].total += v;
    }

    const put = async (type, totalOverride, cheetahPct) => {
      // historical CSVs only had a Promo/Cheetah split
      const splitPct = cheetahPct != null && cheetahPct > 0 ? { Cheetah: cheetahPct } : null;
      if (process.env.DRY) {
        console.log(`${month} ${code.padEnd(10)} ${type.padEnd(17)} total=${totalOverride}  cheetah%=${cheetahPct == null ? "-" : cheetahPct.toFixed(1)}`);
      } else {
        await prisma.sheetEntry.upsert({
          where: { month_storeCode_type: { month, storeCode: code, type } },
          create: { month, storeCode: code, type, totalOverride, splitPct },
          update: { totalOverride, splitPct },
        });
      }
      upserts++;
    };

    for (const [key, v] of Object.entries(acc)) {
      const pct = key === "DTF" || key === "UV" ? v.pct : null;
      await put(key, v.total, pct);
    }
  }
}
console.log(`history import: ${upserts} SheetEntry rows`);
await prisma.$disconnect();
