import type { Metadata } from "next";
import { OfflineStatus } from "./offline-status";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

/**
 * What the service worker serves when a navigation cannot reach the server.
 *
 * The point of this page is the paragraph about the recording: someone who
 * loses signal mid-drive needs to know it is still being kept, or they will
 * stop and start it again — which splits one drive into two sessions and loses
 * the stretch in between. Nothing here may depend on the network or a session.
 *
 * What the prose must NOT do is diagnose. The worker falls back here on any
 * rejected fetch, and lost signal is only the most common reason; a blocked
 * request or an outage at our end arrives identically. The static copy is
 * therefore true whatever the cause, and `OfflineStatus` — which needs
 * JavaScript, and so cannot be relied on — narrows it where it can.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="mb-3 text-2xl font-semibold">
        Can&rsquo;t reach VoiceMural
      </h1>
      <p className="mb-4 text-white/60">
        The app could not be loaded just now. Usually that is signal — tunnels,
        car parks and most of the countryside — but it can also be a problem at
        our end, or something on this network blocking the site.
      </p>
      <p className="mb-8 text-white/60">
        If you were recording, keep going.{" "}
        <strong className="font-medium text-white">
          Nothing has been lost.
        </strong>{" "}
        Audio is held on the phone and uploads itself once the app can reach the
        server again.
      </p>
      <OfflineStatus />
      <p className="text-sm text-white/40">
        Once you have parked, reopen the app to check everything has gone up.
      </p>
    </main>
  );
}
