#!/usr/bin/env node

/**
 * Test if CC4 is correctly classified as system-system
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "../.env") });

async function testCC4Domain() {
  console.log("🔍 Testing CC4 Domain Classification\n");

  try {
    // Read CC4 dataset
    const datasetPath = join(__dirname, "../test-data/dataset-CC4.json");
    const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
    const testCase = dataset.testCases[0];
    const vagueInput = testCase.inputs.vague;

    console.log("📂 CC4 Dataset");
    console.log(`   Domain (expected): ${testCase.domain}`);
    console.log(`   Vague: ${vagueInput}\n`);

    // Import services
    const { generateFlatUseCase } =
      await import("../build/services/usecase.service.js");
    const { GeminiOpenRouterFunctions } =
      await import("../build/services/gemini-openrouter.service.js");
    const { classifyUseCaseDomainHybrid } =
      await import("../build/services/domain-classifier.service.js");

    const gemini = new GeminiOpenRouterFunctions(
      process.env.GEMINI_API_KEY || "",
      process.env.OPENROUTER_API_KEY || "",
    );

    // Generate baseline
    console.log("📝 Generating baseline...");
    const baseline = await generateFlatUseCase({
      description: vagueInput,
      geminiFunctions: gemini,
    });

    console.log(`✅ Generated: ${baseline.name}`);
    console.log(`   Actors: ${baseline.actors.join(", ")}\n`);

    // Classify domain
    console.log("🎯 Classifying domain...");
    const domainAnalysis = await classifyUseCaseDomainHybrid(baseline);

    console.log("\n" + "═".repeat(80));
    console.log("📊 DOMAIN CLASSIFICATION RESULT");
    console.log("═".repeat(80));
    console.log(`\nDominant Domain: ${domainAnalysis.dominantDomain}`);
    console.log(
      `Overall Confidence: ${(domainAnalysis.overallConfidence * 100).toFixed(1)}%`,
    );
    console.log(`Summary: ${domainAnalysis.summary}\n`);

    if (domainAnalysis.actorClassifications) {
      console.log("👥 Actor Classifications:");
      console.log("─".repeat(80));
      for (const ac of domainAnalysis.actorClassifications) {
        const icon =
          ac.type === "human" ? "👤" : ac.type === "system" ? "🖥️" : "❓";
        console.log(`   ${icon} ${ac.actor}`);
        console.log(
          `      Type: ${ac.type} (${(ac.confidence * 100).toFixed(1)}% confidence)`,
        );
        console.log(`      Method: ${ac.method}`);
      }
      console.log();
    }

    console.log("📋 Flow Classifications:");
    console.log("─".repeat(80));
    for (const fc of domainAnalysis.flowClassifications) {
      console.log(`   Flow: ${fc.flowId}`);
      console.log(
        `   Domain: ${fc.domainType} (${(fc.confidence * 100).toFixed(1)}% confidence)`,
      );
      console.log(`   Reasoning: ${fc.reasoning}`);
      console.log(
        `   Actors: ${fc.actorTypes.map((a) => `${a.actor} (${a.type})`).join(", ")}`,
      );
      console.log();
    }

    // Check if correct
    const expectedDomain = "system-system";
    const isCorrect = domainAnalysis.dominantDomain === expectedDomain;

    console.log("═".repeat(80));
    if (isCorrect) {
      console.log("✅ SUCCESS: CC4 correctly classified as system-system!");
    } else {
      console.log(
        `❌ FAILURE: Expected ${expectedDomain}, got ${domainAnalysis.dominantDomain}`,
      );
      console.log("\n💡 Diagnosis:");
      console.log(
        "   - Actor 'Service Client' should be detected as system (not human)",
      );
      console.log("   - Check SYSTEM_KEYWORDS contains 'service client'");
      console.log("   - Check compound keyword prioritization logic");
    }
    console.log("═".repeat(80));
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

testCC4Domain();
