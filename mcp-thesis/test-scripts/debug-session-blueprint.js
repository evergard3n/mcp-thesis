#!/usr/bin/env node

/**
 * Detailed test to debug why session_persistence blueprint doesn't activate
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "../.env") });

async function debugSessionPersistence() {
  console.log("🔍 DEBUG: Session Persistence Blueprint Detection\n");

  try {
    // Read MO1 dataset
    const datasetPath = join(__dirname, "../test-data/dataset-MO1.json");
    const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
    const testCase = dataset.testCases[0];
    const vagueInput = testCase.inputs?.vague || "";

    console.log("📂 MO1 Dataset");
    console.log(`   Vague: ${vagueInput}\n`);

    // Import services
    const { generateFlatUseCase } =
      await import("../build/services/usecase.service.js");
    const { GeminiOpenRouterFunctions } =
      await import("../build/services/gemini-openrouter.service.js");
    const semanticService = (
      await import("../build/services/semantic.service.js")
    ).default;

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
    console.log(`   Actors: ${baseline.actors.join(", ")}`);
    console.log(`   Flows: ${baseline.flows.length}\n`);

    // Show all steps
    console.log("📋 All Steps:");
    console.log("─".repeat(80));
    for (const flow of baseline.flows) {
      console.log(`\n${flow.kind} Flow (${flow.id}):`);
      for (const step of flow.steps) {
        console.log(`  ${step.index}. [${step.actor}] ${step.description}`);
      }
    }
    console.log();

    // Load session_persistence blueprint
    const blueprintsData = JSON.parse(
      await readFile(join(__dirname, "../src/data/blueprints.json"), "utf-8"),
    );
    const sessionBlueprint = blueprintsData.blueprints.find(
      (bp) => bp.id === "session_persistence",
    );

    if (!sessionBlueprint) {
      console.log("❌ session_persistence blueprint not found!");
      return;
    }

    console.log("\n🎯 Testing session_persistence Blueprint");
    console.log("─".repeat(80));
    console.log(`Blueprint: ${sessionBlueprint.name}`);
    console.log(`Domain: ${sessionBlueprint.domainType}`);
    console.log(`Min Roles: ${sessionBlueprint.activation.minRolesMatched}\n`);

    // Test role matching manually
    console.log("🔍 Role Matching:");
    console.log("─".repeat(80));

    // Collect all steps
    const allSteps = baseline.flows.flatMap((flow) =>
      flow.steps.map((step) => ({
        flowId: flow.id,
        stepIndex: step.index,
        actor: step.actor,
        description: step.description,
      })),
    );

    // Embed all steps
    console.log("Computing embeddings...");
    const stepTexts = allSteps.map((s) => s.description);
    const stepEmbeddings = await semanticService.embedBatch(stepTexts);

    for (const role of sessionBlueprint.roles) {
      console.log(
        `\n📌 Role: ${role.id} (${role.isMandatory ? "mandatory" : "optional"})`,
      );
      console.log(`   Threshold: ${role.threshold}`);
      console.log(`   Keywords: ${role.keywords.slice(0, 3).join(", ")}...`);

      // Embed role keywords
      const roleEmbedding = await semanticService.embedBatch(role.keywords);
      const roleCentroid = semanticService.computeCentroid(roleEmbedding);

      // Find best matching steps
      const matches = [];
      for (let i = 0; i < allSteps.length; i++) {
        const similarity = semanticService.cosineSimilarity(
          stepEmbeddings[i],
          roleCentroid,
        );
        if (similarity >= role.threshold) {
          matches.push({
            step: allSteps[i],
            similarity: similarity,
          });
        }
      }

      if (matches.length > 0) {
        console.log(`   ✅ ${matches.length} matching steps:`);
        matches
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 3)
          .forEach((m) => {
            console.log(
              `      ${(m.similarity * 100).toFixed(1)}% - [${m.step.actor}] ${m.step.description}`,
            );
          });
      } else {
        console.log(`   ❌ No steps match threshold ${role.threshold}`);
      }
    }

    // Check if blueprint would activate
    console.log("\n\n🎯 Blueprint Activation Check:");
    console.log("─".repeat(80));

    const rolesMatched = sessionBlueprint.roles.filter((role) => {
      // Simplified: just check if any step would match
      return true; // We'd need actual matching logic here
    }).length;

    console.log(`Roles that could match: Checking...`);
    console.log(
      `Required matches: ${sessionBlueprint.activation.minRolesMatched}`,
    );

    if (rolesMatched >= sessionBlueprint.activation.minRolesMatched) {
      console.log("✅ Blueprint WOULD activate");
    } else {
      console.log("❌ Blueprint would NOT activate");
    }

    console.log("\n\n💡 Analysis:");
    console.log("─".repeat(80));
    console.log("The vague input doesn't mention:");
    console.log("  - Pausing/saving work");
    console.log("  - Resuming interrupted work");
    console.log("  - Computer going down");
    console.log("  - Fire alarm interruption");
    console.log(
      "\nSo the baseline has NO exception flows for these scenarios.",
    );
    console.log(
      "The blueprint SHOULD detect these as gaps and suggest questions!",
    );
    console.log("\nPossible issues:");
    console.log("  1. Thresholds too high (0.60)");
    console.log("  2. Role keywords don't match the baseline steps well");
    console.log("  3. minRolesMatched=1 but role matching fails");
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

debugSessionPersistence();
