import { SYSTEM } from "../system.js";

export function extractPrompt(transcription: string) {
  return {
    system: SYSTEM + "\n\nObjectif: extraire une structure minimale (en-tête, contexte, analyse, intentions de lignes devis).\nRetourne STRICTEMENT du JSON.",
    user: `TRANSCRIPTION:\n${transcription}`
  };
}
