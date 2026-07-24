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
    expect(graph.nodes).toHaveLength(2);
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

  it("redacts API keys, authorization headers, and provider bodies", () => {
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
    const first = lock.run(async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push("first:end");
    });
    const second = lock.run(async () => {
      events.push("second:start");
      events.push("second:end");
    });
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
