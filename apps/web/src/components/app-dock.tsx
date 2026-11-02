import { currentUser } from "@/lib/session";
import { AppDockClient } from "./app-dock-client";

/**
 * The dock, for a signed-in visitor only: the landing page owns the
 * signed-out case, and a record button for nobody is a dead target.
 */
export async function AppDock() {
  const user = await currentUser();
  if (!user) return null;
  return <AppDockClient />;
}
