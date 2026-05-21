import {
  GenUseCase,
  GenFlow,
  GenStep,
} from "../interfaces/usecase.interface.new.js";
import semanticService from "./semantic.service.js";
import {
  HUMAN_KEYWORDS,
  SYSTEM_KEYWORDS,
  HUMAN_ACTION_KEYWORDS,
  SYSTEM_ACTION_KEYWORDS,
} from "../data/domain-keywords.js";

export enum DomainType {
  HumanSystem = "human-system",
  SystemSystem = "system-system",
  Ambiguous = "ambiguous",
}

export enum ActorType {
  Human = "human",
  System = "system",
  Ambiguous = "ambiguous",
}

interface ActorClassification {
  actor: string;
  type: ActorType;
  confidence: number;
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
      type: ActorType.Human,
      confidence: 0.9,
    };
  }
  if (hasSystemCompound && !hasHumanCompound) {
    return {
      actor,
      type: ActorType.System,
      confidence: 0.9,
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
      type: ActorType.Human,
      confidence: Math.min(humanScore, 1.0),
    };
  } else if (systemScore > humanScore && systemScore >= 0.6) {
    return {
      actor,
      type: ActorType.System,
      confidence: Math.min(systemScore, 1.0),
    };
  } else {
    return {
      actor,
      type: ActorType.Ambiguous,
      confidence: 0.5 - Math.abs(humanScore - systemScore),
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
      type: ActorType.Human,
      confidence,
    };
  } else if (systemScore > humanScore && confidence >= CONFIDENCE_THRESHOLD) {
    return {
      actor,
      type: ActorType.System,
      confidence,
    };
  } else {
    // Policy tie-break: weak or tied scores — lean human for typical workflow baselines (thesis interpretability).
    if (humanScore >= systemScore && maxScore >= 0.38) {
      return {
        actor,
        type: ActorType.Human,
        confidence: Math.min(0.85, Math.max(0.45, humanScore)),
      };
    }
    return {
      actor,
      type: ActorType.Ambiguous,
      confidence: 0.5,
    };
  }
}

// ============================================================================
// HYBRID APPROACH: Combine Heuristic + Semantic
// ============================================================================

/**
 * Hybrid actor classification: Use heuristic first, fall back to semantic for ambiguous cases
 * Best of both worlds: fast heuristics + robust semantic matching
 */
async function classifyActorHybrid(
  actor: string,
  actorSteps: GenStep[],
): Promise<ActorClassification> {
  // Phase 1: Try heuristic first (fast)
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
      return semanticResult;
    }

    // Otherwise stick with heuristic
    return heuristicResult;
  } catch (error) {
    console.warn("Semantic classification failed, using heuristic:", error);
    return heuristicResult;
  }
}

async function classifyFlowDomain(flow: GenFlow): Promise<DomainType> {
  const actorNames = Array.from(new Set(flow.steps.map((step) => step.actor)));

  const actorClassifications = await Promise.all(
    actorNames.map((actor) =>
      classifyActorHybrid(
        actor,
        flow.steps.filter((step) => step.actor === actor),
      ),
    ),
  );

  return determineFlowDomain(actorClassifications);
}

/**
 * Determine flow domain based on actor classifications
 */
function determineFlowDomain(
  actorClassifications: ActorClassification[],
): DomainType {
  const humanCount = actorClassifications.filter(
    (a) => a.type === ActorType.Human,
  ).length;
  const systemCount = actorClassifications.filter(
    (a) => a.type === ActorType.System,
  ).length;
  const ambiguousCount = actorClassifications.filter(
    (a) => a.type === ActorType.Ambiguous,
  ).length;

  // Decision logic
  if (humanCount > 0 && systemCount === 0) {
    return DomainType.HumanSystem;
  } else if (systemCount > 0 && humanCount === 0 && ambiguousCount === 0) {
    return DomainType.SystemSystem;
  } else if (humanCount > 0 && systemCount > 0) {
    return DomainType.HumanSystem;
  } else {
    return DomainType.Ambiguous;
  }
}

export async function classifyUseCaseDomainHybrid(
  useCase: GenUseCase,
): Promise<DomainType> {
  console.log(`Classifying domain for: ${useCase.name} (hybrid method)`);

  const flowDomains = await Promise.all(
    useCase.flows.map((flow) => classifyFlowDomain(flow)),
  );

  const domainCounts: Record<DomainType, number> = {
    [DomainType.HumanSystem]: 0,
    [DomainType.SystemSystem]: 0,
    [DomainType.Ambiguous]: 0,
  };

  for (const domain of flowDomains) {
    domainCounts[domain] += 1;
  }

  let dominantDomain = DomainType.Ambiguous;
  if (domainCounts[DomainType.HumanSystem] > domainCounts[DomainType.SystemSystem]) {
    dominantDomain = DomainType.HumanSystem;
  } else if (
    domainCounts[DomainType.SystemSystem] > domainCounts[DomainType.HumanSystem]
  ) {
    dominantDomain = DomainType.SystemSystem;
  } else if (
    domainCounts[DomainType.HumanSystem] ===
      domainCounts[DomainType.SystemSystem] &&
    domainCounts[DomainType.HumanSystem] > 0
  ) {
    dominantDomain = DomainType.HumanSystem;
  }

  return dominantDomain;
}


