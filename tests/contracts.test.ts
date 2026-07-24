import { describe, expect, it } from "vitest";
import {
  AsyncLock,
  buildGraph,
  normalizeMarkdownForDiff,
  redactSecrets,
  validateIdempotencyKey,
} from "../src/domain.js";

describe("adapter domain", () => {
  it("builds wikilink graph without duplicate edges", () => {
    const graph = buildGraph([
      { slug: "a", title: "A", kind: "overview", body: "See [[b]] and [[b|B]]." },
      { slug: "b", title: "B", kind: "entity", body: "Back to [[a]]." },
    ]);
    expect(graph.edges).toEqual([
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ]);
  });

  it("excludes volatile generated timestamps from diffs", () => {
    expect(
      normalizeMarkdownForDiff("# A\nGenerated: 2026-01-01T00:00:00Z\nEvidence."),
    ).toBe("# A\nEvidence.");
  });

  it("redacts common provider secrets and bodies", () => {
    const text = redactSecrets(
      "OPENAI_API_KEY=sk-secret Authorization: Bearer abc provider_body={bad}",
    );
    expect(text).not.toContain("sk-secret");
    expect(text).not.toContain("abc");
    expect(text).not.toContain("{bad}");
  });

  it("requires a bounded idempotency key", () => {
    expect(validateIdempotencyKey("demo-123")).toBe("demo-123");
    expect(() => validateIdempotencyKey("")).toThrow(/Idempotency-Key/);
    expect(() => validateIdempotencyKey("x".repeat(129))).toThrow(/Idempotency-Key/);
  });

  it("serializes mutations through one lock", async () => {
    const lock = new AsyncLock();
    const events: string[] = [];
    await Promise.all([
      lock.run(async () => {
        events.push("first:start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push("first:end");
      }),
      lock.run(() => events.push("second")),
    ]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });
});
