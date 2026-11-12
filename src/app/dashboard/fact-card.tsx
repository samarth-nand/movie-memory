"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchFact, type FactResponse } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "ready"; fact: FactResponse["fact"] }
  | { kind: "error"; message: string };

export function FactCard() {
  const [state, setState] = useState<State>({ kind: "loading" });
  // Bumped by "Try again" to re-run the effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Abort on unmount so a late response can't update a page the user left.
    const controller = new AbortController();
    fetchFact(controller.signal)
      .then(({ fact }) => setState({ kind: "ready", fact }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: error instanceof ApiError ? error.message : "Something went wrong. Try again.",
        });
      });
    return () => controller.abort();
  }, [attempt]);

  function retry() {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }

  return (
    <section aria-labelledby="fact-heading" aria-busy={state.kind === "loading"}>
      <h2 id="fact-heading">A fact about it</h2>
      <div aria-live="polite">
        {state.kind === "loading" && <p>Finding a fact about your movie…</p>}
        {state.kind === "ready" && (
          <>
            {/* Plain text only: React escapes it, and it's never parsed as HTML or markdown. */}
            <p>{state.fact.content}</p>
            {state.fact.stale && <p>We couldn&apos;t get a new fact just now, so here&apos;s your last one.</p>}
          </>
        )}
        {state.kind === "error" && (
          <>
            <p role="alert">{state.message}</p>
            <button type="button" onClick={retry}>
              Try again
            </button>
          </>
        )}
      </div>
    </section>
  );
}
