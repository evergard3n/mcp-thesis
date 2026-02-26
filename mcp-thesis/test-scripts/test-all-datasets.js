#!/usr/bin/env node

/**
 * Batch test all datasets to measure blueprint detection performance
 * Tests both vague and detailed inputs across all available datasets
 */

import { readFile, writeFile, readdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "../.env") });

async function testAllDatasets() {
  console.log("🧪 Batch Blueprint Detection Test - All Datasets\n");
  console.log("═".repeat(80));
  console.log("Testing blueprint detection with domain filtering");
  console.log("═".repeat(80));
  console.log();

  try {
    // Import services
    const { generateFlatUseCase } =
      await import("../build/services/usecase.service.js");
    const { analyzeGaps } = await import("../build/analyzers/gap.analyzer.js");
    const { GeminiOpenRouterFunctions } =
      await import("../build/services/gemini-openrouter.service.js");

    const gemini = new GeminiOpenRouterFunctions(
      process.env.GEMINI_API_KEY || "",
      process.env.OPENROUTER_API_KEY || "",
    );

    // Get all dataset files
    const datasetDir = join(__dirname, "../test-data");
    const files = await readdir(datasetDir);
    const datasetFiles = files.filter(
      (f) => f.startsWith("dataset-") && f.endsWith(".json"),
    );

    console.log(`📂 Found ${datasetFiles.length} datasets:`);
    datasetFiles.forEach((f) => console.log(`   - ${f}`));
    console.log();

    const results = [];
    let totalTests = 0;
    let totalBlueprintGaps = 0;
    let totalGaps = 0;
    let totalTime = 0;

    for (const datasetFile of datasetFiles) {
      const datasetPath = join(datasetDir, datasetFile);
      const datasetContent = await readFile(datasetPath, "utf-8");
      const dataset = JSON.parse(datasetContent);

      if (!dataset.testCases || dataset.testCases.length === 0) {
        console.log(`⚠️  Skipping ${datasetFile}: No test cases\n`);
        continue;
      }

      console.log("\n" + "═".repeat(80));
      console.log(`📊 Dataset: ${datasetFile}`);
      console.log("═".repeat(80));

      for (const testCase of dataset.testCases) {
        const testCaseId =
          testCase.id || testCase.testCaseId || `Unknown-${totalTests}`;
        const domain = testCase.domain || "Unknown";
        const vagueInput =
          testCase.inputs?.vague || testCase.vagueSummary || "";

        if (!vagueInput) {
          console.log(`⚠️  Skipping ${testCaseId}: No vague input\n`);
          continue;
        }

        console.log(`\n🔍 Test Case: ${testCaseId} (${domain})`);
        console.log(`   Input length: ${vagueInput.length} chars`);

        // Generate baseline
        console.log(`   Generating baseline...`);
        const startBaseline = Date.now();
        const baseline = await generateFlatUseCase({
          description: vagueInput,
          geminiFunctions: gemini,
        });
        const baselineTime = Date.now() - startBaseline;

        console.log(`   ✅ Baseline: ${baseline.name}`);
        console.log(
          `      Actors: ${baseline.actors.length}, Flows: ${baseline.flows.length}`,
        );

        // Run gap analysis with blueprint detection
        console.log(`   Running gap analysis...`);
        const startGaps = Date.now();
        const gapAnalysis = await analyzeGaps(
          baseline,
          { totalScore: 1.0, reasons: [] },
          vagueInput,
        );
        const gapTime = Date.now() - startGaps;

        const blueprintGaps = gapAnalysis.gaps.filter((g) =>
          g.type.startsWith("blueprint_"),
        );
        const otherGaps = gapAnalysis.gaps.filter(
          (g) => !g.type.startsWith("blueprint_"),
        );

        console.log(`   ✅ Gaps detected: ${gapAnalysis.gaps.length} total`);
        console.log(`      Blueprint gaps: ${blueprintGaps.length}`);
        console.log(`      Other gaps: ${otherGaps.length}`);
        console.log(`      Time: ${gapTime}ms`);

        // Extract unique blueprints
        const uniqueBlueprints = [
          ...new Set(
            blueprintGaps.map((g) => {
              const match = g.type.match(/blueprint_(.+)/);
              return match ? match[1] : g.type;
            }),
          ),
        ];

        if (uniqueBlueprints.length > 0) {
          console.log(`      Blueprints: ${uniqueBlueprints.join(", ")}`);
        }

        // Store results
        results.push({
          dataset: datasetFile,
          testCaseId,
          domain,
          baselineTime,
          gapTime,
          totalTime: baselineTime + gapTime,
          actors: baseline.actors.length,
          flows: baseline.flows.length,
          totalGaps: gapAnalysis.gaps.length,
          blueprintGaps: blueprintGaps.length,
          otherGaps: otherGaps.length,
          blueprints: uniqueBlueprints,
        });

        totalTests++;
        totalBlueprintGaps += blueprintGaps.length;
        totalGaps += gapAnalysis.gaps.length;
        totalTime += baselineTime + gapTime;

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Summary
    console.log("\n\n" + "═".repeat(80));
    console.log("📊 BATCH TEST SUMMARY");
    console.log("═".repeat(80));
    console.log();

    console.log(`Total Test Cases: ${totalTests}`);
    console.log(`Total Gaps Detected: ${totalGaps}`);
    console.log(
      `  - Blueprint gaps: ${totalBlueprintGaps} (${((totalBlueprintGaps / totalGaps) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  - Other gaps: ${totalGaps - totalBlueprintGaps} (${(((totalGaps - totalBlueprintGaps) / totalGaps) * 100).toFixed(1)}%)`,
    );
    console.log(
      `Average gaps per test: ${(totalGaps / totalTests).toFixed(1)}`,
    );
    console.log(
      `Average blueprint gaps per test: ${(totalBlueprintGaps / totalTests).toFixed(1)}`,
    );
    console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s`);
    console.log(
      `Average time per test: ${(totalTime / totalTests).toFixed(0)}ms`,
    );
    console.log();

    // Blueprint frequency
    const blueprintCounts = {};
    results.forEach((r) => {
      r.blueprints.forEach((bp) => {
        blueprintCounts[bp] = (blueprintCounts[bp] || 0) + 1;
      });
    });

    if (Object.keys(blueprintCounts).length > 0) {
      console.log("📋 Blueprint Activation Frequency:");
      console.log("─".repeat(80));
      Object.entries(blueprintCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([bp, count]) => {
          const percentage = ((count / totalTests) * 100).toFixed(1);
          console.log(
            `   ${bp.padEnd(40)} ${count.toString().padStart(3)} (${percentage}%)`,
          );
        });
      console.log();
    }

    // Domain breakdown
    const domainStats = {};
    results.forEach((r) => {
      if (!domainStats[r.domain]) {
        domainStats[r.domain] = {
          count: 0,
          totalGaps: 0,
          blueprintGaps: 0,
        };
      }
      domainStats[r.domain].count++;
      domainStats[r.domain].totalGaps += r.totalGaps;
      domainStats[r.domain].blueprintGaps += r.blueprintGaps;
    });

    console.log("🎯 Domain Breakdown:");
    console.log("─".repeat(80));
    Object.entries(domainStats).forEach(([domain, stats]) => {
      const avgGaps = (stats.totalGaps / stats.count).toFixed(1);
      const avgBlueprints = (stats.blueprintGaps / stats.count).toFixed(1);
      console.log(
        `   ${domain.padEnd(20)} ${stats.count} tests, avg ${avgGaps} gaps (${avgBlueprints} blueprint)`,
      );
    });
    console.log();

    // Save detailed results
    const outputPath = join(__dirname, "../test-results-all-datasets.json");
    await writeFile(
      outputPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          summary: {
            totalTests,
            totalGaps,
            totalBlueprintGaps,
            totalTime,
            avgGapsPerTest: totalGaps / totalTests,
            avgBlueprintGapsPerTest: totalBlueprintGaps / totalTests,
            avgTimePerTest: totalTime / totalTests,
          },
          blueprintFrequency: blueprintCounts,
          domainStats,
          results,
        },
        null,
        2,
      ),
    );

    console.log(`💾 Detailed results saved to: test-results-all-datasets.json`);
    console.log();
    console.log("✅ Batch test complete!");
    console.log("═".repeat(80));
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

testAllDatasets();
