import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SnapshotManifest {
  schemaVersion: 1;
  snapshotId: string;
  stage: "baseline" | "post_delta";
  files: Array<{ path: string; sha256: string }>;
}

export class SnapshotStore {
  constructor(private readonly root: string) {}

  async createManifest(
    files: string[],
    metadata: Pick<SnapshotManifest, "snapshotId" | "stage">,
  ): Promise<SnapshotManifest> {
    return {
      schemaVersion: 1,
      ...metadata,
      files: await Promise.all(
        files.map(async (path) => ({
          path,
          sha256: createHash("sha256")
            .update(await readFile(resolve(this.root, path)))
            .digest("hex"),
        })),
      ),
    };
  }

  async verify(manifest: SnapshotManifest): Promise<boolean> {
    try {
      for (const file of manifest.files) {
        const actual = createHash("sha256")
          .update(await readFile(resolve(this.root, file.path)))
          .digest("hex");
        if (actual !== file.sha256) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}

