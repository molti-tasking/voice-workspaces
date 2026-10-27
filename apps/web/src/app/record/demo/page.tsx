import type { Metadata } from "next";
import { DemoClient } from "./demo-client";

/**
 * A simulated conversation: the conversation views (`ConversationView`) fed
 * a scripted conversation and its scripted digest (`demo-conversation.ts`),
 * with no microphone, no voice container and no AI. For showing the interfaces when the AI is down, and for
 * demos. Nothing is sent or saved.
 */

export const metadata: Metadata = {
  title: "Simulated conversation",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <DemoClient />;
}
