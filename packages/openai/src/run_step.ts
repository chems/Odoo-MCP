import { z } from "zod";
import { openai } from "./client.js";

// Runs one Responses API call with JSON schema output.
export async function runStepJson<T extends z.ZodTypeAny>(args: {
  prompt: { system: string; user: string };
  schema: T;
  model?: string;
}) : Promise<z.infer<T>> {
  const model = args.model ?? "gpt-4.1-mini";

  const response = await openai.responses.create({
    model,
    input: [
      { role: "system", content: args.prompt.system },
      { role: "user", content: args.prompt.user }
    ],
    // Note: Responses API supports structured outputs. Here we map zod->json schema minimally via zod's ._def isn't available.
    // For POC we trust model + post-validate with zod.
  });

  // Extract text output; in production you should use response_format=json_schema.
  const text = response.output_text;
  const parsed = JSON.parse(text);
  return args.schema.parse(parsed);
}
