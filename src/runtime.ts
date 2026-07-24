import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

type RemoveDirectory = (
  path: string,
  options: { recursive: true; force: true },
) => Promise<void>;

async function clearWorkspace(
  workspace: string,
  removeDirectory: RemoveDirectory,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await removeDirectory(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(code ?? "") || attempt >= 9) {
        throw error;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
  }
}

export async function initializeWorkspace(
  projectRoot: string,
  removeDirectory: RemoveDirectory = rm,
): Promise<string> {
  const resolvedProject = resolve(projectRoot);
  const workspace = resolve(resolvedProject, "var", "wiki");
  const expected = join("var", "wiki");
  if (relative(resolvedProject, workspace) !== expected) {
    throw new Error("refusing to clear an unexpected runtime workspace path");
  }
  await clearWorkspace(workspace, removeDirectory);
  await mkdir(join(workspace, ".llmwiki"), { recursive: true });
  await cp(
    join(resolvedProject, "wiki", "schema.yaml"),
    join(workspace, ".llmwiki", "schema.yaml"),
  );
  return workspace;
}

export async function ensureWorkspace(projectRoot: string): Promise<string> {
  const resolvedProject = resolve(projectRoot);
  const workspace = resolve(resolvedProject, "var", "wiki");
  const expected = join("var", "wiki");
  if (relative(resolvedProject, workspace) !== expected) {
    throw new Error("refusing to initialize an unexpected runtime workspace path");
  }
  const schemaDirectory = join(workspace, ".llmwiki");
  const schemaPath = join(schemaDirectory, "schema.yaml");
  await mkdir(schemaDirectory, { recursive: true });
  try {
    await stat(schemaPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await cp(join(resolvedProject, "wiki", "schema.yaml"), schemaPath);
  }
  return workspace;
}
