import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { restoreWorkspaceContents } from "../src/operations.js";

describe("operation rollback", () => {
  it("restores backup contents without removing the viewer-held workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-rollback-"));
    const workspace = join(root, "wiki");
    const backup = join(root, "backup");
    await mkdir(join(workspace, "sources"), { recursive: true });
    await mkdir(join(backup, "sources"), { recursive: true });
    await writeFile(join(workspace, "sources", "partial.md"), "partial");
    await writeFile(join(backup, "sources", "original.md"), "original");
    const removeEntry = vi.fn(async (path: string) => {
      expect(path).not.toBe(workspace);
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    });

    await restoreWorkspaceContents(workspace, backup, removeEntry);

    expect(await readFile(join(workspace, "sources", "original.md"), "utf8")).toBe(
      "original",
    );
    await expect(
      readFile(join(workspace, "sources", "partial.md"), "utf8"),
    ).rejects.toThrow();
    expect(removeEntry).toHaveBeenCalled();
  });
});
