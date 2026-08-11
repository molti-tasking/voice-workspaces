import { configuredProviders } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { AccountMenuClient } from "./account-menu-client";

/**
 * The account control for page headers.
 *
 * A server component so the provider list and the session are read where they
 * already live, rather than shipping either to the client. Renders nothing when
 * nobody is signed in — the landing page owns that case, and an avatar for "no
 * one" is just a dead target.
 */
export async function AccountMenu() {
  const user = await currentUser();
  if (!user) return null;

  return (
    <AccountMenuClient
      user={{
        name: user.name ?? null,
        email: user.email ?? null,
        image: user.image ?? null,
        // `isAnonymous` is added to the user model by the anonymous plugin.
        isGuest: (user as { isAnonymous?: boolean | null }).isAnonymous === true,
      }}
      providers={configuredProviders()}
    />
  );
}
