import z from "zod";
import { useCaseSchema } from "../schemas/usecase.schema.js";
import { JsonProjectStore } from "../stores/projectStore.js";
import { Action, UseCase } from "../interfaces/usecase.interface.js";

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
    actions: Action[];
  } = {
    id: useCase.id || useCase.name.toLowerCase().replace(/\s+/g, "_"),
    name: useCase.name,
    description: useCase.description,
    mainActorId: useCase.mainActor,
    actorIds: extractedActors.map((a) => a.actor_id),
    actions: useCase.actions,
  };
  await projectStore.log(`saving use case: ${JSON.stringify(useCasePayload)}`);
  await projectStore.saveUseCase(useCasePayload);
}
