import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

/**
 * What the service worker serves when a navigation cannot reach the server.
 *
 * The point of this page is the second paragraph: someone who loses signal
 * mid-drive needs to know the recording is still being kept, or they will stop
 * and start it again — which splits one drive into two sessions and loses the
 * stretch in between. Nothing here may depend on the network or a session.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="mb-3 text-2xl font-semibold">No connection</h1>
      <p className="mb-4 text-white/60">
        VoiceMural cannot reach the server from here. This happens in tunnels,
        car parks and most of the countryside.
      </p>
      <p className="mb-8 text-white/60">
        If you were recording, keep going.{" "}
        <strong className="font-medium text-white">
          Nothing has been lost.
        </strong>{" "}
        Audio is held on the phone and uploads itself once there is signal
        again.
      </p>
      <p className="text-sm text-white/40">
        Once you have parked, reopen the app to check everything has gone up.
      </p>
    </main>
  );
}
