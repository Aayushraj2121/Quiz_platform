import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error-handler.js';
import { signAdminToken } from '../auth/jwt.js';

export const loginAdmin = async (
  prisma: PrismaClient,
  username: string,
  password: string
) => {
  const admin = await prisma.admin.findUnique({ where: { username } });
  const valid = admin ? await bcrypt.compare(password, admin.passwordHash) : false;

  if (!admin || !valid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
  }

  return {
    token: signAdminToken({ sub: admin.id, username: admin.username }),
    admin: { id: admin.id, username: admin.username }
  };
};
