import { socialCard } from "@/lib/social-card";

// X falls back to og:image when twitter:image is absent, but plenty of other
// unfurlers read only one of the two — cheaper to emit both than to find out
// which one a participant's phone uses.
export { alt, size, contentType } from "@/lib/social-card";

export default function Image() {
  return socialCard();
}
