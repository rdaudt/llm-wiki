import { createApp } from "./app.js";

const port = Number(process.env.ADAPTER_PORT ?? "4310");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("ADAPTER_PORT must be a valid port");
}

createApp({ root: process.cwd(), apiKey: process.env.OPENAI_API_KEY }).listen(
  port,
  "127.0.0.1",
  () => console.log(`AI Industry Intelligence adapter listening on http://127.0.0.1:${port}`),
);
