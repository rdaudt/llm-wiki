import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publishWorkspaceContents } from "../src/workspace-publisher.js";

describe("workspace publication", () => {
  it("replaces published contents while preserving the workspace root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-publish-"));
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(path.join(source, "new.md"), "new", "utf8");
    await writeFile(path.join(target, "old.md"), "old", "utf8");

    await publishWorkspaceContents(source, target);

    expect(await readFile(path.join(target, "new.md"), "utf8")).toBe("new");
    await expect(readFile(path.join(target, "old.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restores the previous workspace byte-for-byte after promotion failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-publish-failure-"));
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(path.join(source, "new.md"), "new", "utf8");
    await writeFile(path.join(target, "old.md"), "old", "utf8");

    await expect(
      publishWorkspaceContents(source, target, async () => {
        throw new Error("viewer restart failed");
      }),
    ).rejects.toThrow(/viewer restart failed/);

    expect(await readFile(path.join(target, "old.md"), "utf8")).toBe("old");
    await expect(readFile(path.join(target, "new.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restores the previous workspace when committing the promoted state fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-publish-commit-"));
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(path.join(source, "new.md"), "new", "utf8");
    await writeFile(path.join(target, "old.md"), "old", "utf8");

    await expect(
      publishWorkspaceContents(
        source,
        target,
        async () => undefined,
        async () => {
          throw new Error("state commit failed");
        },
      ),
    ).rejects.toThrow(/state commit failed/);

    expect(await readFile(path.join(target, "old.md"), "utf8")).toBe("old");
    await expect(readFile(path.join(target, "new.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
