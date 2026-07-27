import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@quickclean.internal";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      name: "Founder's Office Admin",
      email: ADMIN_EMAIL,
      role: "admin",
      status: "active",
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
    },
  });
  console.log(`Admin user ready: ${admin.email}`);

  // GLOBAL room-load benchmarks — star category x property type lookup, used
  // as the fallback when a client group has no group-specific override.
  const roomLoad: Array<{ star: number; type: "Hotel" | "Resort"; kg: number }> = [
    { star: 3, type: "Hotel", kg: 8.5 },
    { star: 3, type: "Resort", kg: 9.5 },
    { star: 4, type: "Hotel", kg: 10.5 },
    { star: 4, type: "Resort", kg: 12.0 },
    { star: 5, type: "Hotel", kg: 13.5 },
    { star: 5, type: "Resort", kg: 15.5 },
  ];
  for (const row of roomLoad) {
    await prisma.roomLoadBenchmark.upsert({
      where: {
        parentGroup_starCategory_propertyType: {
          parentGroup: "GLOBAL",
          starCategory: row.star,
          propertyType: row.type,
        },
      },
      update: { perRoomLoadKg: row.kg },
      create: {
        parentGroup: "GLOBAL",
        starCategory: row.star,
        propertyType: row.type,
        perRoomLoadKg: row.kg,
        createdById: admin.id,
      },
    });
  }
  console.log(`Seeded ${roomLoad.length} GLOBAL room-load benchmark rows`);

  // Sample brand + client-group benchmark so the calc engine (Phase 3) has
  // real numbers to compute against during development.
  let brand = await prisma.brand.findFirst({ where: { name: "Sample Hotels", parentGroup: "SAMPLE" } });
  if (!brand) {
    brand = await prisma.brand.create({
      data: {
        name: "Sample Hotels",
        parentGroup: "SAMPLE",
        createdById: admin.id,
      },
    });
  }
  console.log(`Sample brand ready: ${brand.name} (${brand.parentGroup})`);

  await prisma.clientGroupBenchmark.upsert({
    where: { parentGroup: "SAMPLE" },
    update: {},
    create: {
      parentGroup: "SAMPLE",
      avgOccupancy: 68.0,
      clientWaterRateKlPerKg: 0.015,
      clientEnergyRateKwhPerKg: 0.35,
      clientCostPerKg: 45.0,
      qcWaterRateKlPerKg: 0.009,
      qcEnergyRateKwhPerKg: 0.2,
      qcPricePerKg: 32.0,
      oplThresholdLoadDay: 400,
      oplThresholdLoadMonth: 12000,
      linenWastePerRoomKgYr: 18.0,
      co2eFactorPerKgLinen: 0.42,
      kgCo2PerTree: 21.0,
      createdById: admin.id,
    },
  });
  console.log("Sample client-group benchmark ready for SAMPLE");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
