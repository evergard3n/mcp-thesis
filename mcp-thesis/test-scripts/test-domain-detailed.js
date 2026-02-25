#!/usr/bin/env node

/**
 * Domain classification test with DETAILED input
 * Compare vague vs detailed input results
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
  console.log("🧪 Domain Classification Test: Vague vs Detailed Input\n");
  console.log("═══════════════════════════════════════════════════════════\n");

  try {
    // Read MO1 dataset
    const datasetPath = join(__dirname, "../test-data/dataset-MO1.json");
    const datasetContent = await readFile(datasetPath, "utf-8");
    const dataset = JSON.parse(datasetContent);
    const testCase = dataset.testCases[0];

    console.log(`📂 Test Case: ${testCase.id} - ${testCase.domain}`);
    console.log(`   Expected Flows: ${testCase.metadata.expectedFlows}`);
    console.log(`   Complexity: ${testCase.metadata.complexity}\n`);

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

    // ========================================
    // SCENARIO A: VAGUE INPUT
    // ========================================
    console.log("📝 SCENARIO A: Vague Input");
    console.log("─────────────────────────────────────────────────────────");
    console.log(`Input: "${testCase.inputs.vague.substring(0, 80)}..."\n`);

    const startVague = Date.now();
    const baselineVague = await generateFlatUseCase({
      description: testCase.inputs.vague,
      geminiFunctions: gemini,
    });
    const vagueLLMTime = Date.now() - startVague;

    console.log(`✅ Baseline generated in ${vagueLLMTime}ms`);
    console.log(`   Name: ${baselineVague.name}`);
    console.log(
      `   Actors: ${baselineVague.actors.length} (${baselineVague.actors.join(", ")})`,
    );
    console.log(`   Flows: ${baselineVague.flows.length}`);
    console.log(
      `   Total Steps: ${baselineVague.flows.reduce((sum, f) => sum + f.steps.length, 0)}\n`,
    );

    const startClassifyVague = Date.now();
    const domainVague = await classifyUseCaseDomain(
      baselineVague,
      gemini,
      "hybrid",
    );
    const vagueClassifyTime = Date.now() - startClassifyVague;

    console.log(`✅ Domain classified in ${vagueClassifyTime}ms`);
    console.log(`   Dominant Domain: ${domainVague.dominantDomain}`);
    console.log(
      `   Confidence: ${(domainVague.overallConfidence * 100).toFixed(1)}%`,
    );
    console.log(
      `   Actors Classified: ${domainVague.actorClassifications.length}/${baselineVague.actors.length}`,
    );
    console.log(
      `   Flows Classified: ${domainVague.flowClassifications.length}\n`,
    );

    // ========================================
    // SCENARIO B: DETAILED INPUT
    // ========================================
    console.log("📝 SCENARIO B: Detailed Input");
    console.log("─────────────────────────────────────────────────────────");
    console.log(`Input: "${testCase.inputs.detailed.substring(0, 80)}..."\n`);

    const startDetailed = Date.now();
    const baselineDetailed = await generateFlatUseCase({
      description: testCase.inputs.detailed,
      geminiFunctions: gemini,
    });
    const detailedLLMTime = Date.now() - startDetailed;

    console.log(`✅ Baseline generated in ${detailedLLMTime}ms`);
    console.log(`   Name: ${baselineDetailed.name}`);
    console.log(
      `   Actors: ${baselineDetailed.actors.length} (${baselineDetailed.actors.join(", ")})`,
    );
    console.log(`   Flows: ${baselineDetailed.flows.length}`);
    console.log(
      `   Total Steps: ${baselineDetailed.flows.reduce((sum, f) => sum + f.steps.length, 0)}\n`,
    );

    const startClassifyDetailed = Date.now();
    const domainDetailed = await classifyUseCaseDomain(
      baselineDetailed,
      gemini,
      "hybrid",
    );
    const detailedClassifyTime = Date.now() - startClassifyDetailed;

    console.log(`✅ Domain classified in ${detailedClassifyTime}ms`);
    console.log(`   Dominant Domain: ${domainDetailed.dominantDomain}`);
    console.log(
      `   Confidence: ${(domainDetailed.overallConfidence * 100).toFixed(1)}%`,
    );
    console.log(
      `   Actors Classified: ${domainDetailed.actorClassifications.length}/${baselineDetailed.actors.length}`,
    );
    console.log(
      `   Flows Classified: ${domainDetailed.flowClassifications.length}\n`,
    );

    // ========================================
    // COMPARISON ANALYSIS
    // ========================================
    console.log("═══════════════════════════════════════════════════════════");
    console.log("📊 COMPARISON: Vague vs Detailed");
    console.log(
      "═══════════════════════════════════════════════════════════\n",
    );

    console.log("📈 Baseline Quality:");
    console.log("┌─────────────────────┬─────────┬──────────┬──────────┐");
    console.log("│ Metric              │ Vague   │ Detailed │ GT       │");
    console.log("├─────────────────────┼─────────┼──────────┼──────────┤");
    console.log(
      `│ Actors              │ ${String(baselineVague.actors.length).padEnd(7)} │ ${String(baselineDetailed.actors.length).padEnd(8)} │ ${String(testCase.groundTruth.actors.length).padEnd(8)} │`,
    );
    console.log(
      `│ Flows               │ ${String(baselineVague.flows.length).padEnd(7)} │ ${String(baselineDetailed.flows.length).padEnd(8)} │ ${String(testCase.groundTruth.flows.length).padEnd(8)} │`,
    );
    console.log(
      `│ Total Steps         │ ${String(baselineVague.flows.reduce((s, f) => s + f.steps.length, 0)).padEnd(7)} │ ${String(baselineDetailed.flows.reduce((s, f) => s + f.steps.length, 0)).padEnd(8)} │ ${String(testCase.groundTruth.flows.reduce((s, f) => s + f.steps.length, 0)).padEnd(8)} │`,
    );
    console.log("└─────────────────────┴─────────┴──────────┴──────────┘\n");

    console.log("🎯 Domain Classification:");
    console.log("┌─────────────────────┬─────────────┬──────────────┐");
    console.log("│ Metric              │ Vague       │ Detailed     │");
    console.log("├─────────────────────┼─────────────┼──────────────┤");
    console.log(
      `│ Domain              │ ${domainVague.dominantDomain.padEnd(11)} │ ${domainDetailed.dominantDomain.padEnd(12)} │`,
    );
    console.log(
      `│ Confidence          │ ${(domainVague.overallConfidence * 100).toFixed(1).padEnd(10)}% │ ${(domainDetailed.overallConfidence * 100).toFixed(1).padEnd(11)}% │`,
    );
    console.log(
      `│ Actors Classified   │ ${domainVague.actorClassifications.length.toString().padEnd(11)} │ ${domainDetailed.actorClassifications.length.toString().padEnd(12)} │`,
    );
    console.log(
      `│ Actor Coverage      │ ${((domainVague.actorClassifications.length / baselineVague.actors.length) * 100).toFixed(0).padEnd(10)}% │ ${((domainDetailed.actorClassifications.length / baselineDetailed.actors.length) * 100).toFixed(0).padEnd(11)}% │`,
    );
    console.log("└─────────────────────┴─────────────┴──────────────┘\n");

    console.log("⏱️  Performance:");
    console.log("┌─────────────────────┬─────────┬──────────┐");
    console.log("│ Metric              │ Vague   │ Detailed │");
    console.log("├─────────────────────┼─────────┼──────────┤");
    console.log(
      `│ LLM Generation      │ ${vagueLLMTime.toString().padEnd(6)}ms│ ${detailedLLMTime.toString().padEnd(7)}ms│`,
    );
    console.log(
      `│ Classification      │ ${vagueClassifyTime.toString().padEnd(6)}ms│ ${detailedClassifyTime.toString().padEnd(7)}ms│`,
    );
    console.log(
      `│ Total               │ ${(vagueLLMTime + vagueClassifyTime).toString().padEnd(6)}ms│ ${(detailedLLMTime + detailedClassifyTime).toString().padEnd(7)}ms│`,
    );
    console.log(
      `│ Classify Overhead   │ ${((vagueClassifyTime / vagueLLMTime) * 100).toFixed(1).padEnd(5)}% │ ${((detailedClassifyTime / detailedLLMTime) * 100).toFixed(1).padEnd(6)}% │`,
    );
    console.log("└─────────────────────┴─────────┴──────────┘\n");

    // Detailed actor analysis
    console.log("👥 Actor Classification Details:");
    console.log("─────────────────────────────────────────────────────────\n");

    console.log("VAGUE INPUT:");
    for (const actor of domainVague.actorClassifications) {
      const bar =
        "█".repeat(Math.round(actor.confidence * 10)) +
        " ".repeat(10 - Math.round(actor.confidence * 10));
      console.log(
        `  ${actor.actor.padEnd(25)} ${actor.type.padEnd(10)} [${bar}] ${(actor.confidence * 100).toFixed(0)}% (${actor.method})`,
      );
    }

    console.log("\nDETAILED INPUT:");
    for (const actor of domainDetailed.actorClassifications) {
      const bar =
        "█".repeat(Math.round(actor.confidence * 10)) +
        " ".repeat(10 - Math.round(actor.confidence * 10));
      console.log(
        `  ${actor.actor.padEnd(25)} ${actor.type.padEnd(10)} [${bar}] ${(actor.confidence * 100).toFixed(0)}% (${actor.method})`,
      );
    }

    // Method distribution comparison
    const vagueHeuristic = domainVague.actorClassifications.filter(
      (a) => a.method === "heuristic",
    ).length;
    const vagueSemantic = domainVague.actorClassifications.filter(
      (a) => a.method === "semantic",
    ).length;
    const vagueLLM = domainVague.actorClassifications.filter(
      (a) => a.method === "llm",
    ).length;

    const detailedHeuristic = domainDetailed.actorClassifications.filter(
      (a) => a.method === "heuristic",
    ).length;
    const detailedSemantic = domainDetailed.actorClassifications.filter(
      (a) => a.method === "semantic",
    ).length;
    const detailedLLM = domainDetailed.actorClassifications.filter(
      (a) => a.method === "llm",
    ).length;

    console.log("\n🔧 Classification Methods Used:");
    console.log("┌─────────────┬─────────┬──────────┐");
    console.log("│ Method      │ Vague   │ Detailed │");
    console.log("├─────────────┼─────────┼──────────┤");
    console.log(
      `│ Heuristic   │ ${vagueHeuristic.toString().padEnd(7)} │ ${detailedHeuristic.toString().padEnd(8)} │`,
    );
    console.log(
      `│ Semantic    │ ${vagueSemantic.toString().padEnd(7)} │ ${detailedSemantic.toString().padEnd(8)} │`,
    );
    console.log(
      `│ LLM         │ ${vagueLLM.toString().padEnd(7)} │ ${detailedLLM.toString().padEnd(8)} │`,
    );
    console.log("└─────────────┴─────────┴──────────┘\n");

    // Save results
    const results = {
      testCase: testCase.id,
      domain: testCase.domain,
      groundTruth: {
        actors: testCase.groundTruth.actors.length,
        flows: testCase.groundTruth.flows.length,
        expectedDomain: "human-system", // Based on Primary Actor: RA
      },
      vague: {
        input: testCase.inputs.vague,
        baseline: {
          name: baselineVague.name,
          actorCount: baselineVague.actors.length,
          actors: baselineVague.actors,
          flowCount: baselineVague.flows.length,
          totalSteps: baselineVague.flows.reduce(
            (s, f) => s + f.steps.length,
            0,
          ),
          generationTime: vagueLLMTime,
        },
        domainClassification: {
          dominantDomain: domainVague.dominantDomain,
          confidence: domainVague.overallConfidence,
          summary: domainVague.summary,
          actorsClassified: domainVague.actorClassifications.length,
          actorCoverage:
            (domainVague.actorClassifications.length /
              baselineVague.actors.length) *
            100,
          actorClassifications: domainVague.actorClassifications,
          flowClassifications: domainVague.flowClassifications,
          classificationTime: vagueClassifyTime,
        },
        performance: {
          llmTime: vagueLLMTime,
          classifyTime: vagueClassifyTime,
          totalTime: vagueLLMTime + vagueClassifyTime,
          overhead: (vagueClassifyTime / vagueLLMTime) * 100,
        },
      },
      detailed: {
        input: testCase.inputs.detailed,
        baseline: {
          name: baselineDetailed.name,
          actorCount: baselineDetailed.actors.length,
          actors: baselineDetailed.actors,
          flowCount: baselineDetailed.flows.length,
          totalSteps: baselineDetailed.flows.reduce(
            (s, f) => s + f.steps.length,
            0,
          ),
          generationTime: detailedLLMTime,
        },
        domainClassification: {
          dominantDomain: domainDetailed.dominantDomain,
          confidence: domainDetailed.overallConfidence,
          summary: domainDetailed.summary,
          actorsClassified: domainDetailed.actorClassifications.length,
          actorCoverage:
            (domainDetailed.actorClassifications.length /
              baselineDetailed.actors.length) *
            100,
          actorClassifications: domainDetailed.actorClassifications,
          flowClassifications: domainDetailed.flowClassifications,
          classificationTime: detailedClassifyTime,
        },
        performance: {
          llmTime: detailedLLMTime,
          classifyTime: detailedClassifyTime,
          totalTime: detailedLLMTime + detailedClassifyTime,
          overhead: (detailedClassifyTime / detailedLLMTime) * 100,
        },
      },
      comparison: {
        baselineQuality: {
          actorDiff:
            baselineDetailed.actors.length - baselineVague.actors.length,
          flowDiff: baselineDetailed.flows.length - baselineVague.flows.length,
        },
        domainAgreement:
          domainVague.dominantDomain === domainDetailed.dominantDomain,
        confidenceDiff:
          domainDetailed.overallConfidence - domainVague.overallConfidence,
        coverageDiff:
          domainDetailed.actorClassifications.length /
            baselineDetailed.actors.length -
          domainVague.actorClassifications.length / baselineVague.actors.length,
      },
    };

    const outputPath = join(__dirname, "results-vague-vs-detailed.json");
    await writeFile(outputPath, JSON.stringify(results, null, 2));
    console.log(`💾 Results saved to: ${outputPath}\n`);

    console.log("✅ Test completed successfully!\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    console.error(error.stack);
    throw error;
  }
}

runTest().catch(console.error);
