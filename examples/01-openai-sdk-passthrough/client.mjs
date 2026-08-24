#!/usr/bin/env node
// The whole point: this is the real `openai` SDK, completely unmodified.
// The only change from talking to OpenAI directly is baseURL + apiKey.
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8787/v1",
  apiKey: process.env.TURNSTILE_AGENT_KEY, // a trn_... key, NOT a real OpenAI key
});

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Say hello in exactly five words." }],
});

console.log(response.choices[0]?.message.content);
