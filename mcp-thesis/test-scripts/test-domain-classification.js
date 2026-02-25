#!/usr/bin/env node

/**
 * Test script to run HITL comparison with domain classification
 * Tests hybrid domain classifier on a small dataset
 */

import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
config({ path: join(__dirname, "..", ".env") });

async function runTest() {
  console.log("🧪 Starting Domain Classification Test...\n");

  try {
    // Read MO1 dataset
    const datasetPath = join(__dirname, "../test-data/dataset-MO1.json");
    const datasetContent = await readFile(datasetPath, "utf-8");
    const dataset = JSON.parse(datasetContent);

    console.log(`📂 Loaded dataset: ${dataset.testCases.length} test case(s)`);
    console.log(
      `   Test Case: ${dataset.testCases[0].id} - ${dataset.testCases[0].domain}\n`,
    );

    // Import necessary modules
    const { generateFlatUseCase } =
      await import("../build/services/usecase.service.js");
    const { classifyUseCaseDomain } =
      await import("../build/services/domain-classifier.service.js");
    const { GeminiOpenRouterFunctions } =
      await import("../build/services/gemini-openrouter.service.js");

    // Initialize LLM
    const gemini = new GeminiOpenRouterFunctions(
      process.env.GEMINI_API_KEY || "",
      process.env.OPENROUTER_API_KEY || "",
    );

    const testCase = dataset.testCases[0];

    // Step 1: Generate baseline from vague input
    console.log("📝 Step 1: Generating baseline from vague input...");
    console.log(`   Input: "${testCase.inputs.vague.substring(0, 80)}..."\n`);

    const baseline = await generateFlatUseCase({
      description: testCase.inputs.vague,
      geminiFunctions: gemini,
    });

    console.log(`✅ Baseline generated:`);
    console.log(`   Name: ${baseline.name}`);
    console.log(`   Flows: ${baseline.flows.length}`);
    console.log(`   Actors: ${baseline.actors.join(", ")}\n`);

    // Step 2: Classify domain (hybrid method)
    console.log("🎯 Step 2: Classifying domain (hybrid method)...");
    const startTime = Date.now();

    const domainAnalysis = await classifyUseCaseDomain(
      baseline,
      gemini,
      "hybrid",
    );

    const duration = Date.now() - startTime;

    console.log(`✅ Domain classification completed in ${duration}ms\n`);

    // Step 3: Display results
    console.log("═══════════════════════════════════════════════════════════");
    console.log("📊 DOMAIN CLASSIFICATION RESULTS");
    console.log(
      "═══════════════════════════════════════════════════════════\n",
    );

    console.log(`🎯 Dominant Domain: ${domainAnalysis.dominantDomain}`);
    console.log(
      `📈 Overall Confidence: ${(domainAnalysis.overallConfidence * 100).toFixed(1)}%`,
    );
    console.log(`📝 Summary: ${domainAnalysis.summary}\n`);

    console.log("👥 Actor Classifications:");
    console.log("─────────────────────────────────────────────────────────");
    if (domainAnalysis.actorClassifications) {
      domainAnalysis.actorClassifications.forEach((ac) => {
        const confidenceBar = "█".repeat(Math.round(ac.confidence * 10));
        console.log(
          `  ${ac.actor.padEnd(25)} ${ac.type.padEnd(10)} [${confidenceBar.padEnd(10)}] ${(ac.confidence * 100).toFixed(0)}% (${ac.method})`,
        );
      });
    }

    console.log("\n🔄 Flow Classifications:");
    console.log("─────────────────────────────────────────────────────────");
    domainAnalysis.flowClassifications.forEach((fc) => {
      console.log(
        `  ${fc.flowId.padEnd(10)} → ${fc.domainType.padEnd(15)} (${(fc.confidence * 100).toFixed(0)}%)`,
      );
      console.log(`  └─ ${fc.reasoning}`);
    });

    // Step 4: Compare with detailed input
    console.log(
      "\n\n📝 Step 4: Generating baseline from detailed input (for comparison)...\n",
    );

    const detailedBaseline = await generateFlatUseCase({
      description: testCase.inputs.detailed,
      geminiFunctions: gemini,
    });

    const detailedDomain = await classifyUseCaseDomain(
      detailedBaseline,
      gemini,
      "hybrid",
    );

    console.log("═══════════════════════════════════════════════════════════");
    console.log("📊 COMPARISON: VAGUE vs DETAILED INPUT");
    console.log(
      "═══════════════════════════════════════════════════════════\n",
    );

    console.log("Vague Input:");
    console.log(
      `  Domain: ${domainAnalysis.dominantDomain} (${(domainAnalysis.overallConfidence * 100).toFixed(0)}%)`,
    );
    console.log(`  Flows: ${baseline.flows.length}`);
    console.log(`  Actors: ${baseline.actors.length}`);

    console.log("\nDetailed Input:");
    console.log(
      `  Domain: ${detailedDomain.dominantDomain} (${(detailedDomain.overallConfidence * 100).toFixed(0)}%)`,
    );
    console.log(`  Flows: ${detailedBaseline.flows.length}`);
    console.log(`  Actors: ${detailedBaseline.actors.length}`);

    console.log(
      "\nDomain Agreement:",
      domainAnalysis.dominantDomain === detailedDomain.dominantDomain
        ? "✅ YES"
        : "❌ NO",
    );

    // Step 5: Save results
    const results = {
      testCaseId: testCase.id,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      vague: {
        useCase: baseline,
        domain: domainAnalysis,
      },
      detailed: {
        useCase: detailedBaseline,
        domain: detailedDomain,
      },
      comparison: {
        domainAgreement:
          domainAnalysis.dominantDomain === detailedDomain.dominantDomain,
        vagueDomain: domainAnalysis.dominantDomain,
        detailedDomain: detailedDomain.dominantDomain,
      },
    };

    const outputPath = join(
      __dirname,
      "../test-data/results-domain-classification.json",
    );
    await writeFile(outputPath, JSON.stringify(results, null, 2));

    console.log(`\n💾 Results saved to: ${outputPath}`);
    console.log("\n✅ Test completed successfully!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
