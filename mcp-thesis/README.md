# MCP Thesis - Use Case Management System

A Model Context Protocol (MCP) server for managing UML projects, specifically focused on extracting, validating, and storing Use Cases using LLM capabilities (Gemini).

## Features

### Project Management

- **Initialize Projects**: Create structured UML projects with dedicated storage for use cases, diagrams, and entities.
- **Context Switching**: Load, find, and list available projects.
- **Project Stats**: View summaries of use cases, actors, and steps.

### Use Case Workflow

1. **Extraction**: Convert natural language descriptions into structured Use Case JSON using Gemini.
2. **Validation**: Validate use cases against schema and best practices. Provides scoring and LLM-driven feedback with improvement questions.
3. **UML Generation**: Convert use cases into PlantUML diagrams.

## Tools

### Project Tools (In progress)

- `initProject`: Initialize a new UML project with markdown-based storage.
- `loadProjectByName`: Load an existing project by name.
- `findProjectByName`: Fuzzy search for a project by name or description.
- `listAllProjects`: List all available projects.
- `getProjectInfo`: Get information about the current project (stats, path, etc.).
- `viewProjectUseCases`: View all use cases in the current project.

### Use Case Tools (In progress)

- `extractUseCase`: Extract use case details from user input into a structured format.
- `validateUseCase`: Validate and score the extracted use case; generates improvement questions if quality is low.
- `useCaseToUML`: Convert a saved use case to PlantUML format.

## API Authentication

This MCP server uses **OpenRouter** with the **Gemini 2.0 Flash** model for all LLM operations. It requires:
1. A Gemini API key (passed via HTTP header for per-session authentication)
2. An OpenRouter API key (configured in environment variables for server-side operations)

### Required Configuration

#### 1. HTTP Header (Per-Session)

All requests to the MCP server must include:

```
x-gemini-api-key: YOUR_GEMINI_API_KEY_HERE
```

The API key is validated during the initialization request. If the header is missing, the server will return a `400 Bad Request` error.

#### 2. Environment Variable (Server-Side)

The server requires an OpenRouter API key in the `.env` file:

```bash
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

If this is not configured, the server will return a `500 Server Configuration Error`.

### Why OpenRouter?

- **Unified API**: Access Gemini models through OpenRouter's standardized API
- **Better Rate Limiting**: OpenRouter provides more robust rate limiting and queue management
- **Cost Tracking**: Built-in usage tracking and cost monitoring
- **Fallback Options**: Easy to switch between different models if needed

### Security Notes

- The Gemini API key is stored per session and is not logged or persisted to disk
- Each session maintains its own isolated Gemini API client with the provided key
- The OpenRouter API key is stored server-side and shared across all sessions
- Never commit your API keys to version control
- For production use, consider implementing additional security measures like rate limiting and API key rotation

## Development

### Prerequisites

- Node.js
- Gemini API Key (passed via HTTP header)
- OpenRouter API Key (configured in `.env` file)

### Setup

1. Install dependencies:

   ```bash
   cd mcp-thesis
   npm install
   ```

2. Configure Environment:
   
   Create a `.env` file from the example:
   
   ```bash
   cp env.example .env
   ```
   
   Then edit `.env` and add your OpenRouter API key:
   
   ```bash
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   PORT=3006
   ```

4. Run the server (starts on port 3006 by default):

   ```bash
   npm run dev
   ```

   For development with auto-rebuild:

   ```bash
   npm run watch
   ```

## Configuration (Claude Desktop)

This server uses the SSE (Server-Sent Events) transport.

1. Ensure the server is running locally (e.g., `npm run dev` in a terminal).

2. Add the following to your Claude Desktop config:
   - On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-thesis": {
      "url": "http://localhost:3006/mcp",
      "headers": {
        "x-gemini-api-key": "YOUR_GEMINI_API_KEY_HERE"
      }
    }
  }
}
```

**Important**: Replace `YOUR_GEMINI_API_KEY_HERE` with your actual Gemini API key.

## Configuration (Visual Studio Code - Recommended)

This server uses the SSE (Server-Sent Events) transport.

1. Ensure the server is running locally (e.g., `npm run dev` in a terminal).

2. Run this command in your terminal (replace `YOUR_GEMINI_API_KEY_HERE` with your actual API key):

```bash
code --add-mcp "{\"name\":\"mcp-thesis\",\"type\":\"http\",\"url\":\"http://localhost:3006/mcp\",\"headers\":{\"x-gemini-api-key\":\"YOUR_GEMINI_API_KEY_HERE\"}}"
```

Or, you can locate to mcp.json and add this:

```json
{
  "mcpServers": {
    "mcp-thesis": {
      "url": "http://localhost:3006/mcp",
      "headers": {
        "x-gemini-api-key": "YOUR_GEMINI_API_KEY_HERE"
      }
    }
  }
}
```

**Important**: Replace `YOUR_GEMINI_API_KEY_HERE` with your actual Gemini API key.

## Project Structure

When a project is initialized, it creates:

- `README.md`: Project documentation
- `project.json`: Metadata
- `use-cases/`: Directory for use case descriptions
- `diagrams/`: Directory for generated PlantUML diagrams
- `entities/`: Directory for actors, systems, and classes
