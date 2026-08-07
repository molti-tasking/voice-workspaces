import { headers } from "next/headers";
import { getAuth } from "./auth";

/** The signed-in user, or null. */
export async function currentUser() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** The signed-in user's id, or null. Used by API routes to scope every query. */
export async function currentUserId(req: Request): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: req.headers });
  return session?.user.id ?? null;
}
