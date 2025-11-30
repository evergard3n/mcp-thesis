import { GoogleGenAI } from "@google/genai";
import z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// The client gets the API key from the environment variable `GEMINI_API_KEY`.

class GeminiFunctions {
  private ai: any;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate({ prompt }: { prompt: string }): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    console.log(response.text);
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
        responseSchema: zodToJsonSchema(schema),
      },
    });
    return schema.parse(JSON.parse(response.text));
  }
}

export default new GeminiFunctions();
