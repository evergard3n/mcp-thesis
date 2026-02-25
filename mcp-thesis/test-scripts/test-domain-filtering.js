#!/usr/bin/env node

/**
 * Test script to validate domain filtering in blueprint detection.
 * Tests that human-system use cases only trigger human-system blueprints.
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
config({ path: join(__dirname, "../.env") });

async function runTest() {
  console.log("🧪 Domain Filtering Test\n");

  try {
    // Read MO1 dataset (human-system logistics use case)
    const datasetPath = join(__dirname, "../test-data/dataset-MO1.json");
    const datasetContent = await readFile(datasetPath, "utf-8");
    const dataset = JSON.parse(datasetContent);

    const testCase = dataset.testCases[0];
    const vagueInput = testCase.inputs?.vague || testCase.vagueSummary || "";

    console.log(`📂 Test Case: ${testCase.testCaseId} - ${testCase.domain}`);
    console.log(`   Vague input: "${vagueInput.substring(0, 70)}..."\n`);

    // Import necessary modules
    const { generateFlatUseCase } =
      await import("../build/services/usecase.service.js");
    const { analyzeGaps } = await import("../build/analyzers/gap.analyzer.js");
    const { GeminiOpenRouterFunctions } =
      await import("../build/services/gemini-openrouter.service.js");

    // Initialize LLM
    const gemini = new GeminiOpenRouterFunctions(
      process.env.GEMINI_API_KEY || "",
      process.env.OPENROUTER_API_KEY || "",
    );

    // Step 1: Generate baseline
    console.log("📝 Generating baseline from vague input...");
    const startBaseline = Date.now();
    const baseline = await generateFlatUseCase({
      description: vagueInput,
      geminiFunctions: gemini,
    });
    const baselineTime = Date.now() - startBaseline;

    console.log(`✅ Baseline generated in ${baselineTime}ms`);
    console.log(`   Name: ${baseline.name}`);
    console.log(`   Actors: ${baseline.actors.join(", ")}`);
    console.log(`   Flows: ${baseline.flows.length}\n`);

    // Step 2: Run gap analysis with domain filtering
    console.log("🎯 Running gap analysis with domain filtering...");
    const startGapAnalysis = Date.now();
    const gapAnalysis = await analyzeGaps(
      baseline,
      { totalScore: 1.0, reasons: [] },
      vagueInput,
    );
    const gapAnalysisTime = Date.now() - startGapAnalysis;

    console.log(`✅ Gap analysis completed in ${gapAnalysisTime}ms\n`);

    // Filter blueprint gaps
    const blueprintGaps = gapAnalysis.gaps.filter((gap) =>
      gap.type.startsWith("blueprint_"),
    );

    console.log("═══════════════════════════════════════════════════════════");
    console.log("📊 BLUEPRINT DETECTION RESULTS (WITH DOMAIN FILTERING)");
    console.log(
      "═══════════════════════════════════════════════════════════\n",
    );

    console.log(`🎯 Total Gaps Detected: ${gapAnalysis.gaps.length}`);
    console.log(`📋 Blueprint Gaps: ${blueprintGaps.length}`);
    console.log(
      `⚙️  Other Gaps: ${gapAnalysis.gaps.length - blueprintGaps.length}\n`,
    );

    if (blueprintGaps.length > 0) {
      console.log("🔍 Detected Blueprint Gaps:");
      console.log("─────────────────────────────────────────────────────────");

      const blueprintTypes = [
        ...new Set(
          blueprintGaps.map((g) => {
            const match = g.type.match(/blueprint_(.+)/);
            return match ? match[1] : g.type;
          }),
        ),
      ];

      console.log(`\n📌 Unique Blueprints Triggered: ${blueprintTypes.length}`);
      console.log(`   ${blueprintTypes.join(", ")}\n`);

      // Group gaps by blueprint
      const gapsByBlueprint = {};
      for (const gap of blueprintGaps) {
        const match = gap.type.match(/blueprint_(.+)/);
        const blueprintName = match ? match[1] : gap.type;

        if (!gapsByBlueprint[blueprintName]) {
          gapsByBlueprint[blueprintName] = [];
        }
        gapsByBlueprint[blueprintName].push(gap);
      }

      // Display gaps by blueprint
      for (const [blueprintName, gaps] of Object.entries(gapsByBlueprint)) {
        console.log(`\n🔹 ${blueprintName} (${gaps.length} gaps)`);
        for (const gap of gaps) {
          console.log(`   • ${gap.description}`);
          if (gap.suggestedQuestion) {
            console.log(`     ❓ ${gap.suggestedQuestion}`);
          }
        }
      }

      console.log(
        "\n═══════════════════════════════════════════════════════════",
      );
      console.log("✅ DOMAIN FILTERING VALIDATION");
      console.log(
        "═══════════════════════════════════════════════════════════\n",
      );

      // Check if only human-system blueprints were triggered
      const humanSystemBlueprints = [
        "authentication_verification",
        "input_validation_handling",
        "search_operations",
        "user_authorization_handling",
      ];

      const systemSystemBlueprints = [
        "api_timeout_handling",
        "batch_processing_exceptions",
        "data_synchronization_conflicts",
        "service_availability_checks",
      ];

      const triggeredHumanSystem = blueprintTypes.filter((bp) =>
        humanSystemBlueprints.includes(bp),
      );
      const triggeredSystemSystem = blueprintTypes.filter((bp) =>
        systemSystemBlueprints.includes(bp),
      );

      console.log(`Expected Domain: human-system`);
      console.log(
        `Human-System Blueprints: ${triggeredHumanSystem.length} triggered`,
      );
      if (triggeredHumanSystem.length > 0) {
        console.log(`   ✅ ${triggeredHumanSystem.join(", ")}`);
      }

      console.log(
        `System-System Blueprints: ${triggeredSystemSystem.length} triggered`,
      );
      if (triggeredSystemSystem.length > 0) {
        console.log(
          `   ⚠️  ${triggeredSystemSystem.join(", ")} (should be 0!)`,
        );
      } else {
        console.log(`   ✅ None (correct!)`);
      }

      console.log();
      if (
        triggeredSystemSystem.length === 0 &&
        triggeredHumanSystem.length > 0
      ) {
        console.log("✅ Domain filtering is working correctly!");
        console.log("   Only human-system blueprints were triggered.");
      } else if (triggeredSystemSystem.length > 0) {
        console.log("⚠️  Domain filtering may have issues:");
        console.log(
          "   System-system blueprints were triggered for human-system use case.",
        );
      } else if (triggeredHumanSystem.length === 0) {
        console.log("⚠️  No human-system blueprints triggered:");
        console.log(
          "   This might indicate the use case doesn't match any blueprints,",
        );
        console.log("   or the thresholds are too strict.");
      }
    } else {
      console.log("ℹ️  No blueprint gaps detected for this use case.");
      console.log("   This could mean:");
      console.log("   - The use case is complete (unlikely for vague input)");
      console.log("   - The semantic similarity thresholds are too strict");
      console.log("   - Domain filtering excluded all relevant blueprints");
    }

    console.log("\n" + "═".repeat(60));
    console.log("✅ Test Complete!");
    console.log("═".repeat(60));
  } catch (error) {
    console.error("\n❌ Test failed:");
    console.error(error);
    process.exit(1);
  }
}

runTest();
