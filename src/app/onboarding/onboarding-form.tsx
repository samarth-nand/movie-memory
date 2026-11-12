"use client";

import { useActionState } from "react";
import { MOVIE_TITLE_MAX_LENGTH } from "@/lib/validation";
import { saveFavoriteMovie, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null, value: "" };

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, initialState);

  return (
    <form action={formAction} noValidate className="mt-10">
      <label htmlFor="movie" className="text-sm font-medium">
        Movie title
      </label>
      {/* Typed in the marquee face, so the user sees their title the way the dashboard will show it. */}
      <input
        id="movie"
        name="movie"
        type="text"
        autoComplete="off"
        maxLength={MOVIE_TITLE_MAX_LENGTH}
        defaultValue={state.value}
        placeholder="Paddington 2"
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "movie-error" : undefined}
        required
        className="font-marquee mt-2 block w-full border-b-4 border-ink bg-transparent pb-2 text-[clamp(2.75rem,9vw,5.5rem)] placeholder:text-muted/35 aria-invalid:border-error"
      />
      {state.error && (
        <p id="movie-error" role="alert" className="mt-3 font-medium text-error">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-8 bg-ink px-6 py-3 font-medium text-screen transition-colors hover:bg-ink/85 disabled:cursor-wait disabled:bg-ink/60"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
