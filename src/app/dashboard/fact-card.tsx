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

  // Error text stays off the amber: red on amber is too low-contrast to read.
  const isError = state.kind === "error";

  return (
    <section
      aria-labelledby="fact-heading"
      aria-busy={state.kind === "loading"}
      className={
        isError
          ? "shadow-pop border-[3px] border-error bg-screen [--shadow-pop-color:var(--color-error)]"
          : "shadow-pop border-[3px] border-ink bg-marquee"
      }
    >
      {!isError && <div aria-hidden="true" className={`bulbs ${state.kind === "loading" ? "bulbs-chasing" : ""}`} />}

      <div className="px-5 py-6 sm:px-8 sm:py-8">
        <h2
          id="fact-heading"
          className={`inline-block px-2.5 py-1 text-sm font-semibold ${isError ? "bg-error text-screen" : "bg-ink text-marquee"}`}
        >
          A fact about it
        </h2>

        <div aria-live="polite" className="mt-4">
          {state.kind === "loading" && <p className="text-2xl font-medium sm:text-3xl">Finding a fact about your movie…</p>}

          {state.kind === "ready" && (
            <>
              {/* Plain text only: React escapes it, and it's never parsed as HTML or markdown. */}
              <p className="max-w-[55ch] text-2xl leading-snug font-medium text-pretty sm:text-3xl">{state.fact.content}</p>
              {state.fact.stale && (
                <p className="mt-4 text-sm font-medium">
                  We couldn&apos;t get a new fact just now, so here&apos;s your last one.
                </p>
              )}
            </>
          )}

          {state.kind === "error" && (
            <>
              <p role="alert" className="text-lg font-medium text-error">
                {state.message}
              </p>
              <button
                type="button"
                onClick={retry}
                className="btn-pop mt-6"
              >
                Try again
              </button>
            </>
          )}
        </div>
      </div>

      {!isError && <div aria-hidden="true" className={`bulbs ${state.kind === "loading" ? "bulbs-chasing" : ""}`} />}
    </section>
  );
}
