# MCP Thesis - Data Architecture

## Overview

This document describes the new data architecture where each session has one store, and each store can contain multiple projects.

## Data Structure

### Firestore Collections

```
stores/
  └── {sessionId}/
      ├── id: string (sessionId)
      ├── createdAt: string
      ├── updatedAt: string
      ├── currentProjectId: string | null
      └── projects: {
            [projectId: string]: {
              id: string
              name: string
              description: string
              createdAt: string
              updatedAt: string
              actors: Actor[]
              useCases: UseCase[]
            }
          }
```

### Interfaces

#### Store
```typescript
interface Store {
  id: string;                              // sessionId
  createdAt: string;
  updatedAt: string;
  projects: { [projectId: string]: Project };
  currentProjectId: string | null;         // Currently active project
}
```

#### Project
```typescript
interface Project {
  id: string;                              // unique project ID
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  useCases: UseCase[];
  actors: Actor[];
}
```

## Key Concepts

### Session-Store Relationship
- **One session → One store**: Each MCP session has exactly one store document in Firestore
- **Store ID = Session ID**: The Firestore document ID is the session ID
- **Automatic initialization**: The store is automatically created when the first project is initialized

### Store-Project Relationship
- **One store → Multiple projects**: A store can contain multiple projects
- **Current project**: The store tracks which project is currently active via `currentProjectId`
- **Project switching**: Users can switch between projects within the same session

## API Methods

### Store Management
- `initStore()` - Initialize or load the session's store
- `loadStore(sessionId)` - Load an existing store

### Project Management
- `initProject(name, description)` - Create a new project in the store
- `switchToProject(projectId)` - Switch to a different project
- `loadProjectByName(name)` - Find and switch to a project by name
- `listAllProjects()` - List all projects in the store
- `deleteProject(projectId)` - Delete a project from the store
- `getCurrentProject()` - Get the currently active project
- `getProjectSummary()` - Get summary of current project

### Use Case & Actor Management
All use case and actor operations work on the **current project**:
- `addActor(actors)`
- `getActor(actorId)`
- `getAllActors()`
- `saveUseCase({...})`
- `getUseCase(useCaseId)`
- `getAllUseCases()`
- `deleteUseCase(useCaseId)`

## MCP Tools

### Available Tools
1. `initProject` - Create a new project in the session
2. `loadProjectByName` - Switch to a project by name
3. `findProjectByName` - Search for projects by name
4. `listAllProjects` - List all projects in the session
5. `getProjectInfo` - Get current project information
6. `viewProjectUseCases` - View use cases in current project
7. `switchToProject` - Switch to a different project by ID
8. `deleteProject` - Delete a project

## Migration from Old Structure

### Old Structure
```
projects/
  └── {projectId}/
      ├── id: string
      ├── name: string
      ├── sessionId: string
      └── ...project data
```

### New Structure
```
stores/
  └── {sessionId}/
      └── projects/
          └── {projectId}/
              └── ...project data
```

### Key Differences
1. **Storage location**: Projects moved from top-level collection to nested within stores
2. **Document ID**: Store uses sessionId as document ID (not auto-generated)
3. **Single source**: One store document per session instead of multiple project documents
4. **Active tracking**: Store tracks the currently active project

## Benefits

1. **Session isolation**: All projects for a session are contained in one document
2. **Easy switching**: Users can quickly switch between projects without reloading
3. **Atomic updates**: All project changes are within a single Firestore document
4. **Simplified queries**: No need to query by sessionId - direct document access
5. **Better organization**: Clear hierarchy: Session → Store → Projects

## Example Usage

```typescript
// Initialize store (happens automatically)
const projectStore = new JsonProjectStore(sessionId);

// Create first project
const projectId1 = await projectStore.initProject(
  "E-commerce App",
  "Online shopping system"
);

// Create second project
const projectId2 = await projectStore.initProject(
  "Admin Dashboard",
  "Management interface"
);

// List all projects
const projects = await projectStore.listAllProjects();
// Returns: [{ name: "Admin Dashboard", ... }, { name: "E-commerce App", ... }]

// Switch to first project
await projectStore.switchToProject(projectId1);

// Work with current project
await projectStore.addActor([{ actor_id: "user", name: "Customer", ... }]);
await projectStore.saveUseCase({ name: "Place Order", ... });

// Switch to second project
await projectStore.loadProjectByName("Admin Dashboard");

// Now working with different project
const useCases = projectStore.getAllUseCases(); // From Admin Dashboard
```

## Logging

All operations are logged to Firestore:
```typescript
logs/
  └── {logId}/
      ├── sessionId: string
      ├── projectId: string
      ├── message: string
      └── timestamp: string
```
