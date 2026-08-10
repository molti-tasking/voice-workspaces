import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins/anonymous";
import { getDb, schema } from "@voicemural/db";
import { migrateGuestData } from "@voicemural/db/link-guest";
import { seedStarterRepertoire } from "@voicemural/db/seed";
import { capture, mergeGuestIntoUser } from "@/lib/analytics/server";
import type { SocialProvider } from "@/lib/providers";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

/**
 * The public origin this app is served from.
 *
 * Treats empty as unset on purpose: `docker-compose.prod.yml` passes
 * `BETTER_AUTH_URL=${BETTER_AUTH_URL}`, so a variable that is simply absent from
 * the deployment environment arrives as `""`. `??` would accept that, leaving
 * Better Auth with no origin to compare against and failing every sign-in — and
 * every guest creation — with a bare "Invalid origin" that says nothing about
 * the actual cause. Cost us a deploy to work out once already.
 *
 * Only production throws. Dev keeps working with no configuration at all, which
 * is what makes a fresh clone runnable with nothing but a database.
 */
function baseUrl(): string {
  const raw = process.env.BETTER_AUTH_URL?.trim();
  if (raw) {
    // A trailing slash yields `https://host//api/auth/callback/github`, which
    // will not match the callback registered on the GitHub OAuth app.
    return raw.replace(/\/+$/, "");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BETTER_AUTH_URL is not set. Set it to the public origin — " +
        "e.g. https://voice.example.com — with no port and no trailing slash. " +
        "It must match the callback registered on every OAuth app.",
    );
  }
  return "http://localhost:3000";
}

/**
 * Social sign-in is optional, per provider.
 *
 * Guests can record without any provider configured, so a fresh clone runs with
 * nothing but a database — no OAuth app to register before you can try it.
 * Configure a provider when you want recordings to survive a cleared cookie.
 */
export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Providers to offer, so the UI and the server agree on what exists. */
export function configuredProviders(): SocialProvider[] {
  const providers: SocialProvider[] = [];
  if (githubConfigured()) providers.push("github");
  if (googleConfigured()) providers.push("google");
  return providers;
}

function socialProviders() {
  return {
    ...(githubConfigured() && {
      github: {
        clientId: required("GITHUB_CLIENT_ID"),
        clientSecret: required("GITHUB_CLIENT_SECRET"),
      },
    }),
    ...(googleConfigured() && {
      google: {
        clientId: required("GOOGLE_CLIENT_ID"),
        clientSecret: required("GOOGLE_CLIENT_SECRET"),
      },
    }),
  };
}

// Built by a function so the precise inferred type is preserved — annotating
// the memo as `ReturnType<typeof betterAuth>` widens the options generic and
// breaks `toNextJsHandler` and `$Infer`.
function buildAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: required("BETTER_AUTH_SECRET"),
    baseURL: baseUrl(),
    // The recorder and Workspace share an origin, and a driving session can
    // outlast a short cookie, so keep sessions long and refresh them lazily.
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    socialProviders: socialProviders(),
    /**
     * Merge providers that resolve to the same verified email onto one user.
     *
     * Without this, signing in with Google on the phone and GitHub on the laptop
     * produces two user rows, and one person's commutes split across two
     * repertoires and two growth curves — the same fragmentation the guest
     * cookie causes, arriving through a different door. Offering a second
     * provider makes that more likely, not less, so linking is what keeps the
     * measurement honest.
     *
     * The trade: trusting a provider to link on email means whoever controls
     * that address there reaches the account. Both Google and GitHub verify the
     * addresses they report, which is why only those two are trusted. Do not add
     * a provider here without checking that it does the same.
     */
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["github", "google"],
      },
    },
    plugins: [
      anonymous({
        emailDomainName: "guest.voicemural.local",
        generateName: () => "Guest",
        /**
         * Runs BEFORE the guest user is deleted. Every domain table cascades
         * from `user`, so if this does not move the data first, signing in
         * destroys everything the guest recorded. This is the single most
         * dangerous moment in the auth flow.
         */
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          const result = await migrateGuestData(anonymousUser.user.id, newUser.user.id);
          console.log("Migrated guest data on sign-in", {
            from: anonymousUser.user.id,
            to: newUser.user.id,
            ...result,
          });

          // The analytics half of the same migration. Without it the database
          // and PostHog disagree permanently: the rows move to the new user
          // while every event the guest produced stays on an orphaned person.
          // This is the only place both ids are known to be the same human, so
          // it is the only place the irreversible merge is safe to make.
          try {
            mergeGuestIntoUser(anonymousUser.user.id, newUser.user.id);
            capture(newUser.user.id, "guest_account_upgraded", {
              sessions_moved: result.sessionsMoved,
              capabilities_moved: result.capabilitiesMoved,
              starter_capabilities_replaced: result.starterCapabilitiesReplaced,
              // The count, not the names: capability names are user-authored
              // text and belong in the database, not in an analytics property.
              renamed_on_collision: result.renamedOnCollision.length,
            });
          } catch (err) {
            // Never fail a sign-in over analytics.
            console.error("Failed to merge guest identity in PostHog", err);
          }
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (createdUser) => {
            // Install the starter repertoire so a new collaborator can record
            // something meaningful on their first drive rather than facing an
            // empty system.
            try {
              await seedStarterRepertoire(createdUser.id);
            } catch (err) {
              // Never fail a sign-in over seeding; it is idempotent and can be
              // re-run with `pnpm db:seed`.
              console.error("Failed to seed starter repertoire", err);
            }

            try {
              // This hook fires for guests too — the anonymous plugin creates a
              // real user row — so an upgrade produces two of these, one for
              // the guest and one for the GitHub account. The flag is what
              // keeps a signup funnel from double-counting one person.
              const isGuest =
                (createdUser as { isAnonymous?: boolean | null }).isAnonymous === true;
              capture(createdUser.id, "user_signed_up", { is_guest: isGuest });
            } catch (err) {
              console.error("Failed to capture user_signed_up", err);
            }
          },
        },
      },
    },
  });
}

let instance: ReturnType<typeof buildAuth> | undefined;

/**
 * Better Auth, constructed on first use.
 *
 * Deliberately lazy: building this at module load would read secrets and open a
 * database handle during `next build`, forcing the Docker image to be built
 * with production credentials present. Nothing here is needed until a request
 * actually arrives.
 */
export function getAuth(): ReturnType<typeof buildAuth> {
  instance ??= buildAuth();
  return instance;
}

export type Session = ReturnType<typeof buildAuth>["$Infer"]["Session"];
