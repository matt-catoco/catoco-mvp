"use client";

import { useState, useTransition } from "react";
import { authError, authLink } from "@/components/auth-ui";
import { resubscribe } from "./actions";

export function UndoUnsubscribe({ userId, token }: { userId: string; token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <p role="status" className="text-[14.5px] text-brand-muted">
        Done — you&apos;ll get trip emails again.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p>
        <button
          type="button"
          disabled={pending}
          className={authLink}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await resubscribe(userId, token);
              if (res.error) setError(res.error);
              else setDone(true);
            })
          }
        >
          {pending ? "Undoing…" : "Undo"}
        </button>
      </p>
      {error && (
        <p role="alert" className={authError}>
          {error}
        </p>
      )}
    </div>
  );
}
