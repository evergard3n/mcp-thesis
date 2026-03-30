#!/usr/bin/env node

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "../.env") });

async function loadDatasetIndex(testDataDir) {
  const files = await readdir(testDataDir);
  const datasetFiles = files
    .filter((name) => name.startsWith("dataset-") && name.endsWith(".json"))
    .sort();

  const index = [];

  for (const fileName of datasetFiles) {
    const filePath = join(testDataDir, fileName);
    const raw = await readFile(filePath, "utf-8");
    const dataset = JSON.parse(raw);
    const ids = new Set((dataset.testCases || []).map((tc) => tc.id).filter(Boolean));

    index.push({
      fileName,
      filePath,
      ids,
    });
  }

  return index;
}

function findMatchingDataset(testCaseIds, datasetIndex) {
  return datasetIndex.filter((dataset) =>
    testCaseIds.every((id) => dataset.ids.has(id)),
  );
}

async function runEvaluateBatch() {
  console.log("🧪 Evaluate HITL Results Batch\n");

  const testDataDir = join(__dirname, "../test-data");
  const rawDir = join(__dirname, "../test-data/results/raw");
  const evaluatedDir = join(__dirname, "../test-data/results/evaluated");

  await mkdir(evaluatedDir, { recursive: true });

  const rawFiles = (await readdir(rawDir))
    .filter((name) => name.startsWith("enhanced") && name.endsWith(".json"))
    .sort();

  const evaluatedFiles = new Set(
    (await readdir(evaluatedDir)).filter(
      (name) => name.startsWith("enhanced") && name.endsWith(".json"),
    ),
  );

  const pendingFiles = rawFiles.filter((name) => !evaluatedFiles.has(name));

  console.log(`Raw result files: ${rawFiles.length}`);
  console.log(`Already evaluated: ${evaluatedFiles.size}`);
  console.log(`Pending evaluation: ${pendingFiles.length}\n`);

  if (pendingFiles.length === 0) {
    console.log("Nothing to evaluate.");
    return;
  }

  const { evaluateResults } = await import("../build/tools/testingTools.js");
  const { GeminiOpenRouterFunctions } = await import(
    "../build/services/gemini-openrouter.service.js"
  );

  const gemini = new GeminiOpenRouterFunctions(
    process.env.GEMINI_API_KEY || "",
    process.env.OPENROUTER_API_KEY || "",
  );

  const datasetIndex = await loadDatasetIndex(testDataDir);

  const evaluated = [];
  const skipped = [];
  const errors = [];

  for (let i = 0; i < pendingFiles.length; i++) {
    const resultFile = pendingFiles[i];
    const resultsPath = join(rawDir, resultFile);

    console.log(`\n[${i + 1}/${pendingFiles.length}] ${resultFile}`);

    try {
      const rawResults = JSON.parse(await readFile(resultsPath, "utf-8"));
      const testCaseIds = Array.from(
        new Set((rawResults || []).map((r) => r.testCaseId).filter(Boolean)),
      );

      if (testCaseIds.length === 0) {
        skipped.push({
          resultFile,
          reason: "No testCaseId found in result file",
        });
        console.log("  ⚠ Skipped: no testCaseId found");
        continue;
      }

      const matches = findMatchingDataset(testCaseIds, datasetIndex);

      if (matches.length === 0) {
        skipped.push({
          resultFile,
          reason: `No dataset matches testCaseIds: ${testCaseIds.join(", ")}`,
          testCaseIds,
        });
        console.log("  ⚠ Skipped: no matching dataset");
        continue;
      }

      if (matches.length > 1) {
        skipped.push({
          resultFile,
          reason: "Multiple matching datasets found",
          matches: matches.map((m) => m.fileName),
          testCaseIds,
        });
        console.log("  ⚠ Skipped: multiple matching datasets");
        continue;
      }

      const datasetPath = matches[0].filePath;
      const output = await evaluateResults(gemini, { resultsPath, datasetPath });

      evaluated.push({
        resultFile,
        datasetFile: matches[0].fileName,
        testCaseIds,
        outputPath: output.outputPath,
      });

      console.log(`  ✅ Evaluated with dataset: ${matches[0].fileName}`);
      console.log(`  📄 Output: ${output.outputPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ resultFile, error: message });
      console.log(`  ❌ Failed: ${message}`);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const indexPath = join(
    evaluatedDir,
    `evaluation-batch-index-${timestamp}.json`,
  );

  await writeFile(
    indexPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        counts: {
          raw: rawFiles.length,
          pending: pendingFiles.length,
          evaluated: evaluated.length,
          skipped: skipped.length,
          errors: errors.length,
        },
        evaluated,
        skipped,
        errors,
      },
      null,
      2,
    ),
  );

  console.log("\n════════════════════════════════════════════════════════════════════════════════");
  console.log("✅ EVALUATION BATCH COMPLETE");
  console.log("════════════════════════════════════════════════════════════════════════════════");
  console.log(`Evaluated: ${evaluated.length}`);
  console.log(`Skipped:   ${skipped.length}`);
  console.log(`Errors:    ${errors.length}`);
  console.log(`Index:     ${indexPath}`);
}

runEvaluateBatch().catch((error) => {
  console.error("\n❌ Evaluation batch failed:", error);
  process.exit(1);
});
