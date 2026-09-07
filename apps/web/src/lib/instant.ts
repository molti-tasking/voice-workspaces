/** A query param to an instant, or undefined for anything unparseable. */
export function parseInstant(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
