#!/usr/bin/env node

/**
 * Question budget diagnostic test.
 * Runs a single HITL loop on a given dataset (default: MO1)
 * and reports per-iteration question count, stop reason, and budget details.
 *
 * Usage:
 *   node test-scripts/test-question-budget.js [DATASET_ID]
 *   e.g. node test-scripts/test-question-budget.js ec-5-extrahard
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "../.env") });

const DATASET_ID = process.argv[2] || "MO1";
const MAX_QUESTIONS = 20;
const MAX_ITERATIONS = 5;

async function run() {
  console.log(`\n🔬 Question Budget Diagnostic — dataset: ${DATASET_ID}`);
  console.log(`   Budget: MAX_QUESTIONS=${MAX_QUESTIONS}, MAX_ITERATIONS=${MAX_ITERATIONS}, per-iteration cap=6\n`);

  const datasetPath = join(__dirname, `../test-data/dataset-${DATASET_ID}.json`);
  const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
  const tc = dataset.testCases[0];

  const {
    generateFlatUseCase,
    refineWithHybridAnswers,
  } = await import("../build/services/usecase.service.js");
  const { collectStepEmbeddings, analyzeGaps } = await import("../build/analyzers/gap.analyzer.js");
  const { rankAllUncertainties } = await import("../build/analyzers/uncertainty.ranker.js");
  const { detectActivatedBlueprints } = await import("../build/analyzers/blueprint.detector.js");
  const {
    generateAdaptiveQuestions,
    expertAnswerOpenEndedQuestions,
    probeBlueprintsWithExpert,
  } = await import("../build/validators/llm.validator.js");
  const { validateUseCaseWithFeedback } = await import("../build/validators/flat.validator.js");
  const { classifyUseCaseDomain } = await import("../build/services/domain-classifier.service.js");
  const { GeminiOpenRouterFunctions } = await import("../build/services/gemini-openrouter.service.js");

  const gemini = new GeminiOpenRouterFunctions(
    process.env.GEMINI_API_KEY || "",
    process.env.OPENROUTER_API_KEY || "",
  );

  console.log(`📝 Generating baseline...`);
  const baseline = await generateFlatUseCase({ description: tc.inputs.vague, geminiFunctions: gemini });
  console.log(`   → ${baseline.flows.length} flows, actors: ${baseline.actors.join(", ")}\n`);

  const baselineFlowIds = new Set(baseline.flows.map((f) => f.id));
  let currentUseCase = JSON.parse(JSON.stringify(baseline));

  let iteration = 0;
  let totalQuestionsAsked = 0;
  const conversationHistory = [];
  const allQuestions = [];
  let blueprintsProbed = false;
  const confirmedBlueprintIds = new Set();
  const droppedBlueprintIds = new Set();

  let stopReason = "max_iterations";

  while (iteration < MAX_ITERATIONS && totalQuestionsAsked < MAX_QUESTIONS) {
    iteration++;
    console.log(`${"─".repeat(70)}`);
    console.log(`🔁 ITERATION ${iteration}`);

    // Blueprint probing (once)
    if (!blueprintsProbed) {
      const stepEmbeddings = await collectStepEmbeddings(currentUseCase);
      const domainAnalysis = await classifyUseCaseDomain(currentUseCase);
      const domainFilter =
        domainAnalysis.dominantDomain === "system-system"
          ? "system-system"
          : "human-system";

      console.log(`   Domain: ${domainAnalysis.dominantDomain} (confidence: ${(domainAnalysis.overallConfidence * 100).toFixed(0)}%), domainFilter=${domainFilter}`);

      const activations = await detectActivatedBlueprints(stepEmbeddings, domainFilter);
      console.log(`   Activated blueprints (${activations.length}): ${activations.map(a => `${a.blueprintId}(${(a.confidence * 100).toFixed(0)}%)`).join(", ")}`);

      const confirmed = await probeBlueprintsWithExpert(
        activations,
        tc.inputs.detailed,
        tc.domain,
        gemini,
      );
      confirmed.forEach((id) => confirmedBlueprintIds.add(id));
      activations
        .filter((a) => !confirmedBlueprintIds.has(a.blueprintId))
        .forEach((a) => droppedBlueprintIds.add(a.blueprintId));

      console.log(`   ✅ Confirmed: [${confirmed.join(", ")}]`);
      console.log(`   ❌ Dropped:   [${Array.from(droppedBlueprintIds).join(", ")}]`);
      blueprintsProbed = true;
    }

    // Gap + uncertainty analysis
    const validation = await validateUseCaseWithFeedback(currentUseCase);
    const gapAnalysis = await analyzeGaps(
      currentUseCase,
      validation.score,
      tc.inputs.vague,
      conversationHistory,
      confirmedBlueprintIds,
      droppedBlueprintIds,
    );
    const uncertaintyAnalysis = rankAllUncertainties(currentUseCase, validation.score, gapAnalysis);

    console.log(`   Gaps found: ${gapAnalysis.gaps.length}, overallConfidence: ${(uncertaintyAnalysis.overallConfidence * 100).toFixed(0)}%, highPriority: ${uncertaintyAnalysis.highPriorityCount}`);

    // Early stop check
    if (uncertaintyAnalysis.overallConfidence > 0.85 && uncertaintyAnalysis.highPriorityCount === 0) {
      stopReason = `confidence_threshold (confidence=${(uncertaintyAnalysis.overallConfidence * 100).toFixed(0)}%)`;
      console.log(`   ⚠️  EARLY STOP: confidence > 0.85 and highPriority == 0`);
      break;
    }

    // Question generation
    const remainingBudget = MAX_QUESTIONS - totalQuestionsAsked;
    const isFirstIteration = iteration === 1;
    const hasBlueprintsToExplore = confirmedBlueprintIds.size > 0;
    const questions = await generateAdaptiveQuestions(
      uncertaintyAnalysis.stepPriorities,
      uncertaintyAnalysis.flowUncertainties,
      Math.min(6, remainingBudget),
      allQuestions,
      isFirstIteration && hasBlueprintsToExplore,
      confirmedBlueprintIds.size,
      baselineFlowIds,
    );

    console.log(`   Questions generated: ${questions.length} (requested: ${Math.min(6, remainingBudget)}, remaining budget: ${remainingBudget})`);

    if (questions.length === 0) {
      stopReason = "no_questions_generated";
      console.log(`   ⚠️  EARLY STOP: no questions generated`);
      break;
    }

    // Print each question
    questions.forEach((q, i) => {
      const prefix = q.id.includes("blueprint") ? "[BP]" : "[GAP]";
      console.log(`     ${i + 1}. ${prefix} ${q.question.substring(0, 100)}${q.question.length > 100 ? "..." : ""}`);
    });

    // Get expert answers
    const answers = await expertAnswerOpenEndedQuestions(
      questions,
      tc.inputs.detailed,
      tc.domain,
      gemini,
    );

    const lowConfidenceCount = answers.filter((a) => a.confidence === "low").length;
    console.log(`   Answers: ${answers.length} (low-confidence: ${lowConfidenceCount})`);

    answers.forEach((a, i) => {
      const wordCount = a.answer.trim().split(/\s+/).length;
      console.log(`     ${i + 1}. [${a.confidence}] "${a.answer.substring(0, 80)}${a.answer.length > 80 ? "..." : ""}" (${wordCount} words)`);
    });

    // Refine
    currentUseCase = await refineWithHybridAnswers(
      tc.inputs.vague,
      currentUseCase,
      [],
      [],
      answers,
      gemini,
    );

    totalQuestionsAsked += questions.length;
    allQuestions.push(...questions.map((q) => q.question));

    console.log(`   Running total: ${totalQuestionsAsked}/${MAX_QUESTIONS} questions used`);
    console.log(`   Use case now has ${currentUseCase.flows.length} flows`);
  }

  if (stopReason === "max_iterations" && iteration >= MAX_ITERATIONS) {
    stopReason = `max_iterations (${MAX_ITERATIONS})`;
  } else if (stopReason === "max_iterations" && totalQuestionsAsked >= MAX_QUESTIONS) {
    stopReason = `max_questions (${MAX_QUESTIONS})`;
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`📊 SUMMARY`);
  console.log(`${"═".repeat(70)}`);
  console.log(`   Total iterations run:     ${iteration}`);
  console.log(`   Total questions asked:    ${totalQuestionsAsked} / ${MAX_QUESTIONS}`);
  console.log(`   Final flow count:         ${currentUseCase.flows.length}`);
  console.log(`   GT flow count:            ${tc.groundTruth?.flows?.length ?? "N/A"}`);
  console.log(`   Stop reason:              ${stopReason}`);
  console.log(`   Confirmed blueprints:     [${Array.from(confirmedBlueprintIds).join(", ")}]`);
  console.log(`   Dropped blueprints:       [${Array.from(droppedBlueprintIds).join(", ")}]`);
}

run().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
