import { useQuery } from '@tanstack/react-query';
import { User } from '../schemas/user.schema.js';

declare global {
  interface Window { __VE_MOCKS?: { makeUser?: () => unknown } }
}

async function fetchUser(): Promise<User> {
  // In Visual Edit, __VE_MOCKS.makeUser() resolves; in a real build, fetch from API.
  const mock = (globalThis as unknown as Window).__VE_MOCKS?.makeUser;
  if (mock) return User.parse(mock());
  const resp = await fetch('/api/user');
  return User.parse(await resp.json());
}

export function useUser() {
  return useQuery({ queryKey: ['user'], queryFn: fetchUser });
}
