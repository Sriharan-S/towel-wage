import { useQuery } from "@tanstack/react-query";
import { api, type Role } from "./api";

/**
 * Who is signed in, and what they may reach.
 *
 * The UI hides what a manager cannot use, but hiding is presentation, not
 * security — the Worker enforces the same rules on every request. This exists
 * so the app does not offer a door that will be slammed shut.
 */
export function useRole(): { role: Role; isAdmin: boolean; isManager: boolean } {
  const session = useQuery({
    queryKey: ["auth", "session"],
    queryFn: api.auth.session,
    staleTime: 0,
    retry: false,
  });

  // Default to the narrower role while the session is loading, so nothing
  // admin-only flashes on screen before it is known to be allowed.
  const role: Role = session.data?.role ?? "manager";
  return { role, isAdmin: role === "admin", isManager: role === "manager" };
}

/** Routes a manager has no business on. */
export const ADMIN_ONLY_PATHS = ["/settings", "/workers", "/types"];

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
