import { z } from "zod";

export const PolicyMatchSchema = z.object({
  workspaces: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  kinds: z.array(z.string()).optional(),
  classes: z.array(z.enum(["read", "mutate", "spend"])).optional(),
  targets: z.array(z.string()).optional(),
});

export const PolicyFileSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(100),
  match: PolicyMatchSchema.default({}),
  plugin: z.string(),
  params: z.unknown(),
});

export type PolicyMatch = z.infer<typeof PolicyMatchSchema>;
export type PolicyFile = z.infer<typeof PolicyFileSchema>;
