import { GoogleGenAI } from "@google/genai";
import z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// The client must provide the API key via request headers.

class GeminiFunctions {
  private ai: any;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("Gemini API key is required");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate({ prompt }: { prompt: string }): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    console.log(response.text + "\n");
    return response.text;
  }

  async generateStructured<T extends z.ZodType>({
    prompt,
    schema,
  }: {
    prompt: string;
    schema: T;
  }): Promise<z.infer<T>> {
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: zodToJsonSchema(schema),
      },
    });

    // Remove markdown code fences if present
    let cleanedText = response.text.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.slice(7); // Remove ```json
    } else if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.slice(3); // Remove ```
    }
    if (cleanedText.endsWith("```")) {
      cleanedText = cleanedText.slice(0, -3); // Remove trailing ```
    }
    cleanedText = cleanedText.trim();

    return schema.parse(JSON.parse(cleanedText));
  }
}

export { GeminiFunctions };
