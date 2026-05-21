import { pipeline, env } from "@xenova/transformers";

class SemanticService {
  private model: any = null;
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.init();
  }

  private async init(): Promise<void> {
    console.log("Loading Semantic Model (MiniLM-L12)...");

    env.allowLocalModels = true;

    this.model = await pipeline(
      "feature-extraction",
      "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
      { quantized: true },
    );

    console.log("Semantic Model Loaded");
  }

  /** Explicitly wait for initialization (optional, for server startup) */
  public async waitForReady(): Promise<void> {
    await this.readyPromise;
  }

  public async embed(text: string): Promise<number[]> {
    await this.readyPromise;
    if (!text) return Array(384).fill(0);
    const output = await this.model(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }

  /**
   * Batch embed multiple texts sequentially
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Pass the array directly to the model
    await this.readyPromise;

    const output = await this.model(texts, {
      pooling: "mean",
      normalize: true,
    });

    // The output.data is a flattened Float32Array. We need to chunk it.
    const embeddings: number[][] = [];
    const dim = 384; // or output.dims[1]

    for (let i = 0; i < output.data.length; i += dim) {
      // Slice the flattened array into individual vectors
      embeddings.push(Array.from(output.data.slice(i, i + dim)));
    }

    return embeddings;
  }

  /**
   * Compute centroid from multiple embeddings
   * @param embeddings - Array of embedding vectors
   * @returns Normalized centroid vector
   */
  async computeCentroid(embeddings: number[][]): Promise<number[]> {
    if (embeddings.length === 0) return [];
    await this.readyPromise;

    const dim = embeddings[0].length;
    const centroid = new Array(dim).fill(0);

    // Sum all vectors
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += emb[i];
      }
    }

    // Normalize the sum vector
    const magnitude = Math.sqrt(
      centroid.reduce((sum, val) => sum + val * val, 0),
    );

    // Avoid division by zero
    if (magnitude === 0) return centroid;

    return centroid.map((v) => v / magnitude);
  }

  async cosineSimilarity(vecA: number[], vecB: number[]): Promise<number> {
    await this.readyPromise;

    return vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  }
}

// Singleton instance - initialized on first import
const semanticService = new SemanticService();
export default semanticService;
