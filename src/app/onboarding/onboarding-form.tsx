"use client";

import { useActionState } from "react";
import { MOVIE_TITLE_MAX_LENGTH } from "@/lib/validation";
import { saveFavoriteMovie, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null, value: "" };

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, initialState);

  return (
    <form action={formAction} noValidate>
      <label htmlFor="movie">Favorite movie</label>
      <input
        id="movie"
        name="movie"
        type="text"
        autoComplete="off"
        maxLength={MOVIE_TITLE_MAX_LENGTH}
        defaultValue={state.value}
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "movie-error" : undefined}
        required
      />
      {state.error && (
        <p id="movie-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
