import { configuredProviders } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { NavMenuClient } from "./nav-menu-client";

/**
 * The control at the top right of every signed-in page.
 *
 * Was `AccountMenu`, and still is one — it has simply absorbed the rest of the
 * navigation. The dock at the bottom carries the two surfaces a participant
 * works in; everything else (the ways of reading the whole corpus, the study
 * sheet, the account itself) is occasional, and occasional things belong
 * behind one control rather than in five slightly different header rows.
 *
 * A server component so the provider list and the session are read where they
 * already live, rather than shipping either to the client. Renders nothing
 * when nobody is signed in — the landing page owns that case, and an avatar
 * for "no one" is just a dead target.
 */
export async function NavMenu() {
  const user = await currentUser();
  if (!user) return null;

  return (
    <NavMenuClient
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
