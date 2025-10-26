import { Actor, UseCase } from "./usecase.interface.js";

export interface Store {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  useCases: UseCase[];
  actors: Actor[];
}
