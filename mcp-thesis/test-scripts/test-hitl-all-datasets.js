#!/usr/bin/env node

/**
 * Batch run full HITL loop across all datasets — with concurrency control.
 *
 * Usage:
 *   node test-scripts/test-hitl-all-datasets.js                     # default concurrency=3
 *   node test-scripts/test-hitl-all-datasets.js --concurrency=5     # 5 parallel datasets
 *   node test-scripts/test-hitl-all-datasets.js --concurrency=1     # sequential (old behavior)
 *   node test-scripts/test-hitl-all-datasets.js --only=UC1,UC2,BG   # run specific datasets only
 *   node test-scripts/test-hitl-all-datasets.js --exclude=CC4       # skip specific datasets
 *
 * Each dataset runs inside its own try/catch so a single failure
 * does not abort the remaining datasets.
 */

import { readdir, writeFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "../.env") });

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let concurrency = 3;
  let only = null;
  let exclude = new Set();

  for (const arg of args) {
    if (arg.startsWith("--concurrency=")) {
      concurrency = Math.max(1, parseInt(arg.split("=")[1], 10) || 3);
    } else if (arg.startsWith("--only=")) {
      only = new Set(arg.split("=")[1].split(",").map((s) => s.trim()));
    } else if (arg.startsWith("--exclude=")) {
      exclude = new Set(arg.split("=")[1].split(",").map((s) => s.trim()));
    }
  }

  return { concurrency, only, exclude };
}

// ---------------------------------------------------------------------------
// Promise pool — run at most N tasks concurrently
// ---------------------------------------------------------------------------

async function promisePool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let nextIndex = 0;
  let completed = 0;

  async function runNext() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
      completed++;
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    workers.push(runNext());
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runBatchHITL() {
  const { concurrency, only, exclude } = parseArgs();

  console.log("🧪 Full HITL Batch Test - All Datasets\n");
  console.log("═".repeat(80));
  console.log(`Running runHITLComparison (concurrency=${concurrency})`);
  console.log("═".repeat(80));
  console.log();

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
  let datasetFiles = files
    .filter((name) => name.startsWith("dataset-") && name.endsWith(".json"))
    .sort();

  if (only) {
    datasetFiles = datasetFiles.filter((name) => {
      const id = name.replace("dataset-", "").replace(".json", "");
      return only.has(id);
    });
  }
  if (exclude.size > 0) {
    datasetFiles = datasetFiles.filter((name) => {
      const id = name.replace("dataset-", "").replace(".json", "");
      return !exclude.has(id);
    });
  }

  console.log(`📂 Found ${datasetFiles.length} datasets:`);
  datasetFiles.forEach((name) => console.log(`   - ${name}`));
  console.log();

  const batchStart = Date.now();
  const batchResults = [];
  const errors = [];
  let completedCount = 0;

  const tasks = datasetFiles.map((datasetFile, i) => {
    return async () => {
      const datasetPath = join(testDataDir, datasetFile);
      const tag = `[${String(i + 1).padStart(2)}/${datasetFiles.length}]`;

      console.log(`${tag} ▶ Starting ${datasetFile}`);

      const start = Date.now();
      try {
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

        completedCount++;
        console.log(
          `${tag} ✅ ${datasetFile} — ${(elapsedMs / 1000).toFixed(1)}s | ` +
            `cases=${testCaseCount} iters=${totalIterations} qs=${totalQuestions} ` +
            `(${completedCount}/${datasetFiles.length} done)`,
        );

        const result = {
          datasetFile,
          datasetPath,
          elapsedMs,
          testCaseCount,
          totalIterations,
          totalQuestions,
          outputPath,
          status: "success",
        };
        batchResults.push(result);
        return result;
      } catch (error) {
        const elapsedMs = Date.now() - start;
        const message =
          error instanceof Error ? error.message : String(error);

        completedCount++;
        console.error(
          `${tag} ❌ ${datasetFile} — FAILED after ${(elapsedMs / 1000).toFixed(1)}s: ${message.slice(0, 120)} ` +
            `(${completedCount}/${datasetFiles.length} done)`,
        );

        const result = {
          datasetFile,
          datasetPath,
          elapsedMs,
          status: "error",
          error: message,
        };
        batchResults.push(result);
        errors.push(result);
        return result;
      }
    };
  });

  await promisePool(tasks, concurrency);

  const batchElapsed = Date.now() - batchStart;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawResultsDir = join(__dirname, "../test-data/results/raw");
  await mkdir(rawResultsDir, { recursive: true });

  const indexPath = join(
    rawResultsDir,
    `hitl-batch-index-${timestamp}.json`,
  );

  const orderedResults = datasetFiles.map((name) =>
    batchResults.find((r) => r.datasetFile === name),
  );

  await writeFile(
    indexPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        concurrency,
        wallTimeMs: batchElapsed,
        datasetCount: datasetFiles.length,
        successCount: datasetFiles.length - errors.length,
        errorCount: errors.length,
        batchResults: orderedResults,
      },
      null,
      2,
    ),
  );

  console.log();
  console.log("═".repeat(80));
  console.log("✅ FULL HITL BATCH COMPLETE");
  console.log("═".repeat(80));
  console.log(`  Wall time:  ${(batchElapsed / 1000).toFixed(1)}s`);
  console.log(`  Succeeded:  ${datasetFiles.length - errors.length}/${datasetFiles.length}`);
  console.log(`  Failed:     ${errors.length}`);
  console.log(`  Index file: ${indexPath}`);
  if (errors.length > 0) {
    console.log(`  Failed datasets:`);
    for (const e of errors) {
      console.log(`    - ${e.datasetFile}: ${e.error.slice(0, 100)}`);
    }
  }
}

runBatchHITL().catch((error) => {
  console.error("\n❌ Batch setup failed:", error);
  process.exit(1);
});
