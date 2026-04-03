import {
  GenUseCase,
  GenFlow,
  GenStep,
} from "../interfaces/usecase.interface.new.js";
import { GeminiOpenRouterFunctions } from "./gemini-openrouter.service.js";
import semanticService from "./semantic.service.js";
import { z } from "zod";
import {
  HUMAN_KEYWORDS,
  SYSTEM_KEYWORDS,
  HUMAN_ACTION_KEYWORDS,
  SYSTEM_ACTION_KEYWORDS,
} from "../data/domain-keywords.js";

export type DomainType = "human-system" | "system-system" | "ambiguous";
export type ActorType = "human" | "system" | "ambiguous";

export interface ActorClassification {
  actor: string;
  type: ActorType;
  confidence: number;
  method: "heuristic" | "semantic" | "llm" | "hybrid";
}

export interface FlowDomainClassification {
  flowId: string;
  domainType: DomainType;
  confidence: number; // 0-1
  reasoning: string;
  actorTypes: Array<{
    actor: string;
    type: ActorType;
  }>;
  method?: "heuristic" | "semantic" | "llm" | "hybrid";
}

export interface UseCaseDomainAnalysis {
  dominantDomain: DomainType;
  flowClassifications: FlowDomainClassification[];
  overallConfidence: number;
  summary: string;
  actorClassifications?: ActorClassification[];
}

// ============================================================================
// PHASE 2: HEURISTIC DETECTOR (Rule-Based)
// ============================================================================

/**
 * Phase 2: Heuristic-based actor type detection
 * Fast, rule-based classification using keyword matching
 * Prioritizes compound keywords (multi-word) over single keywords
 */
function classifyActorHeuristic(
  actor: string,
  description?: string,
): ActorClassification {
  const actorLower = actor.toLowerCase().trim();
  const descLower = description?.toLowerCase() || "";
  const combined = `${actorLower} ${descLower}`;

  // Separate compound (multi-word) and single keywords
  const humanCompound = HUMAN_KEYWORDS.filter((kw) => kw.includes(" "));
  const humanSingle = HUMAN_KEYWORDS.filter((kw) => !kw.includes(" "));
  const systemCompound = SYSTEM_KEYWORDS.filter((kw) => kw.includes(" "));
  const systemSingle = SYSTEM_KEYWORDS.filter((kw) => !kw.includes(" "));

  // Check compound keywords first (higher priority)
  const hasHumanCompound = humanCompound.some((kw) => actorLower.includes(kw));
  const hasSystemCompound = systemCompound.some((kw) =>
    actorLower.includes(kw),
  );

  // If compound keyword matches, give strong signal
  if (hasHumanCompound && !hasSystemCompound) {
    return {
      actor,
      type: "human",
      confidence: 0.9,
      method: "heuristic",
    };
  }
  if (hasSystemCompound && !hasHumanCompound) {
    return {
      actor,
      type: "system",
      confidence: 0.9,
      method: "heuristic",
    };
  }

  // Fall back to single keyword matching
  const hasHumanKeyword = humanSingle.some((kw) => actorLower.includes(kw));
  const hasSystemKeyword = systemSingle.some((kw) => actorLower.includes(kw));

  // Check description against action keywords
  const hasHumanAction = HUMAN_ACTION_KEYWORDS.some((kw) =>
    descLower.includes(kw),
  );
  const hasSystemAction = SYSTEM_ACTION_KEYWORDS.some((kw) =>
    descLower.includes(kw),
  );

  // Scoring
  let humanScore = 0;
  let systemScore = 0;

  if (hasHumanKeyword) humanScore += 0.6;
  if (hasSystemKeyword) systemScore += 0.6;
  if (hasHumanAction) humanScore += 0.4;
  if (hasSystemAction) systemScore += 0.4;

  // Decision logic
  if (humanScore > systemScore && humanScore >= 0.6) {
    return {
      actor,
      type: "human",
      confidence: Math.min(humanScore, 1.0),
      method: "heuristic",
    };
  } else if (systemScore > humanScore && systemScore >= 0.6) {
    return {
      actor,
      type: "system",
      confidence: Math.min(systemScore, 1.0),
      method: "heuristic",
    };
  } else {
    return {
      actor,
      type: "ambiguous",
      confidence: 0.5 - Math.abs(humanScore - systemScore),
      method: "heuristic",
    };
  }
}

