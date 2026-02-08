/**
 * Iteration Storage Service - Persists iteration history and gap resolutions
 */

import { promises as fs } from "fs";
import path from "path";
import {
  QuestionHistory,
  GapResolutionStatus,
  IterationHistory,
} from "../interfaces/tracking.interface.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";

export class IterationStorageService {
  private baseDir: string;

  constructor(baseDir: string = "data/iterations") {
    this.baseDir = baseDir;
  }

  /**
   * Ensures storage directory exists
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }

  /**
   * Saves question history
   */
  async saveQuestionHistory(
    testCaseId: string,
    history: QuestionHistory[],
  ): Promise<void> {
    await this.ensureDirectory();
    const filePath = path.join(this.baseDir, `${testCaseId}_history.json`);
    await fs.writeFile(filePath, JSON.stringify(history, null, 2));
  }

  /**
   * Loads question history
   */
  async loadQuestionHistory(testCaseId: string): Promise<QuestionHistory[]> {
    try {
      const filePath = path.join(this.baseDir, `${testCaseId}_history.json`);
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      return []; // No history yet
    }
  }

  /**
   * Saves gap resolutions for a specific iteration
   */
  async saveGapResolutions(
    testCaseId: string,
    iteration: number,
    resolutions: GapResolutionStatus[],
  ): Promise<void> {
    await this.ensureDirectory();
    const filePath = path.join(
      this.baseDir,
      `${testCaseId}_resolutions_iter${iteration}.json`,
    );
    await fs.writeFile(filePath, JSON.stringify(resolutions, null, 2));
  }

  /**
   * Loads gap resolutions for a specific iteration
   */
  async loadGapResolutions(
    testCaseId: string,
    iteration: number,
  ): Promise<GapResolutionStatus[]> {
    try {
      const filePath = path.join(
        this.baseDir,
        `${testCaseId}_resolutions_iter${iteration}.json`,
      );
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      return [];
    }
  }

  /**
   * Saves complete iteration history
   */
  async saveIterationHistory(
    testCaseId: string,
    history: IterationHistory,
  ): Promise<void> {
    await this.ensureDirectory();
    const filePath = path.join(
      this.baseDir,
      `${testCaseId}_iter${history.iteration}.json`,
    );
    await fs.writeFile(filePath, JSON.stringify(history, null, 2));
  }

  /**
   * Loads all iteration histories for a test case
   */
  async loadAllIterationHistories(
    testCaseId: string,
  ): Promise<IterationHistory[]> {
    try {
      await this.ensureDirectory();
      const files = await fs.readdir(this.baseDir);
      const iterationFiles = files.filter(
        (f) => f.startsWith(`${testCaseId}_iter`) && f.endsWith(".json"),
      );

      const histories: IterationHistory[] = [];
      for (const file of iterationFiles) {
        const content = await fs.readFile(
          path.join(this.baseDir, file),
          "utf-8",
        );
        histories.push(JSON.parse(content));
      }

      return histories.sort((a, b) => a.iteration - b.iteration);
    } catch (error) {
      return [];
    }
  }

  /**
   * Saves use case snapshot for an iteration
   */
  async saveUseCaseSnapshot(
    testCaseId: string,
    iteration: number,
    useCase: GenUseCase,
  ): Promise<void> {
    await this.ensureDirectory();
    const filePath = path.join(
      this.baseDir,
      `${testCaseId}_uc_iter${iteration}.json`,
    );
    await fs.writeFile(filePath, JSON.stringify(useCase, null, 2));
  }

  /**
   * Loads use case snapshot for an iteration
   */
  async loadUseCaseSnapshot(
    testCaseId: string,
    iteration: number,
  ): Promise<GenUseCase | null> {
    try {
      const filePath = path.join(
        this.baseDir,
        `${testCaseId}_uc_iter${iteration}.json`,
      );
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Gets metrics summary across all iterations
   */
  async getMetricsSummary(testCaseId: string): Promise<{
    totalIterations: number;
    totalQuestionsAsked: number;
    totalGapsResolved: number;
    averageDuplicateRate: number;
    averageDiscoveryRate: number;
  }> {
    const histories = await this.loadAllIterationHistories(testCaseId);

    if (histories.length === 0) {
      return {
        totalIterations: 0,
        totalQuestionsAsked: 0,
        totalGapsResolved: 0,
        averageDuplicateRate: 0,
        averageDiscoveryRate: 0,
      };
    }

    const totalQuestionsAsked = histories.reduce(
      (sum, h) => sum + h.questionsAsked.length,
      0,
    );
    const totalGapsResolved = histories.reduce(
      (sum, h) => sum + h.gapsResolved.length,
      0,
    );
    const averageDuplicateRate =
      histories.reduce((sum, h) => sum + h.duplicateFlowCount, 0) /
      histories.length;
    const averageDiscoveryRate =
      histories.reduce((sum, h) => sum + h.discoveryRate, 0) / histories.length;

    return {
      totalIterations: histories.length,
      totalQuestionsAsked,
      totalGapsResolved,
      averageDuplicateRate,
      averageDiscoveryRate,
    };
  }
}

// Export singleton instance
export const iterationStorage = new IterationStorageService();
