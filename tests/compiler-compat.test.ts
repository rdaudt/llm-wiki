import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("llm-wiki OpenAI compatibility", () => {
  it("uses max_completion_tokens for every OpenAI chat completion request", async () => {
    const source = await readFile(
      "node_modules/llm-wiki-compiler/dist/index.js",
      "utf8",
    );
    const calls = source.match(
      /this\.client\.chat\.completions\.create\(\{[\s\S]{0,300}?\n\s*\}\)/g,
    );
    expect(calls?.length).toBeGreaterThanOrEqual(3);
    for (const call of calls ?? []) {
      expect(call).toContain("max_completion_tokens:");
      expect(call).not.toContain("max_tokens:");
    }
  });
});
