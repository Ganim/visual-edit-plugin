import { z } from 'zod';
export const User = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().min(0).optional(),
  createdAt: z.string().datetime().optional(),
  avatarUrl: z.string().url().optional(),
});
export type User = z.infer<typeof User>;
