import { z } from "zod";

export const actorSchema = z.object({
  actor_id: z.string().describe("Actor id"),
  name: z.string().describe("Actor name"),
  description: z.string().describe("Actor description"),
});

export const actionSchema = z.object({
  id: z.string().describe("Action id"),
  description: z.string().optional().describe("Action description"),
  prev: z.string().optional().describe("Previous step ID"),
  next: z.string().optional().describe("Next step ID"),
  from: z.string().describe("Actor ID who initiates the action"),
  to: z.string().describe("Actor ID who receives the action"),
  message: z.string().describe("Message content of the action"),
  type: z.enum(["request", "response"]).optional().describe("Type of action (request or response)"),
});

export const conditionBlockSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string().describe("Condition block id"),
    description: z.string().optional().describe("Condition block description"),
    prev: z.string().optional().describe("Previous step ID"),
    next: z.string().optional().describe("Next step ID"),
    condition: z.string().describe("Condition for the control block"),
    ifSteps: z
      .array(z.union([actionSchema, conditionBlockSchema, loopBlockSchema]))
      .describe("Steps to execute if condition is true"),
    elseSteps: z
      .array(z.union([actionSchema, conditionBlockSchema, loopBlockSchema]))
      .optional()
      .describe("Steps to execute if condition is false"),
  })
);

export const loopBlockSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string().describe("Loop block id"),
    description: z.string().optional().describe("Loop block description"),
    prev: z.string().optional().describe("Previous step ID"),
    next: z.string().optional().describe("Next step ID"),
    loopCondition: z.string().describe("Condition for the loop block"),
    steps: z
      .array(z.union([actionSchema, conditionBlockSchema, loopBlockSchema]))
      .describe("Steps for the loop block"),
  })
);

export const stepSchema: z.ZodType<any> = z.lazy(() =>
  z.union([actionSchema, conditionBlockSchema, loopBlockSchema])
);

export const useCaseSchema = z.object({
  id: z.string().optional().describe("Use case ID"),
  name: z.string().describe("Use case name"),
  description: z.string().describe("Use case description"),
  mainActor: z.string().describe("Main actor ID"),
  actors: z
    .array(actorSchema)
    .describe("Array of actors (with id, name, description) participating in the use case"),
  firstStepId: z.string().optional().describe("ID of the first step in the use case"),
  steps: z
    .array(stepSchema)
    .describe("List of steps (actions and control blocks) in the use case."),
});
