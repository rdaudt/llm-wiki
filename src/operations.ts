import { fork, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  OperationPhase,
  OperationType,
  ProgressReporter,
} from "./app.js";
import type { BuildWorkerRequest, BuildWorkerResult } from "./build-types.js";

interface WorkerMessage {
  kind: "progress" | "result" | "error";
  phase?: OperationPhase | string;
  detail?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

type RemoveEntry = (path: string) => Promise<void>;

export async function restoreWorkspaceContents(
  workspaceRoot: string,
  backupRoot: string,
  removeEntry: RemoveEntry = (path) =>
    rm(path, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    }),
): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true });
  for (const entry of await readdir(workspaceRoot)) {
    await removeEntry(join(workspaceRoot, entry));
  }
  for (const entry of await readdir(backupRoot)) {
    await cp(join(backupRoot, entry), join(workspaceRoot, entry), {
      recursive: true,
      force: true,
    });
  }
}

async function recover(workspaceRoot: string): Promise<void> {
  const cli = resolve(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "llmwiki.cmd" : "llmwiki",
  );
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(cli, ["recover"], {
      cwd: workspaceRoot,
      stdio: "ignore",
      shell: process.platform === "win32",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`llmwiki recover exited ${code}`)),
    );
  });
}

export async function executeInWorker(
  workspaceRoot: string,
  type: OperationType,
  report: ProgressReporter,
  signal: AbortSignal,
): Promise<unknown> {
  await mkdir(dirname(workspaceRoot), { recursive: true });
  const backupRoot = await mkdtemp(join(tmpdir(), "llm-wiki-backup-"));
  const backup = join(backupRoot, "wiki");
  await cp(workspaceRoot, backup, { recursive: true, force: true });

  try {
    return await new Promise((resolvePromise, reject) => {
      const worker = fork(resolve(process.cwd(), "src", "operation-worker.ts"), [type], {
        cwd: process.cwd(),
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env, WIKI_ROOT: workspaceRoot },
      });
      const abort = () => {
        worker.once("exit", () => reject(new Error("operation deadline exceeded")));
        if (!worker.kill()) reject(new Error("operation deadline exceeded"));
      };
      signal.addEventListener("abort", abort, { once: true });
      worker.on("message", (raw: WorkerMessage) => {
        if (raw.kind === "progress" && raw.phase) {
          report(raw.phase as OperationPhase, raw.detail);
        }
        if (raw.kind === "result") resolvePromise(raw.result);
        if (raw.kind === "error") reject(new Error(raw.error ?? "worker failed"));
      });
      worker.once("error", reject);
      worker.once("exit", (code) => {
        signal.removeEventListener("abort", abort);
        if (code && code !== 0) reject(new Error(`operation worker exited ${code}`));
      });
    });
  } catch (error) {
    await recover(workspaceRoot).catch(() => undefined);
    await restoreWorkspaceContents(workspaceRoot, backup);
    throw error;
  } finally {
    await rm(backupRoot, { recursive: true, force: true });
  }
}

export async function executeBuildWorker(
  request: BuildWorkerRequest,
  report: (phase: string, detail?: Record<string, unknown>) => void,
  signal: AbortSignal,
): Promise<BuildWorkerResult> {
  return new Promise((resolvePromise, reject) => {
    const worker = fork(resolve(process.cwd(), "src", "build-worker.ts"), [], {
      cwd: process.cwd(),
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {
        ...process.env,
        BUILD_WORKER_REQUEST: JSON.stringify(request),
      },
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      worker.once("exit", () =>
        finish(() => reject(new Error("operation deadline exceeded"))),
      );
      if (!worker.kill()) {
        finish(() => reject(new Error("operation deadline exceeded")));
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.on("message", (raw: WorkerMessage) => {
      if (raw.kind === "progress" && raw.phase) report(raw.phase, raw.detail);
      if (raw.kind === "result") {
        finish(() => resolvePromise(raw.result as BuildWorkerResult));
      }
      if (raw.kind === "error") {
        finish(() => reject(new Error(raw.error ?? "worker failed")));
      }
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      if (code && code !== 0) {
        finish(() => reject(new Error(`build worker exited ${code}`)));
      }
    });
  });
}
