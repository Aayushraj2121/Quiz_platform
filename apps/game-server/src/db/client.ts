import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
