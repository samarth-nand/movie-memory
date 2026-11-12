import { describe, expect, it } from "vitest";
import { movieTitleSchema } from "@/lib/validation";

describe("movie title validation", () => {
  it("trims surrounding whitespace", () => {
    expect(movieTitleSchema.parse("  Heat \n")).toBe("Heat");
  });

  it.each(["", "   ", "\t\n"])("rejects empty or whitespace-only input %j", (input) => {
    expect(movieTitleSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a missing field (FormData.get returns null)", () => {
    expect(movieTitleSchema.safeParse(null).success).toBe(false);
  });

  it("accepts exactly 100 characters and rejects 101", () => {
    expect(movieTitleSchema.safeParse("a".repeat(100)).success).toBe(true);
    expect(movieTitleSchema.safeParse("a".repeat(101)).success).toBe(false);
  });

  it("measures length after trimming", () => {
    expect(movieTitleSchema.safeParse(`  ${"a".repeat(100)}  `).success).toBe(true);
  });

  it.each(["Amélie", "8½", "M*A*S*H", "千と千尋の神隠し", "Who Framed Roger Rabbit?"])(
    "accepts real titles with unusual characters: %s",
    (title) => {
      expect(movieTitleSchema.parse(title)).toBe(title);
    },
  );
});
