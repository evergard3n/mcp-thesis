import z from "zod";

export const analysisSchema = z.object({
  analysis_chain_of_thought: z.object({
    actor_comparison: z
      .string()
      .describe("Comparison of actors involved in both use cases."),
    flow_mapping: z
      .string()
      .describe("Mapping of flows between the two use cases."),
    hallucination_check: z
      .string()
      .describe(
        "Check for any unnecessary steps or information in the generated use case, that does not make much sense compared to the original use case.",
      ),
  }),
  scores: z.object({
    semantic_coverage: z
      .number()
      .min(0)
      .max(10)
      .describe("Score from 0-10 for semantic coverage of the use case."),
    entity_alignment: z
      .number()
      .min(0)
      .max(10)
      .describe(
        "Score from 0-10 for alignment of entities (actors, objects, etc.).",
      ),
    factuality: z
      .number()
      .min(0)
      .max(10)
      .describe("Score from 0-10 for factual accuracy without hallucinations."),
    structure: z
      .number()
      .min(0)
      .max(10)
      .describe("Score from 0-10 for structural quality of the use case."),
  }),
  verdict: z
    .enum(["Excellent", "Good", "Acceptable", "Poor"])
    .describe("Overall verdict of the use case quality."),
  explanation_vi: z
    .string()
    .describe(
      "Detailed explanation in Vietnamese about the scoring, pointing out specific errors if any.",
    ),
});
