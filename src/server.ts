import { createApp } from "./app.js";
import { BuildService } from "./build-service.js";
import { BuildStore } from "./build-store.js";
import { CompilerClient } from "./compiler-client.js";
import { executeBuildWorker } from "./operations.js";
import { ensureWorkspaceAt } from "./runtime.js";
import { resolve } from "node:path";
import { publishWorkspaceContents } from "./workspace-publisher.js";
import {
  createPowerShellViewerLifecycle,
  createViewerAwarePublisher,
} from "./viewer-publisher.js";

const port = Number(process.env.ADAPTER_PORT ?? "4310");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("ADAPTER_PORT must be a valid port");
}

const runtimeVarRoot = resolve(process.env.WIKI_VAR_ROOT ?? resolve(process.cwd(), "var"));
const publishedWorkspace = resolve(runtimeVarRoot, "wiki");
await ensureWorkspaceAt(process.cwd(), publishedWorkspace);
const buildStore = new BuildStore(runtimeVarRoot);
const existingBaseline = await buildStore.currentBaseline();
const workspacePublisher = createViewerAwarePublisher(
  publishWorkspaceContents,
  createPowerShellViewerLifecycle(process.cwd(), runtimeVarRoot),
);
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
  workspacePublisher,
);
createApp({
  root: process.cwd(),
  workspaceRoot: publishedWorkspace,
  apiKey: process.env.OPENAI_API_KEY,
  secUserAgent: process.env.SEC_USER_AGENT,
  buildService,
  initialStage: existingBaseline?.knowledgeStage ?? "empty",
}).listen(
  port,
  "127.0.0.1",
  () =>
    console.log(
      `AI Industry Intelligence adapter listening on http://127.0.0.1:${port}`,
    ),
);
