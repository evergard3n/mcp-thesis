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

## Development

### Prerequisites

- Node.js
- Gemini API Key (configured in environment)

### Setup

1. Install dependencies:

   ```bash
   cd mcp-thesis
   npm install
   ```

2. Configure Environment:
   Ensure you have a `.env` file with your Gemini API key. You can follow the naming in env.example

3. Build the server:

   ```bash
   npm run build
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
      "url": "http://localhost:3006/mcp"
    }
  }
}
```

## Configuration (Visual Studio Code - Recommended)

This server uses the SSE (Server-Sent Events) transport.

1. Ensure the server is running locally (e.g., `npm run dev` in a terminal).

2. Run this command in your terminal

```bash
code --add-mcp "{\"name\":\"mcp-thesis\",\"type\":\"http\",\"url\":\"http://localhost:3006/mcp\"}"
```

Or, you can locate to mcp.json and add this:

```json
{
  "mcpServers": {
    "mcp-thesis": {
      "url": "http://localhost:3006/mcp"
    }
  }
}
```

## Project Structure

When a project is initialized, it creates:

- `README.md`: Project documentation
- `project.json`: Metadata
- `use-cases/`: Directory for use case descriptions
- `diagrams/`: Directory for generated PlantUML diagrams
- `entities/`: Directory for actors, systems, and classes
