import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins/anonymous";
import { getDb, schema } from "@voicemural/db";
import { migrateGuestData } from "@voicemural/db/link-guest";
import { seedStarterRepertoire } from "@voicemural/db/seed";

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
        "It must match the callback registered on the GitHub OAuth app.",
    );
  }
  return "http://localhost:3000";
}

/**
 * GitHub sign-in is optional.
 *
 * Guests can record without any provider configured, so a fresh clone runs with
 * nothing but a database — no OAuth app to register before you can try it.
 * Configure GitHub when you want recordings to survive a cleared cookie.
 */
export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
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
    socialProviders: githubConfigured()
      ? {
          github: {
            clientId: required("GITHUB_CLIENT_ID"),
            clientSecret: required("GITHUB_CLIENT_SECRET"),
          },
        }
      : {},
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
