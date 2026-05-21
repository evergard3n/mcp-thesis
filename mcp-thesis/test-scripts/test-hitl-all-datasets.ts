#!/usr/bin/env npx tsx

/**
 * Batch run full HITL loop across all datasets.
 *
 * Usage:
 *   npx tsx test-scripts/test-hitl-all-datasets.ts
 *   npx tsx test-scripts/test-hitl-all-datasets.ts --concurrency=5
 *   npx tsx test-scripts/test-hitl-all-datasets.ts --only=UC1,UC2,BG
 *   npx tsx test-scripts/test-hitl-all-datasets.ts --exclude=CC4
 */

import { mkdir, readdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

import { runHITLComparison } from "../src/tools/testingTools.js";
import { GeminiOpenRouterFunctions } from "../src/services/gemini-openrouter.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TEST_DATA_DIR = join(ROOT, "test-data");

config({ path: join(ROOT, ".env") });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CliOptions {
  concurrency: number;
  only: Set<string> | null;
  exclude: Set<string>;
}

interface DatasetRunResult {
  datasetFile: string;
  datasetPath: string;
  elapsedMs: number;
  testCaseCount?: number;
  totalIterations?: number;
  totalQuestions?: number;
  outputPath?: string;
  status: "success" | "error";
  error?: string;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): CliOptions {
  let concurrency = 3;
  let only: Set<string> | null = null;
  const exclude = new Set<string>();

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--concurrency=")) {
      concurrency = Math.max(1, parseInt(arg.split("=")[1], 10) || 3);
    } else if (arg.startsWith("--only=")) {
      only = new Set(arg.split("=")[1].split(",").map((s) => s.trim()));
    } else if (arg.startsWith("--exclude=")) {
      for (const id of arg.split("=")[1].split(",").map((s) => s.trim())) {
        exclude.add(id);
      }
    }
  }

  return { concurrency, only, exclude };
}

function datasetId(filename: string): string {
  return filename.replace(/^dataset-/, "").replace(/\.json$/, "");
}

// ---------------------------------------------------------------------------
// Dataset discovery
// ---------------------------------------------------------------------------

async function listDatasetFiles(options: CliOptions): Promise<string[]> {
  const names = (await readdir(TEST_DATA_DIR))
    .filter((name) => name.startsWith("dataset-") && name.endsWith(".json"))
    .sort();

  return names.filter((name) => {
    const id = datasetId(name);
    if (options.only && !options.only.has(id)) return false;
    if (options.exclude.has(id)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Run one dataset
// ---------------------------------------------------------------------------

async function runDataset(
  gemini: GeminiOpenRouterFunctions,
  datasetFile: string,
  label: string,
): Promise<DatasetRunResult> {
  const datasetPath = join(TEST_DATA_DIR, datasetFile);
  const startedAt = Date.now();

  console.log(`${label} ▶ ${datasetFile}`);

  try {
    const { results, outputPath } = await runHITLComparison(gemini, {
      datasetPath,
    });

    const elapsedMs = Date.now() - startedAt;
    const testCaseCount = results.length;
    const totalIterations = results.reduce(
      (sum, r) => sum + (r.iterativeRefinement?.totalIterations ?? 0),
      0,
    );
    const totalQuestions = results.reduce(
      (sum, r) => sum + (r.iterativeRefinement?.totalQuestionsAsked ?? 0),
      0,
    );

    console.log(
      `${label} ✅ ${datasetFile} — ${(elapsedMs / 1000).toFixed(1)}s | ` +
        `cases=${testCaseCount} iters=${totalIterations} qs=${totalQuestions}`,
    );

    return {
      datasetFile,
      datasetPath,
      elapsedMs,
      testCaseCount,
      totalIterations,
      totalQuestions,
      outputPath,
      status: "success",
    };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);

    console.error(
      `${label} ❌ ${datasetFile} — ${(elapsedMs / 1000).toFixed(1)}s | ${error.slice(0, 120)}`,
    );

    return {
      datasetFile,
      datasetPath,
      elapsedMs,
      status: "error",
      error,
    };
  }
}

// ---------------------------------------------------------------------------
// Run all datasets (bounded parallelism via chunks)
// ---------------------------------------------------------------------------

async function runAllDatasets(
  gemini: GeminiOpenRouterFunctions,
  datasetFiles: string[],
  concurrency: number,
): Promise<DatasetRunResult[]> {
  const results: DatasetRunResult[] = [];
  const total = datasetFiles.length;

  for (let offset = 0; offset < total; offset += concurrency) {
    const chunk = datasetFiles.slice(offset, offset + concurrency);

    const chunkResults = await Promise.all(
      chunk.map((datasetFile, i) => {
        const index = offset + i + 1;
        const label = `[${String(index).padStart(2)}/${total}]`;
        return runDataset(gemini, datasetFile, label);
      }),
    );

    results.push(...chunkResults);

    const done = Math.min(offset + concurrency, total);
    console.log(`--- ${done}/${total} datasets finished ---\n`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Persist batch index
// ---------------------------------------------------------------------------

async function writeBatchIndex(
  results: DatasetRunResult[],
  options: CliOptions,
  wallTimeMs: number,
): Promise<string> {
  const rawDir = join(TEST_DATA_DIR, "results/raw");
  await mkdir(rawDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const indexPath = join(rawDir, `hitl-batch-index-${timestamp}.json`);

  const errors = results.filter((r) => r.status === "error");

  await writeFile(
    indexPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        concurrency: options.concurrency,
        wallTimeMs,
        datasetCount: results.length,
        successCount: results.length - errors.length,
        errorCount: errors.length,
        batchResults: results,
      },
      null,
      2,
    ),
  );

  return indexPath;
}

function printSummary(
  results: DatasetRunResult[],
  wallTimeMs: number,
  indexPath: string,
): void {
  const errors = results.filter((r) => r.status === "error");

  console.log("═".repeat(80));
  console.log("FULL HITL BATCH COMPLETE");
  console.log("═".repeat(80));
  console.log(`  Wall time:  ${(wallTimeMs / 1000).toFixed(1)}s`);
  console.log(`  Succeeded:  ${results.length - errors.length}/${results.length}`);
  console.log(`  Failed:     ${errors.length}`);
  console.log(`  Index file: ${indexPath}`);

  if (errors.length > 0) {
    console.log("  Failed datasets:");
    for (const e of errors) {
      console.log(`    - ${e.datasetFile}: ${(e.error ?? "").slice(0, 100)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs();

  console.log("Full HITL batch — all datasets\n");
  console.log(`Concurrency: ${options.concurrency}\n`);

  const gemini = new GeminiOpenRouterFunctions(
    process.env.GEMINI_API_KEY ?? "",
    process.env.OPENROUTER_API_KEY ?? "",
  );

  const datasetFiles = await listDatasetFiles(options);

  if (datasetFiles.length === 0) {
    console.log("No datasets matched filters.");
    return;
  }

  console.log(`Found ${datasetFiles.length} dataset(s):`);
  for (const name of datasetFiles) {
    console.log(`  - ${name}`);
  }
  console.log();

  const startedAt = Date.now();
  const results = await runAllDatasets(gemini, datasetFiles, options.concurrency);
  const wallTimeMs = Date.now() - startedAt;

  const indexPath = await writeBatchIndex(results, options, wallTimeMs);
  printSummary(results, wallTimeMs, indexPath);
}

main().catch((err) => {
  console.error("\nBatch failed:", err);
  process.exit(1);
});
