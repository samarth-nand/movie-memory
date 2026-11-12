"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchFact, type FactResponse } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "ready"; fact: FactResponse["fact"] }
  | { kind: "error"; message: string };

export function FactCard() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback((signal?: AbortSignal) => {
    setState({ kind: "loading" });
    fetchFact(signal)
      .then(({ fact }) => setState({ kind: "ready", fact }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setState({
          kind: "error",
          message: error instanceof ApiError ? error.message : "Something went wrong. Try again.",
        });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

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
            <button type="button" onClick={() => load()}>
              Try again
            </button>
          </>
        )}
      </div>
    </section>
  );
}
