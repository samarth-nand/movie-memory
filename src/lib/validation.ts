import { z } from "zod";

export const MOVIE_TITLE_MAX_LENGTH = 100;

// Trim first, then check length, so "   " is empty and padding doesn't count
// toward the limit. No character allowlist: real titles include accents,
// punctuation, and non-Latin scripts ("Amélie", "8½", "M*A*S*H", "千と千尋の神隠し").
export const movieTitleSchema = z
  .string({ error: "Enter a movie title." })
  .trim()
  .min(1, "Enter a movie title.")
  .max(MOVIE_TITLE_MAX_LENGTH, `Keep it to ${MOVIE_TITLE_MAX_LENGTH} characters or fewer.`);
