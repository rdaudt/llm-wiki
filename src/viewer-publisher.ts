import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ViewerLifecycle {
  stop(workspaceRoot: string): Promise<unknown>;
  startAndVerify(workspaceRoot: string): Promise<unknown>;
}

export type TransactionalPublisher = <T>(
  sourceRoot: string,
  targetRoot: string,
  verify: () => Promise<void>,
  commit: () => Promise<T>,
) => Promise<T>;

export function createViewerAwarePublisher(
  publish: TransactionalPublisher,
  lifecycle: ViewerLifecycle,
) {
  return async <T>(
    sourceRoot: string,
    targetRoot: string,
    commit: () => Promise<T>,
  ): Promise<T> => {
    await lifecycle.stop(targetRoot);
    try {
      return await publish(
        sourceRoot,
        targetRoot,
        async () => {
          await lifecycle.startAndVerify(targetRoot);
        },
        commit,
      );
    } catch (error) {
      await lifecycle.stop(targetRoot).catch(() => undefined);
      try {
        await lifecycle.startAndVerify(targetRoot);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          "Workspace publication failed and the restored viewer did not recover",
        );
      }
      throw error;
    }
  };
}

export function createPowerShellViewerLifecycle(
  projectRoot: string,
  varRoot: string,
): ViewerLifecycle {
  const resolvedProject = path.resolve(projectRoot);
  const resolvedVar = path.resolve(varRoot);
  const script = path.join(resolvedProject, "scripts", "viewer.ps1");

  const targetName = (workspaceRoot: string): "Published" | "Staging" => {
    const resolved = path.resolve(workspaceRoot);
    if (resolved === path.join(resolvedVar, "wiki")) return "Published";
    if (resolved === path.join(resolvedVar, "staging-wiki")) return "Staging";
    throw new Error(`No managed viewer is configured for ${resolved}`);
  };
  const invoke = async (action: "Start" | "Stop", workspaceRoot: string) => {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Action",
        action,
        "-Target",
        targetName(workspaceRoot),
      ],
      { cwd: resolvedProject, windowsHide: true, timeout: 45_000 },
    );
  };
  return {
    stop: (workspaceRoot) => invoke("Stop", workspaceRoot),
    startAndVerify: (workspaceRoot) => invoke("Start", workspaceRoot),
  };
}