// ============================================================================
// PHASE 3: SEMANTIC CLASSIFIER (Embedding-Based)
// ============================================================================

let humanActorCentroid: number[] | null = null;
let systemActorCentroid: number[] | null = null;
let humanActionCentroid: number[] | null = null;
let systemActionCentroid: number[] | null = null;

/**
 * Phase 3: Initialize semantic centroids for actor/action classification
 * Training data based on common use case patterns
 */
async function initializeSemanticCentroids(): Promise<void> {
  if (humanActorCentroid && systemActorCentroid) {
    return; // Already initialized
  }

  console.log("Initializing semantic centroids for domain classification...");

  // Human actor patterns
  const humanActorExamples = [
    "user clicks button to submit",
    "customer fills in registration form",
    "manager reviews and approves request",
    "clerk enters data into system",
    "administrator configures settings",
    "agent handles customer inquiry",
    "employee creates new record",
    "operator monitors the dashboard",
  ];

  // System actor patterns
  const systemActorExamples = [
    "system validates input data",
    "API sends response to client",
    "database stores transaction record",
    "service processes payment request",
    "server authenticates credentials",
    "gateway routes message to queue",
    "scheduler triggers batch job",
    "engine calculates risk score",
  ];

  // Human action patterns
  const humanActionExamples = [
    "fills form with personal information",
    "reviews document for approval",
    "selects option from dropdown",
    "decides whether to proceed",
    "manually enters invoice details",
    "reads notification message",
    "confirms order placement",
  ];

  // System action patterns
  const systemActionExamples = [
    "validates format automatically",
    "processes request asynchronously",
    "stores data in database",
    "retrieves configuration from cache",
    "sends notification email",
    "triggers workflow execution",
    "calculates total amount",
  ];

  try {
    const [
      humanActorEmbeddings,
      systemActorEmbeddings,
      humanActionEmbeddings,
      systemActionEmbeddings,
    ] = await Promise.all([
      semanticService.embedBatch(humanActorExamples),
      semanticService.embedBatch(systemActorExamples),
      semanticService.embedBatch(humanActionExamples),
      semanticService.embedBatch(systemActionExamples),
    ]);

    humanActorCentroid =
      await semanticService.computeCentroid(humanActorEmbeddings);
    systemActorCentroid = await semanticService.computeCentroid(
      systemActorEmbeddings,
    );
    humanActionCentroid = await semanticService.computeCentroid(
      humanActionEmbeddings,
    );
    systemActionCentroid = await semanticService.computeCentroid(
      systemActionEmbeddings,
    );

    console.log("Semantic centroids initialized successfully");
  } catch (error) {
    console.error("Failed to initialize semantic centroids:", error);
    throw error;
  }
}

/**
 * Phase 3: Semantic-based actor type detection using embeddings
 * More robust than heuristics, handles synonyms and paraphrases
 */
async function classifyActorSemantic(
  actor: string,
  description?: string,
): Promise<ActorClassification> {
  await initializeSemanticCentroids();

  if (
    !humanActorCentroid ||
    !systemActorCentroid ||
    !humanActionCentroid ||
    !systemActionCentroid
  ) {
    throw new Error("Semantic centroids not initialized");
  }

  // Embed actor + description
  const text = description ? `${actor} ${description}` : actor;
  const [embedding] = await semanticService.embedBatch([text]);

  // Compare with actor centroids
  const humanActorSim = await semanticService.cosineSimilarity(
    embedding,
    humanActorCentroid,
  );
  const systemActorSim = await semanticService.cosineSimilarity(
    embedding,
    systemActorCentroid,
  );

  // Compare with action centroids if description exists
  let humanActionSim = 0;
  let systemActionSim = 0;
  if (description) {
    humanActionSim = await semanticService.cosineSimilarity(
      embedding,
      humanActionCentroid,
    );
    systemActionSim = await semanticService.cosineSimilarity(
      embedding,
      systemActionCentroid,
    );
  }

  // Weighted scoring (actor name more important than actions)
  const humanScore = humanActorSim * 0.7 + humanActionSim * 0.3;
  const systemScore = systemActorSim * 0.7 + systemActionSim * 0.3;

  const maxScore = Math.max(humanScore, systemScore);
  const confidence = maxScore;

  // Threshold for confident classification
  const CONFIDENCE_THRESHOLD = 0.5;

  if (humanScore > systemScore && confidence >= CONFIDENCE_THRESHOLD) {
    return {
      actor,
      type: "human",
      confidence,
      method: "semantic",
    };
  } else if (systemScore > humanScore && confidence >= CONFIDENCE_THRESHOLD) {
    return {
      actor,
      type: "system",
      confidence,
      method: "semantic",
    };
  } else {
    return {
      actor,
      type: "ambiguous",
      confidence: 0.5,
      method: "semantic",
    };
  }
}

