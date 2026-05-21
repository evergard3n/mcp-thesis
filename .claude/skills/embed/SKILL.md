---
name: embed
description: Semantic embedding strategies using Xenova MiniLM-L12 with centroid matching and caching
license: MIT
compatibility: opencode
metadata:
  model: Xenova/paraphrase-multilingual-MiniLM-L12-v2
  dimensions: "384"
---

## Model

- **Library**: `@xenova/transformers`
- **Model**: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`
- **Dimensions**: 384
- **Normalization**: Enabled (`normalize: true`)
- **Pooling**: Mean pooling

Since vectors are normalized, **cosine similarity = dot product**:

```typescript
cosineSimilarity(a, b) = a.reduce((sum, v, i) => sum + v * b[i], 0);
```

---

## Centroid Strategy

Compute a single representative vector per category by averaging keyword embeddings:

```typescript
function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);

  // 1. Sum vectors
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) centroid[i] += emb[i];
  }

  // 2. Normalize the sum directly (skip dividing by length)
  // Calculate magnitude of the sum vector
  const magnitude = Math.sqrt(
    centroid.reduce((sum, val) => sum + val * val, 0),
  );

  // Avoid division by zero
  if (magnitude === 0) return centroid;

  return centroid.map((v) => v / magnitude);
}
```

**Match**: `similarity(queryEmbed, centroid) >= threshold`

---

## Batch Embedding

Xenova processes sequentially. For many texts:

```typescript
async embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    const out = await this.model(text, { pooling: "mean", normalize: true });
    results.push(Array.from(out.data));
  }
  return results;
}
```

---

## Cache Strategy

### Centroids (JSON, committed)

Location: `src/data/category-centroids.json`

```json
{
  "modelId": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  "categories": {
    "category_name": {
      "keywords": ["word1", "word2"],
      "centroid": [0.12, -0.03, ...],
      "threshold": 0.6
    }
  }
}
```

Invalidate if `modelId` changes.

### Step Embeddings (In-memory Map, session-scoped)

```typescript
class SemanticService {
  private cache = new Map<string, number[]>();

  async getOrEmbed(text: string): Promise<number[]> {
    let vec = this.cache.get(text);
    if (!vec) {
      vec = await this.embed(text);
      this.cache.set(text, vec);
    }
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Pass the array directly to the model
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
}
```

**Why in-memory?**

- O(1) lookup, no I/O overhead
- Session isolation (MCP sessions are isolated anyway)
- ~300KB per 200 steps (384 floats x 4 bytes x 200)
- Re-embeds on restart (acceptable for dev)

---

## Thresholds

| Range     | Meaning                             |
| --------- | ----------------------------------- |
| 0.7+      | Tight match (specific domain terms) |
| 0.55-0.65 | Semantic similarity (default)       |
| < 0.5     | Too loose, high false positives     |

Start at **0.6**, tune per category based on false positive/negative rates.
