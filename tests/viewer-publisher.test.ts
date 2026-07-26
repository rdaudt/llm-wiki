import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { publishWorkspaceContents } from "../src/workspace-publisher.js";
import { createViewerAwarePublisher } from "../src/viewer-publisher.js";

describe("viewer-aware workspace publication", () => {
  it("stops the viewer and verifies the replacement before committing state", async () => {
    const events: string[] = [];
    const lifecycle = {
      stop: vi.fn(async () => events.push("stop")),
      startAndVerify: vi.fn(async () => events.push("start")),
    };
    const publisher = createViewerAwarePublisher(publishWorkspaceContents, lifecycle);
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-viewer-publish-"));
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(path.join(source, "new.md"), "new", "utf8");

    const result = await publisher(source, target, async () => {
      events.push("commit");
      return "committed";
    });

    expect(result).toBe("committed");
    expect(events).toEqual(["stop", "start", "commit"]);
  });

  it("restarts the restored viewer when state commit fails", async () => {
    const observed: string[] = [];
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-viewer-restore-"));
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(path.join(source, "new.md"), "new", "utf8");
    await writeFile(path.join(target, "old.md"), "old", "utf8");
    const lifecycle = {
      stop: vi.fn(async () => undefined),
      startAndVerify: vi.fn(async (workspaceRoot: string) => {
        const name = await readFile(
          path.join(
            workspaceRoot,
            (await readFile(path.join(workspaceRoot, "old.md"), "utf8").catch(
              () => undefined,
            ))
              ? "old.md"
              : "new.md",
          ),
          "utf8",
        );
        observed.push(name);
      }),
    };
    const publisher = createViewerAwarePublisher(publishWorkspaceContents, lifecycle);

    await expect(
      publisher(source, target, async () => {
        throw new Error("state commit failed");
      }),
    ).rejects.toThrow(/state commit failed/);

    expect(observed).toEqual(["new", "old"]);
    expect(lifecycle.stop).toHaveBeenCalledTimes(2);
    expect(await readFile(path.join(target, "old.md"), "utf8")).toBe("old");
  });
});
