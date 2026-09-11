import path from 'node:path';
import { env as hfEnv, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { env } from '../config/env.js';

export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Charge le modèle d'embedding local (ONNX/transformers.js) une seule fois,
 * paresseusement (au premier appel semantic/hybrid, jamais au démarrage du
 * serveur). Aucune clé API, aucun appel réseau après le téléchargement initial
 * des poids du modèle (mis en cache sous EMBEDDING_CACHE_DIR/models).
 */
function loadPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    hfEnv.cacheDir = path.join(env.EMBEDDING_CACHE_DIR, 'models');
    pipelinePromise = pipeline('feature-extraction', env.EMBEDDING_MODEL_ID);
  }
  return pipelinePromise;
}

/**
 * `dimensions` est déclarée avant le premier chargement effectif du modèle :
 * `all-MiniLM-L6-v2` (le modèle par défaut) produit des vecteurs à 384 dimensions.
 * Si `EMBEDDING_MODEL_ID` est changé pour un modèle à dimension différente,
 * la valeur réelle du premier embedding fait foi (voir `VectorStore`, qui
 * dérive sa taille de stride du premier vecteur inséré).
 */
export function createLocalEmbeddingProvider(): EmbeddingProvider {
  return {
    modelId: env.EMBEDDING_MODEL_ID,
    dimensions: 384,
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) {
        return [];
      }
      const extractor = await loadPipeline();
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      const data = output.tolist() as number[][];
      return data.map((vector) => Float32Array.from(vector));
    },
  };
}
