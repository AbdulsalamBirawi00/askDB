import { z } from "zod";

/** Body for editing a table or column: a note (empty clears it) and/or the hidden flag. */
export const schemaPatchSchema = z
  .object({
    description: z
      .string()
      .max(1000)
      .transform((v) => v.trim() || null)
      .optional(),
    hidden: z.boolean().optional(),
  })
  .strict()
  .refine((p) => p.description !== undefined || p.hidden !== undefined, {
    error: "Nothing to update",
  });
