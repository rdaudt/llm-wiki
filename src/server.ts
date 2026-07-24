import { createApp } from "./app.js";
import { BuildService } from "./build-service.js";
import { BuildStore } from "./build-store.js";
import { CompilerClient } from "./compiler-client.js";
import { executeBuildWorker } from "./operations.js";
import { ensureWorkspace } from "./runtime.js";
import { resolve } from "node:path";
import { publishWorkspaceContents } from "./workspace-publisher.js";

const port = Number(process.env.ADAPTER_PORT ?? "4310");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("ADAPTER_PORT must be a valid port");
}

await ensureWorkspace(process.cwd());
const buildStore = new BuildStore(resolve(process.cwd(), "var"));
const existingBaseline = await buildStore.currentBaseline();
const buildService = new BuildService(
  buildStore,
  (request, signal) =>
    executeBuildWorker(
      request,
      () => undefined,
      signal ?? new AbortController().signal,
    ),
  async (workspaceRoot) => {
    const stagedWiki = new CompilerClient(workspaceRoot);
    const [lint, evaluation] = await Promise.all([
      stagedWiki.lint(),
      stagedWiki.fastEval(),
    ]);
    return { lint, evaluation };
  },
  publishWorkspaceContents,
);
createApp({
  root: process.cwd(),
  apiKey: process.env.OPENAI_API_KEY,
  secUserAgent: process.env.SEC_USER_AGENT,
  buildService,
  initialStage: existingBaseline?.stage === "published" ? "baseline" : "empty",
}).listen(
  port,
  "127.0.0.1",
  () =>
    console.log(
      `AI Industry Intelligence adapter listening on http://127.0.0.1:${port}`,
    ),
);
