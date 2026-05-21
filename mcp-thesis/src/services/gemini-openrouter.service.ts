import z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * GeminiOpenRouterFunctions - Uses OpenRouter API with Gemini 2.5 Flash model
 * Implements the same interface as GeminiFunctions but routes through OpenRouter
 */
class GeminiOpenRouterFunctions {
  private openrouterApiKey: string;

  constructor(openrouterApiKey: string) {
    if (!openrouterApiKey) {
      throw new Error("OpenRouter API key is required");
    }
    this.openrouterApiKey = openrouterApiKey;
  }

  async generate({ prompt }: { prompt: string }): Promise<string> {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.openrouterApiKey}`,
          "HTTP-Referer": "https://github.com/yourusername/mcp-thesis",
          "X-Title": "MCP Thesis - Use Case Management",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return content;
  }

  async generateStructured<T extends z.ZodType>({
    prompt,
    schema,
  }: {
    prompt: string;
    schema: T;
  }): Promise<z.infer<T>> {
    const jsonSchema = zodToJsonSchema(schema);

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.openrouterApiKey}`,
          "HTTP-Referer": "https://github.com/yourusername/mcp-thesis",
          "X-Title": "MCP Thesis - Use Case Management",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
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
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error(
        "Unexpected API response structure:",
        JSON.stringify(data, null, 2),
      );
      throw new Error(`Invalid response structure from OpenRouter API`);
    }

    const content = data.choices[0].message.content;

    if (!content) {
      console.error(
        "Empty content in response:",
        JSON.stringify(data, null, 2),
      );
      throw new Error("Empty content received from OpenRouter API");
    }

    let cleanedText = content.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.slice(7);
    } else if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.slice(3);
    }
    if (cleanedText.endsWith("```")) {
      cleanedText = cleanedText.slice(0, -3);
    }
    cleanedText = cleanedText.trim();

    try {
      return schema.parse(JSON.parse(cleanedText));
    } catch (parseError) {
      console.error(
        "JSON parse error. Content received:",
        cleanedText.substring(0, 500),
      );
      throw parseError;
    }
  }
}

export { GeminiOpenRouterFunctions };
