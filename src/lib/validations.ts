import { z } from "zod";

export const createAppSchema = z.object({
  name: z.string().min(1),
  githubName: z.string().optional(),
  githubUrl: z.string().url().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  localPath: z.string().optional(),
});

export const updateAppSchema = z.object({
  name: z.string().min(1).optional(),
  githubName: z.string().nullable().optional(),
  githubUrl: z.string().url().nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  localPath: z.string().nullable().optional(),
});

export type CreateAppInput = z.infer<typeof createAppSchema>;
export type UpdateAppInput = z.infer<typeof updateAppSchema>;
