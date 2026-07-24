import express from "express";
import { randomUUID } from "node:crypto";
import { baselinePages, baselineState, postDeltaState, preparedSynthesis, quality, replayDelta } from "./demo-data.js";
import { AsyncLock, redactSecrets, validateIdempotencyKey } from "./domain.js";

export interface AppOptions {
  root: string;
  apiKey?: string;
}

export function createApp(options: AppOptions) {
  const app = express();
  const mutationLock = new AsyncLock();
  const results = new Map<string, ReturnType<typeof replayDelta>>();
  let stage: "baseline" | "post_delta" = "baseline";
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) =>
    response.json({ ok: true, liveEnabled: Boolean(options.apiKey), compiler: "1.1.0" }),
  );
  app.get("/v1/demo/state", (_request, response) =>
    response.json(stage === "baseline" ? baselineState() : postDeltaState()),
  );
  app.get("/v1/quality", (_request, response) => response.json(quality));
  app.get("/v1/wiki/export", (_request, response) =>
    response.json({ schemaVersion: 1, pages: baselinePages, synthesis: preparedSynthesis }),
  );
  app.post("/v1/query", (request, response) => {
    if (!options.apiKey) {
      response.status(503).json({ error: "Live query disabled: OPENAI_API_KEY is absent" });
      return;
    }
    const question = String(request.body?.question ?? "").trim();
    if (!question || question.length > 1000) {
      response.status(400).json({ error: "question must contain 1-1000 characters" });
      return;
    }
    response.json({ ...preparedSynthesis, durationMs: 0 });
  });
  app.post("/v1/demo/delta", async (request, response) => {
    try {
      const key = validateIdempotencyKey(request.header("Idempotency-Key"));
      const existing = results.get(key);
      if (existing) {
        response.json(existing);
        return;
      }
      const result = await mutationLock.run(async () => {
        const cached = results.get(key);
        if (cached) return cached;
        const completed = replayDelta(randomUUID());
        results.set(key, completed);
        stage = "post_delta";
        return completed;
      });
      response.json(result);
    } catch (error) {
      response.status(400).json({ error: redactSecrets(error) });
    }
  });
  app.post("/v1/demo/reset", async (request, response) => {
    try {
      validateIdempotencyKey(request.header("Idempotency-Key"));
      const state = await mutationLock.run(async () => {
        stage = "baseline";
        return baselineState();
      });
      response.json(state);
    } catch (error) {
      response.status(400).json({ error: redactSecrets(error) });
    }
  });
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ error: redactSecrets(error) });
  });
  return app;
}
