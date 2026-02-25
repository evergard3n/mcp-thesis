#!/usr/bin/env node

import { config } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "../.env") });

async function checkSimilarity() {
  const semanticService = (
    await import("../build/services/semantic.service.js")
  ).default;

  const roleKeywords = [
    "records information",
    "registers data",
    "submits data",
    "provides information",
  ];

  const step =
    "Records the box's arrival in the system, including the number of bags inside";

  console.log("Checking semantic similarity:\n");
  console.log(`Step: "${step}"\n`);

  const stepEmb = await semanticService.embed(step);

  for (const keyword of roleKeywords) {
    const kwEmb = await semanticService.embed(keyword);
    const sim = await semanticService.cosineSimilarity(stepEmb, kwEmb);
    console.log(`"${keyword}": ${(sim * 100).toFixed(1)}%`);
  }

  // Test with centroid
  console.log("\nWith centroid of all keywords:");
  const allEmbs = await semanticService.embedBatch(roleKeywords);
  const centroid = await semanticService.computeCentroid(allEmbs);
  const centSim = await semanticService.cosineSimilarity(stepEmb, centroid);
  console.log(`Centroid similarity: ${(centSim * 100).toFixed(1)}%`);
}

checkSimilarity();
