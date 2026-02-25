#!/usr/bin/env node

/**
 * Simple domain classification test - just baseline + classification
 * No detailed input comparison to speed up testing
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
  console.log("🧪 Simple Domain Classification Test\n");

  try {
    // Read MO1 dataset
    const datasetPath = join(__dirname, "../test-data/dataset-MO1.json");
    const datasetContent = await readFile(datasetPath, "utf-8");
    const dataset = JSON.parse(datasetContent);

    console.log(
      `📂 Dataset: ${dataset.testCases[0].id} - ${dataset.testCases[0].domain}`,
    );
    const vagueInput =
      dataset.testCases[0].inputs?.vague ||
      dataset.testCases[0].vagueSummary ||
      "";
    console.log(`   Vague input: "${vagueInput.substring(0, 70)}..."\n`);

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

    // Step 2: Classify domain
    console.log("🎯 Classifying domain (hybrid method)...");
    const startClassify = Date.now();
    const domainResult = await classifyUseCaseDomain(
      baseline,
      gemini,
      "hybrid",
    );
    const classifyTime = Date.now() - startClassify;

    console.log(`✅ Classification completed in ${classifyTime}ms\n`);

    // Display results
    console.log("═══════════════════════════════════════════════════════════");
    console.log("📊 DOMAIN CLASSIFICATION RESULTS");
    console.log(
      "═══════════════════════════════════════════════════════════\n",
    );

    console.log(`🎯 Dominant Domain: ${domainResult.dominantDomain}`);
    console.log(
      `📈 Overall Confidence: ${(domainResult.overallConfidence * 100).toFixed(1)}%`,
    );
    console.log(`📝 Summary: ${domainResult.summary}\n`);

    console.log("👥 Actor Classifications:");
    console.log("─────────────────────────────────────────────────────────");
    for (const actor of domainResult.actorClassifications || []) {
      const bar =
        "█".repeat(Math.round(actor.confidence * 10)) +
        " ".repeat(10 - Math.round(actor.confidence * 10));
      const method =
        actor.method === "heuristic"
          ? "heuristic"
          : actor.method === "semantic"
            ? "semantic"
            : "llm";
      console.log(
        `  ${actor.actor.padEnd(25)} ${actor.type.padEnd(10)} [${bar}] ${(actor.confidence * 100).toFixed(0)}% (${method})`,
      );
    }

    console.log("\n🔄 Flow Classifications:");
    console.log("─────────────────────────────────────────────────────────");
    for (const flow of domainResult.flowClassifications || []) {
      const humanActors = flow.actorTypes.filter(
        (a) => a.type === "human",
      ).length;
      const systemActors = flow.actorTypes.filter(
        (a) => a.type === "system",
      ).length;
      console.log(
        `  ${flow.flowId.padEnd(10)} → ${flow.domainType.padEnd(16)} (${(flow.confidence * 100).toFixed(0)}%)`,
      );
      console.log(
        `  └─ Flow has ${humanActors} human actor(s) and ${systemActors} system actor(s)`,
      );
    }

    // Performance summary
    console.log("\n⏱️  Performance Summary:");
    console.log("─────────────────────────────────────────────────────────");
    console.log(`  Baseline Generation: ${baselineTime}ms`);
    console.log(`  Domain Classification: ${classifyTime}ms`);
    console.log(`  Total Time: ${baselineTime + classifyTime}ms`);

    // Method distribution
    const heuristicCount = (domainResult.actorClassifications || []).filter(
      (a) => a.method === "heuristic",
    ).length;
    const semanticCount = (domainResult.actorClassifications || []).filter(
      (a) => a.method === "semantic",
    ).length;
    const llmCount = (domainResult.actorClassifications || []).filter(
      (a) => a.method === "llm",
    ).length;
    const totalActors = domainResult.actorClassifications?.length || 1;
    console.log(`\n  Classification Methods Used:`);
    console.log(
      `    Heuristic: ${heuristicCount} actors (${((heuristicCount / totalActors) * 100).toFixed(0)}%)`,
    );
    console.log(
      `    Semantic:  ${semanticCount} actors (${((semanticCount / totalActors) * 100).toFixed(0)}%)`,
    );
    console.log(
      `    LLM:       ${llmCount} actors (${((llmCount / totalActors) * 100).toFixed(0)}%)`,
    );

    // Save results
    const results = {
      testCase: dataset.testCases[0].id,
      domain: dataset.testCases[0].domain,
      baseline: {
        name: baseline.name,
        actors: baseline.actors,
        flowCount: baseline.flows.length,
        generationTime: baselineTime,
      },
      domainClassification: {
        dominantDomain: domainResult.dominantDomain,
        overallConfidence: domainResult.overallConfidence,
        summary: domainResult.summary,
        actorClassifications: domainResult.actorClassifications,
        flowClassifications: domainResult.flowClassifications,
        classificationTime: classifyTime,
      },
      performance: {
        baselineTime,
        classifyTime,
        totalTime: baselineTime + classifyTime,
        methodDistribution: {
          heuristic: heuristicCount,
          semantic: semanticCount,
          llm: llmCount,
        },
      },
    };

    const outputPath = join(__dirname, "results-domain-simple.json");
    await writeFile(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to: ${outputPath}`);

    console.log("\n✅ Test completed successfully!");
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    throw error;
  }
}

runTest().catch(console.error);
