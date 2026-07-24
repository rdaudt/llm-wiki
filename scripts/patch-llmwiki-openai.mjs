import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = ["dist/index.js", "dist/cli.js"];
const requestPattern =
  /(this\.client\.chat\.completions\.create\(\{\s*model: this\.model,\s*)max_tokens:/g;

for (const relative of files) {
  const path = resolve("node_modules", "llm-wiki-compiler", relative);
  const source = await readFile(path, "utf8");
  const patched = source.replace(requestPattern, "$1max_completion_tokens:");
  const compatibleCalls =
    patched.match(
      /this\.client\.chat\.completions\.create\(\{\s*model: this\.model,\s*max_completion_tokens:/g,
    )?.length ?? 0;
  if (compatibleCalls < 3) {
    throw new Error(
      `Could not apply llm-wiki OpenAI compatibility patch to ${relative}`,
    );
  }
  if (patched !== source) await writeFile(path, patched, "utf8");
}

console.log("llm-wiki OpenAI GPT-5 compatibility patch verified.");
