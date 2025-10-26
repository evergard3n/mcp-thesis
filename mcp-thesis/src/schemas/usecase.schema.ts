import { z } from "zod";

export const actorSchema = z.object({
  actor_id: z.string().describe("Actor id"),
  name: z.string().describe("Actor name"),
  description: z.string().describe("Actor description"),
});

export const actionSchema = z.object({
  id: z.string().describe("Action id"),
  order: z.number().describe("Action order"),
  from: z.string().describe("Actor ID who initiates the action"),
  to: z.string().describe("Actor ID who receives the action"),
  action: z.string().describe("Description of the action"),
});

export const useCaseSchema = z.object({
  id: z.string().optional().describe("Use case ID"),
  name: z.string().describe("Use case name"),
  description: z.string().describe("Use case description"),
  mainActor: z.string().describe("Main actor ID"),
  actors: z
    .array(actorSchema)
    .describe("Ids of actors participating in the use case"),
  actions: z
    .array(actionSchema)
    .describe("List of actions performed by the actors."),
});
