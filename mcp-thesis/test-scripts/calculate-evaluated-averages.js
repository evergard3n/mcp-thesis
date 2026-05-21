#!/usr/bin/env node

import { readdir, readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const evaluatedDir = join(__dirname, "../test-data/results/evaluated");

const CONDITION_LABELS = {
  conditionA_Baseline: "Baseline",
  conditionA_DetailedBaseline: "Detailed Baseline",
  conditionB_EnhancedHITL: "Enhanced HITL",
};

const SCORE_KEYS = [
  "qualityScore",
  "discoveryRate",
  "precision",
  "f1Score",
];

function createAccumulator() {
  return {
    count: 0,
    qualityScore: 0,
    discoveryRate: 0,
    precision: 0,
    f1Score: 0,
  };
}

function formatNumber(value) {
  return value.toFixed(4);
}

function pad(value, width) {
  return String(value).padEnd(width);
}

async function loadEvaluatedFiles() {
  const fileNames = await readdir(evaluatedDir);

  return fileNames
    .filter(
      (name) => name.startsWith("enhanced-hitl-") && name.endsWith(".json"),
    )
    .sort();
}

async function aggregateScores(fileNames) {
  const totals = Object.fromEntries(
    Object.keys(CONDITION_LABELS).map((key) => [key, createAccumulator()]),
  );

  for (const fileName of fileNames) {
    const filePath = join(evaluatedDir, fileName);
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const evaluations = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];

    for (const evaluation of evaluations) {
      const conditionResults = evaluation.evaluations || {};

      for (const [conditionKey, label] of Object.entries(CONDITION_LABELS)) {
        const scores = conditionResults[conditionKey]?.scores;

        if (!scores) {
          throw new Error(
            `Missing scores for ${label} in file ${fileName} (testCaseId: ${evaluation.testCaseId || "unknown"})`,
          );
        }

        const accumulator = totals[conditionKey];
        accumulator.count += 1;

        for (const scoreKey of SCORE_KEYS) {
          const value = scores[scoreKey];

          if (typeof value !== "number" || Number.isNaN(value)) {
            throw new Error(
              `Invalid ${scoreKey} for ${label} in file ${fileName} (testCaseId: ${evaluation.testCaseId || "unknown"})`,
            );
          }

          accumulator[scoreKey] += value;
        }
      }
    }
  }

  return totals;
}

function printTable(totals, fileCount) {
  const headers = ["Condition", "Count", "Quality", "Discovery", "Precision", "F1"];
  const rows = Object.entries(CONDITION_LABELS).map(([conditionKey, label]) => {
    const total = totals[conditionKey];

    return [
      label,
      total.count,
      formatNumber(total.qualityScore / total.count),
      formatNumber(total.discoveryRate / total.count),
      formatNumber(total.precision / total.count),
      formatNumber(total.f1Score / total.count),
    ];
  });

  const columnWidths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)),
  );

  console.log("Evaluated Results Average Scores\n");
  console.log(`Files processed: ${fileCount}\n`);
  console.log(
    headers.map((header, index) => pad(header, columnWidths[index])).join("  "),
  );
  console.log(
    columnWidths.map((width) => "-".repeat(width)).join("  "),
  );

  for (const row of rows) {
    console.log(row.map((value, index) => pad(value, columnWidths[index])).join("  "));
  }
}

async function main() {
  const fileNames = await loadEvaluatedFiles();

  if (fileNames.length === 0) {
    console.log("No evaluated result files found.");
    return;
  }

  const totals = await aggregateScores(fileNames);
  printTable(totals, fileNames.length);
}

main().catch((error) => {
  console.error("\nFailed to calculate evaluated averages:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
