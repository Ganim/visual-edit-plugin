import { z } from 'zod';

export const User = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().min(0),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof User>;
