import { runStepJson } from "@packages/openai/run_step";
import { ExtractSchema } from "@packages/prompts/schemas/extract";
import { extractPrompt } from "@packages/prompts/steps/extract";

export async function extractStep(transcription: string) {
  return await runStepJson({
    prompt: extractPrompt(transcription),
    schema: ExtractSchema
  });
}
