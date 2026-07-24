import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureWorkspace, initializeWorkspace } from "../src/runtime.js";

describe("runtime workspace", () => {
  it("clears prior knowledge and installs only the compiler schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "live-wiki-runtime-"));
    await mkdir(join(root, "var", "wiki", "wiki", "concepts"), { recursive: true });
    await writeFile(
      join(root, "var", "wiki", "wiki", "concepts", "old.md"),
      "old knowledge",
    );
    await mkdir(join(root, "wiki"), { recursive: true });
    await writeFile(
      join(root, "wiki", "schema.yaml"),
      "version: 1\nkinds: {}\nseedPages: []\n",
    );
    const workspace = await initializeWorkspace(root);
    expect(workspace).toBe(join(root, "var", "wiki"));
    expect(await readFile(join(workspace, ".llmwiki", "schema.yaml"), "utf8")).toContain(
      "seedPages",
    );
    await expect(
      readFile(join(workspace, "wiki", "concepts", "old.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("retries transient Windows directory locks while clearing runtime knowledge", async () => {
    const root = await mkdtemp(join(tmpdir(), "live-wiki-locked-"));
    await mkdir(join(root, "var", "wiki"), { recursive: true });
    await mkdir(join(root, "wiki"), { recursive: true });
    await writeFile(join(root, "wiki", "schema.yaml"), "version: 1\n");
    let attempts = 0;
    await initializeWorkspace(root, async (path, options) => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("resource busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      await rm(path, options);
    });
    expect(attempts).toBe(3);
  });

  it("preserves published knowledge during ordinary service startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "live-wiki-persisted-"));
    await mkdir(join(root, "var", "wiki", "wiki", "concepts"), { recursive: true });
    await writeFile(
      join(root, "var", "wiki", "wiki", "concepts", "published.md"),
      "published knowledge",
    );
    await mkdir(join(root, "wiki"), { recursive: true });
    await writeFile(join(root, "wiki", "schema.yaml"), "version: 1\n");

    await ensureWorkspace(root);

    expect(
      await readFile(join(root, "var", "wiki", "wiki", "concepts", "published.md"), "utf8"),
    ).toBe("published knowledge");
  });
});
