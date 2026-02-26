#!/usr/bin/env node

/**
 * Debug why CC4 (system-system) doesn't activate any blueprints
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "../.env") });

async function debugCC4() {
  console.log("🔍 DEBUG: Why CC4 Doesn't Activate System-System Blueprints\n");

  try {
    // Read CC4 dataset
    const datasetPath = join(__dirname, "../test-data/dataset-CC4.json");
    const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
    const testCase = dataset.testCases[0];
    const vagueInput = testCase.inputs.vague;

    console.log("📂 CC4 Dataset");
    console.log(`   Domain: ${testCase.domain}`);
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

    // Load system-system blueprints
    const blueprintsData = JSON.parse(
      await readFile(join(__dirname, "../src/data/blueprints.json"), "utf-8"),
    );
    const systemBlueprints = blueprintsData.blueprints.filter(
      (bp) => bp.domainType === "system-system",
    );

    console.log("\n🎯 System-System Blueprints Available:");
    console.log("─".repeat(80));
    systemBlueprints.forEach((bp) => {
      console.log(`\n📌 ${bp.id} (${bp.name})`);
      console.log(`   Min roles: ${bp.activation.minRolesMatched}`);
      console.log(`   Roles: ${bp.roles.map((r) => r.id).join(", ")}`);
    });

    // Test each blueprint manually
    console.log("\n\n🔍 Testing Each Blueprint:");
    console.log("═".repeat(80));

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

    for (const blueprint of systemBlueprints) {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`Blueprint: ${blueprint.id}`);
      console.log(`${"=".repeat(80)}`);

      let rolesMatched = 0;

      for (const role of blueprint.roles) {
        console.log(
          `\n📌 Role: ${role.id} (${role.isMandatory ? "mandatory" : "optional"})`,
        );
        console.log(`   Threshold: ${role.threshold}`);
        console.log(`   Keywords: ${role.keywords.slice(0, 3).join(", ")}...`);

        // Embed role keywords
        const roleEmbedding = await semanticService.embedBatch(role.keywords);
        const roleCentroid =
          await semanticService.computeCentroid(roleEmbedding);

        // Find best matching steps
        const matches = [];
        for (let i = 0; i < allSteps.length; i++) {
          const similarity = await semanticService.cosineSimilarity(
            stepEmbeddings[i],
            roleCentroid,
          );
          matches.push({
            step: allSteps[i],
            similarity: similarity,
          });
        }

        // Sort and show top 3
        matches.sort((a, b) => b.similarity - a.similarity);
        console.log(`   Top 3 matches:`);
        matches.slice(0, 3).forEach((m) => {
          const pass = m.similarity >= role.threshold ? "✅" : "❌";
          console.log(
            `      ${pass} ${(m.similarity * 100).toFixed(1)}% - [${m.step.actor}] ${m.step.description.substring(0, 60)}...`,
          );
        });

        if (matches[0].similarity >= role.threshold) {
          rolesMatched++;
          console.log(`   ✅ Role matched!`);
        } else {
          console.log(
            `   ❌ Role NOT matched (best: ${(matches[0].similarity * 100).toFixed(1)}%)`,
          );
        }
      }

      console.log(
        `\n📊 Result: ${rolesMatched}/${blueprint.roles.length} roles matched`,
      );
      console.log(`   Required: ${blueprint.activation.minRolesMatched} roles`);

      if (rolesMatched >= blueprint.activation.minRolesMatched) {
        console.log(`   ✅ Blueprint WOULD activate`);
      } else {
        console.log(`   ❌ Blueprint would NOT activate`);
      }
    }

    console.log("\n\n" + "═".repeat(80));
    console.log("💡 Analysis:");
    console.log("═".repeat(80));
    console.log("\nCC4 Use Case Characteristics:");
    console.log("  - Resource locking/concurrency control");
    console.log("  - System component: Resource Lock");
    console.log("  - Checks and grants access");
    console.log("  - Increments lock counts");
    console.log();
    console.log("Current System-System Blueprints:");
    console.log("  1. api_integration: API calls, requests, responses");
    console.log("  2. data_synchronization: Data replication, conflicts");
    console.log("  3. event_driven: Events, subscribers, message queues");
    console.log("  4. batch_processing: Batch jobs, bulk operations");
    console.log();
    console.log("Gap: NO blueprint for resource management patterns!");
    console.log("  - Lock acquisition/release");
    console.log("  - Concurrency control");
    console.log("  - Resource contention");
    console.log("  - Deadlock scenarios");
    console.log();
    console.log(
      "Recommendation: Add 'resource_locking' blueprint for system-system",
    );
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

debugCC4();
