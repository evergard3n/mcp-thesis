#!/usr/bin/env node

/**
 * Batch run full HITL loop across all datasets.
 *
 * This script calls runHITLComparison for each dataset file under test-data,
 * so each dataset goes through iterative question generation, expert answers,
 * and refinement loops.
 */

import { readdir, writeFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "../.env") });

async function runBatchHITL() {
  console.log("🧪 Full HITL Batch Test - All Datasets\n");
  console.log("═".repeat(80));
  console.log("Running runHITLComparison on each dataset file");
  console.log("═".repeat(80));
  console.log();

  try {
    const { runHITLComparison } = await import("../build/tools/testingTools.js");
    const { GeminiOpenRouterFunctions } = await import(
      "../build/services/gemini-openrouter.service.js"
    );

    const gemini = new GeminiOpenRouterFunctions(
      process.env.GEMINI_API_KEY || "",
      process.env.OPENROUTER_API_KEY || "",
    );

    const testDataDir = join(__dirname, "../test-data");
    const files = await readdir(testDataDir);
    const datasetFiles = files
      .filter((name) => name.startsWith("dataset-") && name.endsWith(".json"))
      .sort();

    console.log(`📂 Found ${datasetFiles.length} datasets:`);
    datasetFiles.forEach((name) => console.log(`   - ${name}`));
    console.log();

    const batchResults = [];

    for (let i = 0; i < datasetFiles.length; i++) {
      const datasetFile = datasetFiles[i];
      const datasetPath = join(testDataDir, datasetFile);

      console.log("═".repeat(80));
      console.log(`📊 [${i + 1}/${datasetFiles.length}] ${datasetFile}`);
      console.log("═".repeat(80));

      const start = Date.now();
      const { results, outputPath } = await runHITLComparison(gemini, {
        datasetPath,
      });
      const elapsedMs = Date.now() - start;

      const testCaseCount = Array.isArray(results) ? results.length : 0;
      const totalIterations = (results || []).reduce(
        (sum, r) => sum + (r?.iterativeRefinement?.totalIterations || 0),
        0,
      );
      const totalQuestions = (results || []).reduce(
        (sum, r) => sum + (r?.iterativeRefinement?.totalQuestionsAsked || 0),
        0,
      );

      console.log(`✅ Completed in ${(elapsedMs / 1000).toFixed(1)}s`);
      console.log(`   Test cases: ${testCaseCount}`);
      console.log(`   Total iterations: ${totalIterations}`);
      console.log(`   Total questions: ${totalQuestions}`);
      console.log(`   Output: ${outputPath}`);
      console.log();

      batchResults.push({
        datasetFile,
        datasetPath,
        elapsedMs,
        testCaseCount,
        totalIterations,
        totalQuestions,
        outputPath,
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rawResultsDir = join(__dirname, "../test-data/results/raw");
    await mkdir(rawResultsDir, { recursive: true });

    const indexPath = join(
      rawResultsDir,
      `hitl-batch-index-${timestamp}.json`,
    );

    await writeFile(
      indexPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          datasetCount: datasetFiles.length,
          batchResults,
        },
        null,
        2,
      ),
    );

    console.log("═".repeat(80));
    console.log("✅ FULL HITL BATCH COMPLETE");
    console.log("═".repeat(80));
    console.log(`Index file: ${indexPath}`);
  } catch (error) {
    console.error("\n❌ Full HITL batch failed:", error);
    process.exit(1);
  }
}

runBatchHITL();
