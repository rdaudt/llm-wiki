export interface WikiPage {
  slug: string;
  title: string;
  kind: string;
  body: string;
}

export interface GraphData {
  nodes: Array<{ id: string; label: string; kind: string }>;
  edges: Array<{ source: string; target: string }>;
}

export class AsyncLock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function buildGraph(pages: WikiPage[]): GraphData {
  const known = new Set(pages.map((page) => page.slug));
  const edges = new Map<string, { source: string; target: string }>();
  for (const page of pages) {
    const links = page.body.matchAll(/\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/gi);
    for (const match of links) {
      const target = match[1]!.toLowerCase();
      if (known.has(target)) {
        edges.set(`${page.slug}\0${target}`, { source: page.slug, target });
      }
    }
  }
  return {
    nodes: pages.map((page) => ({ id: page.slug, label: page.title, kind: page.kind })),
    edges: [...edges.values()],
  };
}

export function normalizeMarkdownForDiff(markdown: string): string {
  return markdown
    .replace(/^Generated:\s+.*(?:\r?\n|$)/gim, "")
    .replace(/^Updated:\s+.*(?:\r?\n|$)/gim, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export function redactSecrets(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/OPENAI_API_KEY\s*=\s*\S+/gi, "OPENAI_API_KEY=[REDACTED]")
    .replace(/Authorization\s*:\s*Bearer\s+\S+/gi, "Authorization: [REDACTED]")
    .replace(/provider_body\s*=\s*(?:\{[^}]*\}|\S+)/gi, "provider_body=[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}

export function validateIdempotencyKey(value: string | undefined): string {
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error("A valid Idempotency-Key header is required");
  }
  return value;
}
