import { z } from "zod";

// The one way client components talk to the server. Shared response schemas
// live here so the route handler and the client agree on the contract.

export const factResponseSchema = z.object({
  fact: z.object({
    content: z.string(),
    createdAt: z.iso.datetime(),
    /** True when OpenAI failed and this is the most recent earlier fact. */
    stale: z.boolean(),
  }),
});
export type FactResponse = z.infer<typeof factResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Every failure the client sees has this shape, whatever went wrong. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store", signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, "network_error", "Couldn't reach the server. Check your connection and try again.");
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(response.status, "unexpected_error", "Something went wrong. Try again.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(response.status, "invalid_response", "Something went wrong. Try again.");
  }
  return parsed.data;
}

export function fetchFact(signal?: AbortSignal): Promise<FactResponse> {
  return getJson("/api/fact", factResponseSchema, signal);
}