// ============================================================================
// HYBRID APPROACH: Combine Heuristic + Semantic
// ============================================================================

/**
 * Hybrid actor classification: Use heuristic first, fall back to semantic for ambiguous cases
 * Best of both worlds: fast heuristics + robust semantic matching
 *
 * FIX: Handle actors without steps (declared but don't appear in flows)
 */
async function classifyActorHybrid(
  actor: string,
  steps: GenStep[],
): Promise<ActorClassification> {
  // FIX: Handle edge case - actor declared but doesn't appear in any step
  if (steps.length === 0) {
    console.log(`    Classifying "${actor}" by name only (no steps)`);
    // Classify by actor name only, no action context
    const heuristicResult = classifyActorHeuristic(actor, "");

    // If heuristic confident, use it
    if (heuristicResult.confidence >= 0.6) {
      return { ...heuristicResult, method: "hybrid" as const };
    }

    // Otherwise try semantic with just the actor name
    try {
      const semanticResult = await classifyActorSemantic(actor, "");
      return { ...semanticResult, method: "hybrid" as const };
    } catch (error) {
      // Last resort: mark as ambiguous with low confidence
      return {
        actor,
        type: "ambiguous",
        confidence: 0.3,
        method: "hybrid" as const,
      };
    }
  }

  // Original logic for actors with steps
  // Phase 1: Try heuristic first (fast)
  const actorSteps = steps.filter((s) => s.actor === actor);
  const descriptions = actorSteps.map((s) => s.description).join(" ");

  const heuristicResult = classifyActorHeuristic(actor, descriptions);

  // If heuristic is confident, use it
  if (heuristicResult.confidence >= 0.7) {
    return heuristicResult;
  }

  // Phase 2: Fall back to semantic for ambiguous cases
  try {
    const semanticResult = await classifyActorSemantic(actor, descriptions);

    // If semantic is more confident, use it
    if (semanticResult.confidence > heuristicResult.confidence) {
      return { ...semanticResult, method: "hybrid" as const };
    }

    // Otherwise stick with heuristic
    return { ...heuristicResult, method: "hybrid" as const };
  } catch (error) {
    console.warn("Semantic classification failed, using heuristic:", error);
    return heuristicResult;
  }
}

/**
 * Classify all actors in a flow
 */
async function classifyFlowActors(
  flow: GenFlow,
): Promise<ActorClassification[]> {
  const uniqueActors = Array.from(new Set(flow.steps.map((s) => s.actor)));

  const classifications = await Promise.all(
    uniqueActors.map((actor) => classifyActorHybrid(actor, flow.steps)),
  );

  return classifications;
}

/**
 * Determine flow domain based on actor classifications
 */
function determineFlowDomain(actorClassifications: ActorClassification[]): {
  domainType: DomainType;
  confidence: number;
  reasoning: string;
} {
  const humanCount = actorClassifications.filter(
    (a) => a.type === "human",
  ).length;
  const systemCount = actorClassifications.filter(
    (a) => a.type === "system",
  ).length;
  const ambiguousCount = actorClassifications.filter(
    (a) => a.type === "ambiguous",
  ).length;

  const avgConfidence =
    actorClassifications.reduce((sum, a) => sum + a.confidence, 0) /
    actorClassifications.length;

  // Decision logic
  if (humanCount > 0 && systemCount === 0) {
    return {
      domainType: "human-system",
      confidence: avgConfidence,
      reasoning: `Flow has ${humanCount} human actor(s) interacting with systems`,
    };
  } else if (systemCount > 0 && humanCount === 0 && ambiguousCount === 0) {
    return {
      domainType: "system-system",
      confidence: avgConfidence,
      reasoning: `Flow has only automated system actors (${systemCount})`,
    };
  } else if (humanCount > 0 && systemCount > 0) {
    return {
      domainType: "human-system",
      confidence: avgConfidence * 0.9, // Slightly lower confidence for mixed
      reasoning: `Flow has both human (${humanCount}) and system (${systemCount}) actors`,
    };
  } else {
    return {
      domainType: "ambiguous",
      confidence: Math.max(0.3, avgConfidence * 0.5),
      reasoning: `Unable to confidently classify: ${ambiguousCount} ambiguous actor(s)`,
    };
  }
}

