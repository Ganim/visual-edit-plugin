import { useQuery } from '@tanstack/react-query';
import { User } from '../schemas/user.schema.js';

async function fetchUser(): Promise<User> {
  // Always goes through fetch — in Visual Edit, MSW intercepts /api/users/me.
  const resp = await fetch('/api/users/me');
  return User.parse(await resp.json());
}

export function useUser() {
  return useQuery({ queryKey: ['user'], queryFn: fetchUser });
}
