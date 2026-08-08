import {
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  CircleHelp,
  Code,
  Coins,
  Compass,
  FlaskConical,
  GraduationCap,
  Heart,
  Home,
  Info,
  Lightbulb,
  MapPin,
  MessageSquare,
  MessageSquareQuote,
  Microscope,
  Notebook,
  PenLine,
  Plane,
  Puzzle,
  Scale,
  Target,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_TOPIC_ICON, type BlockKind, type TopicIcon } from "@voicemural/workspace";

/**
 * Topic icon name → component.
 *
 * An explicit map rather than a dynamic import: it bounds what ends up in the
 * bundle, and it makes the allowlist true by construction — a name the model
 * invents is simply not in here, so it cannot render as a blank.
 *
 * Typed as `Record<TopicIcon, …>`, so adding a name to TOPIC_ICONS without
 * adding it here is a compile error rather than something a test has to notice.
 */
export const TOPIC_ICON_COMPONENTS: Record<TopicIcon, LucideIcon> = {
  Notebook,
  Lightbulb,
  FlaskConical,
  GraduationCap,
  Plane,
  MapPin,
  Users,
  Calendar,
  Target,
  Compass,
  BookOpen,
  Code,
  PenLine,
  Microscope,
  Building2,
  Coins,
  Heart,
  Home,
  Briefcase,
  MessageSquare,
  Wrench,
  TrendingUp,
  Scale,
  Puzzle,
};

/** Resolve a stored icon name, falling back for anything unrecognised. */
export function topicIcon(name: string): LucideIcon {
  return (
    (TOPIC_ICON_COMPONENTS as Record<string, LucideIcon | undefined>)[name] ??
    TOPIC_ICON_COMPONENTS[DEFAULT_TOPIC_ICON]
  );
}

/**
 * Block kind → icon.
 *
 * `claim` deliberately has none: it is the default and the loudest thing on the
 * card, and giving every line a marker would flatten the hierarchy the kinds
 * exist to create.
 */
export const BLOCK_ICONS: Partial<Record<BlockKind, LucideIcon>> = {
  question: CircleHelp,
  context: Info,
  meta: MessageSquareQuote,
};
