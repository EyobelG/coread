"use client";

import { useEffect, useState } from "react";
import AccountBar from "@/components/AccountBar";
import { currentUserId, friendlyError, joinRoom } from "@/lib/rooms";

// Opened from an invite link: /join/?t=<token>
export default function JoinPage() {
  const [phase, setPhase] = useState<"loading" | "signin" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!(await currentUserId())) {
        setPhase("signin");
        return;
      }
      const token = new URLSearchParams(window.location.search).get("t");
      if (!token) {
        setError("This invite link is missing its code.");
        setPhase("error");
        return;
      }
      try {
        const roomId = await joinRoom(token);
        window.location.replace(`/room/?id=${roomId}`);
      } catch (err) {
        setError(friendlyError(err));
        setPhase("error");
      }
    })();
  }, []);

  if (phase === "loading") return <p className="p-6 text-stone-500">Joining room…</p>;

  if (phase === "signin") {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold">You're invited to a reading room</h1>
        <p className="mt-2 text-sm text-stone-600">Sign in to join. You'll come back here automatically.</p>
        <div className="mt-6">
          <AccountBar />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold">Couldn't join</h1>
      <p role="alert" className="mt-2 text-sm text-red-700">
        {error}
      </p>
      <a href="/rooms/" className="mt-6 inline-flex min-h-11 items-center rounded bg-stone-900 px-4 text-white">
        Go to my rooms
      </a>
    </main>
  );
}
