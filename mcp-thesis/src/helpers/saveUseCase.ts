import z from "zod";
import { Step } from "../interfaces/usecase.interface.js";
import { useCaseSchema } from "../schemas/usecase.schema.js";
import { JsonProjectStore } from "../stores/projectStore.js";

type UseCaseZodSchema = z.infer<typeof useCaseSchema>;
export default async function saveUseCase(
  useCase: UseCaseZodSchema,
  projectStore: JsonProjectStore
) {
  const extractedActors = useCase.actors;
  projectStore.addActor(extractedActors);
  const useCasePayload: {
    id?: string;
    name: string;
    description: string;
    mainActorId: string;
    actorIds: string[];
    steps: Step[];
  } = {
    id: useCase.id || useCase.name.toLowerCase().replace(/\s+/g, "_"),
    name: useCase.name,
    description: useCase.description,
    mainActorId: useCase.mainActor,
    actorIds: extractedActors.map((a) => a.actor_id),
    steps: useCase.steps,
  };
  await projectStore.log(`saving use case: ${JSON.stringify(useCasePayload)}`);
  await projectStore.saveUseCase(useCasePayload);
}
