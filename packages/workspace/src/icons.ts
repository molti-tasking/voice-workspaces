/**
 * Icons a topic may carry, as lucide-react component names.
 *
 * Its own module with no imports: both the fold and the extractor need it, and
 * putting it in either would make them import each other.
 *
 * An allowlist rather than free choice. The UI resolves these through an
 * explicit name→component map, so anything outside this set renders nothing —
 * and a model given 1,500 icon names picks inconsistently between runs, which
 * reads as noise across the cards.
 */
export const TOPIC_ICONS = [
  "Notebook",
  "Lightbulb",
  "FlaskConical",
  "GraduationCap",
  "Plane",
  "MapPin",
  "Users",
  "Calendar",
  "Target",
  "Compass",
  "BookOpen",
  "Code",
  "PenLine",
  "Microscope",
  "Building2",
  "Coins",
  "Heart",
  "Home",
  "Briefcase",
  "MessageSquare",
  "Wrench",
  "TrendingUp",
  "Scale",
  "Puzzle",
] as const;

export type TopicIcon = (typeof TOPIC_ICONS)[number];

export const DEFAULT_TOPIC_ICON: TopicIcon = "Notebook";

const TOPIC_ICON_SET: ReadonlySet<string> = new Set(TOPIC_ICONS);

/** Coerce a model-supplied icon name to something the UI can render. */
export function normaliseIcon(value: unknown): TopicIcon {
  return typeof value === "string" && TOPIC_ICON_SET.has(value)
    ? (value as TopicIcon)
    : DEFAULT_TOPIC_ICON;
}
