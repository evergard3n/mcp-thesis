import { OPENROUTER_API_KEY } from "./env.js";
import z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

class OpenRouterFunctions {
  async generateStructured<T extends z.ZodType>({
    prompt,
    zodSchema,
  }: {
    prompt: string;
    zodSchema: T;
  }): Promise<z.infer<T>> {
    const jsonSchema = zodToJsonSchema(zodSchema);

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          temperature: 0.0,
          messages: [{ role: "user", content: prompt }],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "response_schema",
              strict: true,
              schema: jsonSchema,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    console.log(content + "\n");

    let cleanedText = content.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.slice(7); // Remove ```json
    } else if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.slice(3); // Remove ```
    }
    if (cleanedText.endsWith("```")) {
      cleanedText = cleanedText.slice(0, -3); // Remove trailing ```
    }
    cleanedText = cleanedText.trim();

    return zodSchema.parse(JSON.parse(cleanedText));
  }
}

export default new OpenRouterFunctions();
