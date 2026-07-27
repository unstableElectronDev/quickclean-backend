import type { PrismaClient, Prisma } from "@prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;

export async function findBrand(client: Client, name: string, parentGroup: string) {
  return client.brand.findFirst({ where: { name, parentGroup } });
}

export async function findOrCreateBrand(client: Client, name: string, parentGroup: string, userId: bigint) {
  const existing = await findBrand(client, name, parentGroup);
  if (existing) return existing;
  return client.brand.create({ data: { name, parentGroup, createdById: userId } });
}
