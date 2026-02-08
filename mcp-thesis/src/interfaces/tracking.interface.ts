/**
 * Interfaces for Gap Resolution Tracking (Hybrid Strategy)
 */

import { Gap } from "../analyzers/gap.analyzer.js";

/**
 * Question History - Tracks questions asked in previous iterations
 */
export interface QuestionHistory {
  gapId: string;
  flowId: string;
  stepIndex: number;
  timesAsked: number;
  lastAskedIteration: number;
  questions: string[]; // All questions asked about this gap
}

/**
 * Gap Resolution Status - Tracks semantic resolution of gaps
 */
export interface GapResolutionStatus {
  gapId: string;
  resolvedAt?: string; // ISO timestamp
  resolutionConfidence: number; // 0-1 from cosine similarity
  resolvedByFlow?: string;
  resolvedByStep?: number;
  resolutionMethod: "question" | "semantic" | "none";
  partiallyResolved: boolean;
}

/**
 * Iteration History - Complete snapshot of an iteration
 */
export interface IterationHistory {
  iteration: number;
  timestamp: string;

  // Questions asked
  questionsAsked: Array<{
    question: string;
    targetGap: string;
    targetFlowId: string;
    targetStepIndex: number;
  }>;

  // Answers received
  answersReceived: Array<{
    question: string;
    answer: string;
  }>;

  // Improvements made
  improvements: Array<{
    type: "new_flow" | "modified_flow" | "new_step" | "modified_step";
    flowId: string;
    description: string;
  }>;

  // Gap tracking
  gapsResolved: string[]; // gap IDs
  gapsIntroduced: string[]; // new gaps appeared

  // Metrics
  duplicateFlowCount: number;
  discoveryRate: number;
  totalGaps: number;
}

/**
 * Embedding Cache - Cache text embeddings
 */
export interface EmbeddingCache {
  texts: Map<string, Float32Array>;
  expiry: number; // timestamp
}
