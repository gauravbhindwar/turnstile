import { z } from "zod";

export const UpstreamConfigSchema = z.object({
  name: z.string(),
  kind: z.literal("openai_compat"),
  base_url: z.string().url(),
  credential_env: z.string().optional(),
});

export const ModelRouteSchema = z.object({
  match: z.string(),
  upstream: z.string(),
});

export const McpServerConfigSchema = z.object({
  name: z.string(),
  url: z.string().url(),
});

export const DefaultActionByClassSchema = z.object({
  read: z.enum(["allow", "deny", "escalate"]),
  mutate: z.enum(["allow", "deny", "escalate"]),
  spend: z.enum(["allow", "deny", "escalate"]),
});

export const FailModeSchema = z.object({
  spend: z.enum(["open", "closed"]),
  mutate: z.enum(["open", "closed"]),
  read: z.enum(["open", "closed"]),
});

export const ApprovalsConfigSchema = z.object({
  slack_webhook_url: z.string().url().nullable().optional(),
  generic_webhook_url: z.string().url().nullable().optional(),
  default_timeout_s: z.number().int().positive().default(300),
  max_pending: z.number().int().positive().default(50),
  public_base_url: z.string().url().default("http://localhost:8787"),
});

export const LedgerConfigSchema = z.object({
  checkpoint_every_rows: z.number().int().positive().default(1000),
  checkpoint_every_s: z.number().int().positive().default(60),
  retention_days: z.number().int().nonnegative().default(0),
});

export const RedactionConfigSchema = z.object({
  store_message_content: z.boolean().default(true),
  patterns: z.array(z.string()).default([]),
});

export const LoggingConfigSchema = z.object({
  level: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  format: z.enum(["json", "pretty"]).default("json"),
});

export const ServerConfigSchema = z.object({
  port: z.number().int().positive().default(8787),
  forward_proxy_port: z.number().int().positive().default(8888),
  // Defaults to loopback, not 0.0.0.0, so a fresh install boots without
  // tripping the §17.3 non-loopback-without-TLS gate. See ADR-002.
  host: z.string().default("127.0.0.1"),
  trust_proxy: z.boolean().default(false),
});

export const AdminConfigSchema = z.object({
  token: z.string().min(16, "admin.token must be at least 16 characters"),
});

export const TurnstileConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  data_dir: z.string().default("./turnstile-data"),
  admin: AdminConfigSchema,
  upstreams: z.array(UpstreamConfigSchema).default([]),
  model_routes: z.array(ModelRouteSchema).default([]),
  mcp_servers: z.array(McpServerConfigSchema).default([]),
  policies_dir: z.string().default("./policies"),
  plugins_dir: z.string().default("./plugins"),
  allow_local_plugins: z.boolean().default(false),
  prices_file: z.string().optional(),
  defaults: z
    .object({
      default_action_by_class: DefaultActionByClassSchema.default({
        read: "allow",
        mutate: "allow",
        spend: "allow",
      }),
    })
    .default({}),
  fail_mode: FailModeSchema.default({ spend: "closed", mutate: "closed", read: "open" }),
  approvals: ApprovalsConfigSchema.default({}),
  ledger: LedgerConfigSchema.default({}),
  redaction: RedactionConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  i_understand_http: z.boolean().default(false),
});

export type TurnstileConfig = z.infer<typeof TurnstileConfigSchema>;
export type FailMode = z.infer<typeof FailModeSchema>;
export type DefaultActionByClass = z.infer<typeof DefaultActionByClassSchema>;
