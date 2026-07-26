import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";

async function clearContents(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root)) {
    await rm(path.join(root, entry), { recursive: true, force: true });
  }
}

async function copyContents(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source)) {
    await cp(path.join(source, entry), path.join(target, entry), {
      recursive: true,
      force: true,
    });
  }
}

export async function publishWorkspaceContents<T = void>(
  sourceRoot: string,
  targetRoot: string,
  verify: () => Promise<void> = async () => undefined,
  commit: () => Promise<T> = async () => undefined as T,
): Promise<T> {
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  if (source === target) throw new Error("Source and target workspace must differ");
  const backupContainer = await mkdtemp(path.join(path.dirname(target), ".publish-backup-"));
  const backup = path.join(backupContainer, "workspace");
  await mkdir(target, { recursive: true });
  await cp(target, backup, { recursive: true, force: true });
  try {
    await clearContents(target);
    await copyContents(source, target);
    await verify();
    return await commit();
  } catch (error) {
    await clearContents(target);
    await copyContents(backup, target);
    throw error;
  } finally {
    await rm(backupContainer, { recursive: true, force: true });
  }
}
