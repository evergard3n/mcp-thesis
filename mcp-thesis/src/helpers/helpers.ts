import { UseCase } from "../interfaces/usecase.interface.js";
import { JsonProjectStore } from "../stores/projectStore.js";

export function isContain<T>(arrayA: T[], arrayB: T[]): boolean {
  // 1. Tạo Set từ A để tối ưu hóa việc tìm kiếm
  const setA = new Set(arrayA);

  // 2. Lặp qua TẤT CẢ các phần tử trong mảng B
  return arrayB.every((bElement) => {
    // Kiểm tra sự tồn tại trong Set (tìm kiếm rất nhanh)
    return setA.has(bElement);
  });
}

export async function useCaseToUML(
  useCase: UseCase,
  projectStore: JsonProjectStore
): Promise<string> {
  const actors = await projectStore.getAllActors();
  const actorsMap = new Map(
    actors.map((actor) => [actor.actor_id, actor.name])
  );
  const mainActor = actorsMap.get(useCase.mainActor);
  const participants = useCase.actors.map((actor) => actorsMap.get(actor));
  const actions = useCase.actions.map((action) => {
    const from = actorsMap.get(action.from);
    const to = actorsMap.get(action.to);
    return `${from} ${action.type === "response" ? "-->" : "->"} ${to}: ${
      action.action
    }`;
  });
  return `@startuml\n
  actor ${mainActor}\n 
  ${participants.map((p) => `participant ${p}`).join("\n")}\n
  ${actions.join("\n")}
  \n@enduml`;
}
