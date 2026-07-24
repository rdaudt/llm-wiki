import { createWiki, type Wiki } from "llm-wiki-compiler";

export class CompilerClient {
  readonly wiki: Wiki;

  constructor(root: string) {
    this.wiki = createWiki({ root });
  }

  status() {
    return this.wiki.status();
  }

  exportJson() {
    return this.wiki.exportJson();
  }

  lint() {
    return this.wiki.lint();
  }

  fastEval() {
    return this.wiki.runEval({ mode: "fast" });
  }

  query(question: string, save: boolean) {
    return this.wiki.query(question, { save, debug: true });
  }

  ingestText(input: { text: string; title: string }) {
    return this.wiki.ingestText(input);
  }

  compile(options: { concurrency: number }) {
    return this.wiki.compile(options);
  }
}
