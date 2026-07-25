import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { STORE_SEEDS } from "../src/config/stores";

const prisma = new PrismaClient();

async function main() {
  // First-run guard: only seed stores + dropdowns when the DB is empty, so that
  // re-deploys don't resurrect stores/dropdowns an admin has since changed.
  const storeCount = await prisma.store.count();
  if (storeCount > 0) {
    console.log(`Stores already exist (${storeCount}); skipping store/dropdown seed.`);
    await ensureAdmin();
    return;
  }

  // --- Seed stores (idempotent upsert by code) ---
  for (const s of STORE_SEEDS) {
    await prisma.store.upsert({
      where: { code: s.code },
      create: s,
      update: {
        name: s.name,
        color: s.color,
        shopifyIdentifier: s.shopifyIdentifier,
        timezone: s.timezone,
        pickupCutoffHour: s.pickupCutoffHour,
        shippingCutoffHour: s.shippingCutoffHour,
      },
    });
  }
  console.log(`Seeded ${STORE_SEEDS.length} stores`);

  // --- Seed dropdown options from the REAL values in the exported sheet ---
  // Machinist names in the export are inconsistent (Bilal/BILAL/bilal, emre/Emre/…);
  // seeded here as canonical names — admin can adjust in the UI.
  const designers = ["Atiqur", "AHMED", "Didarh", "Muneeb", "Sena G"];
  const machinists = ["Bilal", "Mutlu", "Emre", "Emre Sert", "Muhammet", "Seval", "Emrullah", "Emir", "Aslan"];
  const machines = [
    "Cheetah_Mb_1", "Cheetah_Mb_2", "Cheetah_Mkj_3", "Cheetah_Mkj_4", "Cheetah_UV_1",
    "Picasso_M_1", "Picasso_M_2", "Picasso_M_3", "Picasso_M_4", "Picasso_M_5", "Picasso_UV_1",
  ];
  const uploadStatuses = ["Uploaded", "Problem"];
  const printStatuses = ["Printed", "Not Printed"];

  const dropdownSeeds: Array<{ category: string; value: string; sort: number }> = [
    ...designers.map((v, i) => ({ category: "designer", value: v, sort: i })),
    ...machinists.map((v, i) => ({ category: "machinist", value: v, sort: i })),
    ...machines.map((v, i) => ({ category: "machine", value: v, sort: i })),
    ...uploadStatuses.map((v, i) => ({ category: "uploadStatus", value: v, sort: i })),
    ...printStatuses.map((v, i) => ({ category: "printStatus", value: v, sort: i })),
  ];
  for (const d of dropdownSeeds) {
    await prisma.dropdownOption.upsert({
      where: { category_value: { category: d.category, value: d.value } },
      create: d,
      update: { sort: d.sort },
    });
  }
  console.log(`Seeded ${dropdownSeeds.length} dropdown options`);

  await ensureAdmin();
}

// Create the initial admin user if it doesn't exist yet.
async function ensureAdmin() {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@ordertracker.local").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "changeme123";

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: "Admin",
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: "ADMIN",
      },
    });
    console.log(`Created admin user: ${adminEmail} (password: ${adminPassword})`);
    console.log("!! Change this password after first login.");
  } else {
    console.log(`Admin user already exists: ${adminEmail}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
