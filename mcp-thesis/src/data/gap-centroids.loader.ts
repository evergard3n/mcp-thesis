import { readFile } from "fs/promises";
import { join } from "path";
import semanticService from "../services/semantic.service.js";

export type GapType =
  | "missing_exception_flows"
  | "missing_alternative_flows"
  | "incomplete_actors"
  | "uncertain_conditions"
  | "missing_validation_handling"
  | "missing_search_handling"
  | "missing_system_failure_handling"
  | "missing_temporal_exceptions"
  | "missing_nested_exceptions"
  | "missing_resource_availability"
  | "missing_post_completion_scenarios"
  | "missing_data_quality_handling"
  | "missing_environmental_interruptions"
  | "missing_technology_variations"
  | "missing_save_resume_handling"
  | "missing_eligibility_failure_handling"
  | "missing_assignment_unavailability_handling"
  | "missing_policy_outcome_branching"
  | "missing_cancellation_handling"
  | "missing_alternative_path"
  | "missing_authorization_denial"
  | "missing_timeout_retry"
  | "missing_notification_failure"
  | `blueprint_${string}`;

export interface GapCategory {
  name: string;
  keywords: string[];
  centroid: number[] | null;
  threshold: number;
  gapType: GapType;
  requiresExceptionCheck: boolean;
}

interface GapCentroidData {
  modelId: string;
  categories: Record<string, GapCategory>;
}

let gapCentroidsCache: GapCategory[] | null = null;

/**
 * Clear the gap centroids cache to force reloading from file.
 * Useful when gap-centroids.json has been updated.
 */
export function clearGapCentroidsCache(): void {
  gapCentroidsCache = null;
  console.log("Gap centroids cache cleared");
}

/**
 * Look up a loaded centroid category by its name key (matches keys in gap-centroids.json).
 * Returns undefined if the cache has not been loaded yet or the name is not found.
 */
export function getCentroidByName(name: string): GapCategory | undefined {
  return gapCentroidsCache?.find((c) => c.name === name);
}

export async function loadGapCentroids(): Promise<GapCategory[]> {
  if (gapCentroidsCache) return gapCentroidsCache;

  try {
    const dataPath = join(process.cwd(), "src/data/gap-centroids.json");
    const fileContent = await readFile(dataPath, "utf-8");
    const data = JSON.parse(fileContent) as GapCentroidData;

    console.log(`Loading gap centroids from ${dataPath}`);
    let categoriesWithCentroids = 0;

    for (const [name, category] of Object.entries(data.categories)) {
      if (!category.centroid) {
        console.log(
          `  Computing centroid for "${name}" from ${category.keywords.length} keywords`,
        );
        const embeddings = await semanticService.embedBatch(category.keywords);
        category.centroid = await semanticService.computeCentroid(embeddings);
        categoriesWithCentroids++;
      }
      category.name = name;
    }

    gapCentroidsCache = Object.values(data.categories);
    console.log(
      `Gap centroids loaded: ${gapCentroidsCache.length} categories (${categoriesWithCentroids} computed)`,
    );

    // Log thresholds for verification
    for (const cat of gapCentroidsCache) {
      if (cat.requiresExceptionCheck) {
        console.log(
          `  ${cat.name}: threshold=${cat.threshold}, keywords=${cat.keywords.length}`,
        );
      }
    }

    return gapCentroidsCache;
  } catch (error) {
    console.error("Failed to load gap centroids:", error);
    return [];
  }
}
