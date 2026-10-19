import type { Admin } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      admin?: Pick<Admin, 'id' | 'username'>;
    }
  }
}

export {};
