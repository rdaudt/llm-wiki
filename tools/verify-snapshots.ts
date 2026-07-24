import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SnapshotStore, type SnapshotManifest } from "../src/snapshots.js";

const root = process.cwd();
const store = new SnapshotStore(root);
for (const name of ["baseline", "post-delta"]) {
  const manifest = JSON.parse(
    await readFile(join(root, "demo", "snapshots", "manifests", `${name}.json`), "utf8"),
  ) as SnapshotManifest;
  if (!(await store.verify(manifest))) {
    throw new Error(`${name} snapshot checksum verification failed`);
  }
}
console.log("verified baseline and post-delta snapshot checksums");
