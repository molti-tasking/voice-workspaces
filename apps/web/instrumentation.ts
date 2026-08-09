/**
 * Server-side runtime setup.
 *
 * Everything touching `process` lives behind a dynamic import in
 * `lib/analytics/node-runtime`. Next statically analyses this file for the edge
 * runtime as well as Node, and does not follow the `NEXT_RUNTIME` check, so a
 * bare `process.once` here is reported as an unsupported Edge API on every
 * build even though it could never run there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { installProcessHandlers } = await import("./src/lib/analytics/node-runtime");
  installProcessHandlers();
}

/**
 * Next calls this for every server-side error, including ones thrown inside
 * React Server Components where there is no boundary of ours to catch them.
 * The app has no `error.tsx`, so without this a render failure in production
 * leaves no trace at all.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { captureServerException } = await import("./src/lib/analytics/server");
  captureServerException(error);
  console.error("Request error", { path: request.path, method: request.method, error });
}
