import { GoogleGenAI } from "@google/genai";

// The client gets the API key from the environment variable `GEMINI_API_KEY`.

class GeminiFunctions {
  private ai: any;

  constructor() {
    this.ai = new GoogleGenAI({});
  }

  async generate({ prompt }: { prompt: string }) {
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    console.log(response.text);
    return response.text;
  }
}

export default new GeminiFunctions();
