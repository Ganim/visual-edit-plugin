import { useQuery } from '@tanstack/react-query';
import { User } from '../schemas/user.schema.js';

async function fetchUser(): Promise<User> {
  // Try fetch first — MSW intercepts /api/users/me when the service worker is active.
  // On the first page load the SW may not have claimed the page yet (service worker
  // spec: a SW only controls pages navigated to *after* it activated). In that case
  // the fetch returns a 404 from Vite, so we fall back to __VE_MOCKS.makeUser() when
  // available. This keeps the preview working regardless of SW timing.
  try {
    const resp = await fetch('/api/users/me');
    if (!resp.ok) throw new Error(`fetch /api/users/me returned ${resp.status}`);
    return User.parse(await resp.json());
  } catch {
    if (import.meta.env.DEV && (globalThis as Record<string, unknown>).__VE_MOCKS) {
      const mocks = (globalThis as Record<string, unknown>).__VE_MOCKS as
        | { makeUser?: () => unknown }
        | undefined;
      if (mocks?.makeUser) return User.parse(mocks.makeUser());
    }
    throw new Error('fetchUser: fetch failed and no __VE_MOCKS.makeUser fallback');
  }
}

export function useUser() {
  return useQuery({ queryKey: ['user'], queryFn: fetchUser });
}
