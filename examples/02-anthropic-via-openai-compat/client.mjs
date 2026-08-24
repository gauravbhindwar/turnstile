#!/usr/bin/env node
// One SDK, one client, two vendors — Turnstile routes by model name
// (model_routes in turnstile.yaml) and the caller never branches on vendor.
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8787/v1",
  apiKey: process.env.TURNSTILE_AGENT_KEY,
});

async function ask(model, prompt) {
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
  });
  console.log(`[${model}] ${response.choices[0]?.message.content}`);
}

await ask("gpt-4o-mini", "Say hello in exactly five words.");
await ask("claude-3-5-sonnet-20241022", "Say hello in exactly five words.");
