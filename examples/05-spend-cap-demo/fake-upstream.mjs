#!/usr/bin/env node
// A tiny OpenAI-compatible fake upstream for the spend-cap demo: it never
// calls a real model, just echoes a fixed completion with usage so the
// demo doesn't need an API key.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4100);

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-fake",
          object: "chat.completion",
          model: parsed.model ?? "fake-model",
          choices: [{ index: 0, message: { role: "assistant", content: "This is a canned response." }, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 200, total_tokens: 220 },
        }),
      );
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`fake upstream listening on http://localhost:${port}`);
});