// ============================================================================
// MAIN CLASSIFICATION FUNCTION
// ============================================================================

const DomainClassificationSchema = z.object({
  flowId: z.string(),
  domainType: z.enum(["human-system", "system-system", "ambiguous"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  actorTypes: z.array(
    z.object({
      actor: z.string(),
      type: z.enum(["human", "system", "ambiguous"]),
    }),
  ),
});

const UseCaseDomainAnalysisSchema = z.object({
  dominantDomain: z.enum(["human-system", "system-system", "ambiguous"]),
  flowClassifications: z.array(DomainClassificationSchema),
  overallConfidence: z.number().min(0).max(1),
  summary: z.string(),
});

async function classifyDeclaredActors(
  allDeclaredActors: string[],
  allSteps: GenStep[],
): Promise<ActorClassification[]> {
  console.log(`  Classifying ${allDeclaredActors.length} declared actors...`);
  const results: ActorClassification[] = [];
  for (const actorName of allDeclaredActors) {
    const actorSteps = allSteps.filter((s) => s.actor === actorName);
    if (actorSteps.length > 0) {
      results.push(await classifyActorHybrid(actorName, actorSteps));
    } else {
      console.log(
        `    Warning: Actor "${actorName}" declared but not in any step, classifying by name only`,
      );
      results.push(await classifyActorHybrid(actorName, []));
    }
  }
  return results;
}

function classifyFlows(
  flows: GenFlow[],
  allActorClassifications: ActorClassification[],
): FlowDomainClassification[] {
  return flows.map((flow) => {
    const flowActorNames = Array.from(new Set(flow.steps.map((s) => s.actor)));
    const flowActorClassifications = allActorClassifications.filter((ac) =>
      flowActorNames.includes(ac.actor),
    );
    const flowDomain = determineFlowDomain(flowActorClassifications);
    return {
      flowId: flow.id,
      domainType: flowDomain.domainType,
      confidence: flowDomain.confidence,
      reasoning: flowDomain.reasoning,
      actorTypes: flowActorClassifications.map((a) => ({
        actor: a.actor,
        type: a.type,
      })),
      method: "hybrid" as const,
    };
  });
}

function computeDominantDomain(
  flowClassifications: FlowDomainClassification[],
): DomainType {
  const domainCounts = {
    "human-system": flowClassifications.filter(
      (f) => f.domainType === "human-system",
    ).length,
    "system-system": flowClassifications.filter(
      (f) => f.domainType === "system-system",
    ).length,
    ambiguous: flowClassifications.filter((f) => f.domainType === "ambiguous")
      .length,
  };

  if (domainCounts["human-system"] > domainCounts["system-system"]) {
    return "human-system";
  } else if (domainCounts["system-system"] > domainCounts["human-system"]) {
    return "system-system";
  } else if (
    domainCounts["human-system"] === domainCounts["system-system"] &&
    domainCounts["human-system"] > 0
  ) {
    return "human-system";
  }
  return "ambiguous";
}

function buildSummary(
  dominantDomain: DomainType,
  flowClassifications: FlowDomainClassification[],
): string {
  const humanFlows = flowClassifications.filter(
    (f) => f.domainType === "human-system",
  ).length;
  const systemFlows = flowClassifications.filter(
    (f) => f.domainType === "system-system",
  ).length;

  if (dominantDomain === "human-system") {
    return `Human-system use case with ${humanFlows} human-initiated flow(s)${systemFlows > 0 ? ` and ${systemFlows} system-only flow(s)` : ""}`;
  } else if (dominantDomain === "system-system") {
    return `System-to-system use case with ${systemFlows} automated flow(s)`;
  }
  return `Mixed or ambiguous use case with unclear actor types`;
}

function deduplicateActorClassifications(
  allActorClassifications: ActorClassification[],
): ActorClassification[] {
  const uniqueActors = new Map<string, ActorClassification>();
  for (const ac of allActorClassifications) {
    if (
      !uniqueActors.has(ac.actor) ||
      ac.confidence > uniqueActors.get(ac.actor)!.confidence
    ) {
      uniqueActors.set(ac.actor, ac);
    }
  }
  return Array.from(uniqueActors.values());
}

export async function classifyUseCaseDomainHybrid(
  useCase: GenUseCase,
): Promise<UseCaseDomainAnalysis> {
  console.log(`Classifying domain for: ${useCase.name} (hybrid method)`);

  const allDeclaredActors = useCase.actors || [];
  const allSteps: GenStep[] = useCase.flows.flatMap((flow) => flow.steps);

  const allActorClassifications = await classifyDeclaredActors(
    allDeclaredActors,
    allSteps,
  );

  const flowClassifications = classifyFlows(
    useCase.flows,
    allActorClassifications,
  );

  const dominantDomain = computeDominantDomain(flowClassifications);

  const overallConfidence =
    flowClassifications.reduce((sum, f) => sum + f.confidence, 0) /
    flowClassifications.length;

  const summary = buildSummary(dominantDomain, flowClassifications);

  const actorClassifications = deduplicateActorClassifications(
    allActorClassifications,
  );

  return {
    dominantDomain,
    flowClassifications,
    overallConfidence,
    summary,
    actorClassifications,
  };
}

/**
 * Original LLM-based classification (kept for comparison/fallback)
 *
 * @param useCase The baseline use case to classify
 * @param geminiFunctions LLM functions for classification
 * @returns Domain analysis with per-flow and overall classifications
 */
export async function classifyUseCaseDomainLLM(
  useCase: GenUseCase,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<UseCaseDomainAnalysis> {
  const prompt = `<instruction>
You are a domain classifier for use case analysis. Your task is to classify each flow in the use case as either:

1. **human-system**: Flows involving human actors interacting with systems (e.g., user fills form, manager approves request)
2. **system-system**: Flows involving only automated system interactions (e.g., API calls, data synchronization, batch processing)
3. **ambiguous**: Cannot confidently determine (e.g., "Payment Gateway" could be human or automated)

Analyze the actors and their actions to determine the domain type.
</instruction>

<guidelines>
1. **Human Indicators**:
   - Roles: User, Customer, Clerk, Manager, Admin, Agent, Operator, Employee, Staff, Specialist
   - Actions: fills form, reviews, approves, clicks, enters data, decides, reads, selects, provides input

2. **System Indicators**:
   - Actors: System, Server, API, Database, Service, Application, Bot, Automation, Gateway, Engine
   - Actions: validates, processes, sends response, stores data, retrieves, calculates, triggers, broadcasts, synchronizes

3. **Actor Type Classification**:
   - If actor name contains human role keywords → human
   - If actor name contains system keywords → system
   - If actions require human judgment/input → human
   - If actions are fully automated → system

4. **Flow Domain Classification**:
   - If all actors in flow are human → human-system (humans use systems)
   - If all actors are systems → system-system
   - If mix of human and system → human-system (human-initiated)
   - If uncertain → ambiguous

5. **Confidence Scoring**:
   - High confidence (0.8-1.0): Clear keywords and action patterns
   - Medium confidence (0.5-0.8): Some indicators but not definitive
   - Low confidence (0.0-0.5): Ambiguous names and generic actions
</guidelines>

<use_case>
Name: ${useCase.name}
Summary: ${useCase.summary}

Flows:
${useCase.flows
  .map(
    (flow) =>
      `Flow ${flow.id} (${flow.kind}):
${flow.steps.map((step) => `  Step ${step.index}: ${step.actor} ${step.target ? `→ ${step.target}` : ""} - ${step.description}`).join("\n")}`,
  )
  .join("\n\n")}
</use_case>

<output_format>
Return a JSON object matching this schema:

{
  "dominantDomain": "human-system" | "system-system" | "ambiguous",
  "flowClassifications": [
    {
      "flowId": string,
      "domainType": "human-system" | "system-system" | "ambiguous",
      "confidence": number (0-1),
      "reasoning": string (explain why this classification was chosen),
      "actorTypes": [
        {
          "actor": string (actor name from the flow),
          "type": "human" | "system" | "ambiguous"
        }
      ]
    }
  ],
  "overallConfidence": number (0-1, average of all flow confidences),
  "summary": string (1-2 sentence summary of the use case's domain characteristics)
}
</output_format>

Analyze the use case and provide the domain classification.`;

  try {
    const response = await geminiFunctions.generateStructured({
      prompt,
      schema: UseCaseDomainAnalysisSchema,
    });

    console.log(
      `Domain classification completed: ${response.dominantDomain} (confidence: ${response.overallConfidence.toFixed(2)})`,
    );

    return response;
  } catch (error) {
    console.error("Domain classification failed:", error);
    // Fallback: return ambiguous classification
    return {
      dominantDomain: "ambiguous",
      flowClassifications: useCase.flows.map((flow) => ({
        flowId: flow.id,
        domainType: "ambiguous" as DomainType,
        confidence: 0,
        reasoning: "Classification failed due to error",
        actorTypes: Array.from(new Set(flow.steps.map((s) => s.actor))).map(
          (actor) => ({
            actor,
            type: "ambiguous" as const,
          }),
        ),
      })),
      overallConfidence: 0,
      summary: "Domain classification failed",
    };
  }
}

/**
 * Main entry point: Classify use case domain
 * Uses hybrid approach (heuristic + semantic) by default for best performance
 * Falls back to LLM if hybrid fails
 */
export async function classifyUseCaseDomain(
  useCase: GenUseCase,
  geminiFunctions?: GeminiOpenRouterFunctions,
  method: "hybrid" | "llm" | "auto" = "auto",
): Promise<UseCaseDomainAnalysis> {
  if (method === "llm" && !geminiFunctions) {
    throw new Error("geminiFunctions required for LLM classification");
  }

  try {
    // Default to hybrid (faster + more accurate)
    if (method === "hybrid" || method === "auto") {
      return await classifyUseCaseDomainHybrid(useCase);
    } else {
      return await classifyUseCaseDomainLLM(useCase, geminiFunctions!);
    }
  } catch (error) {
    console.error("Domain classification failed:", error);

    // Fallback to LLM if hybrid fails and LLM available
    if (method === "auto" && geminiFunctions) {
      console.log("Falling back to LLM classification...");
      try {
        return await classifyUseCaseDomainLLM(useCase, geminiFunctions);
      } catch (llmError) {
        console.error("LLM classification also failed:", llmError);
      }
    }

    // Ultimate fallback: return ambiguous
    return {
      dominantDomain: "ambiguous",
      flowClassifications: useCase.flows.map((flow) => ({
        flowId: flow.id,
        domainType: "ambiguous" as DomainType,
        confidence: 0,
        reasoning: "Classification failed",
        actorTypes: Array.from(new Set(flow.steps.map((s) => s.actor))).map(
          (actor) => ({
            actor,
            type: "ambiguous" as const,
          }),
        ),
      })),
      overallConfidence: 0,
      summary: "Domain classification failed",
    };
  }
}

/**
 * Get human-readable explanation of domain type
 */
export function getDomainExplanation(domainType: DomainType): string {
  switch (domainType) {
    case "human-system":
      return "Human actors interact with system components. Requires handling user input, decisions, and error recovery.";
    case "system-system":
      return "Automated system-to-system interactions. Focus on API reliability, data consistency, and automated error handling.";
    case "ambiguous":
      return "Domain type unclear. May involve ambiguous actors or mixed interaction patterns.";
  }
}

/**
 * Enrich baseline use case with domain metadata (non-invasive)
 */
export interface EnrichedBaselineUseCase extends GenUseCase {
  domainAnalysis?: UseCaseDomainAnalysis;
}

export function resolveDomainFilter(
  analysis: UseCaseDomainAnalysis,
): "human-system" | "system-system" {
  return analysis.dominantDomain === "system-system"
    ? "system-system"
    : "human-system";
}
