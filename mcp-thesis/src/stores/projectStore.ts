import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Store } from "../interfaces/store.interface.js";
import { Actor, Step, UseCase } from "../interfaces/usecase.interface.js";

// Legacy version - kept as backup for non-session-scoped usage
export class JsonProjectStoreLegacy {
  private storePath: string | null = null;
  private store: Store | null = null;
  public logPath: string | null = null;
  private readonly baseDir: string;

  constructor() {
    this.baseDir = path.join(os.homedir(), "Documents", "mcp-thesis-projects");
  }

  // Initialize a new project store
  async initProject(name: string, description: string): Promise<string> {
    // Sanitize project name for filename
    const sanitizedName = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    this.storePath = path.join(this.baseDir, `${sanitizedName}.json`);
    this.logPath = path.join(this.baseDir, `${sanitizedName}.log`);

    const store: Store = {
      id: this.generateId(),
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      actors: [],
      useCases: [],
    };

    await fs.mkdir(this.baseDir, { recursive: true });
    await this.writeStore(store);
    this.store = store;

    return this.storePath;
  }

  // Load existing project store by path
  async loadProject(projectPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(projectPath, "utf-8");
      this.store = JSON.parse(content) as Store;
      this.storePath = projectPath;
      // Set log path based on the store path
      this.logPath = projectPath.replace(/\.json$/, ".log");
      return true;
    } catch {
      return false;
    }
  }

  // Load project by name
  async loadProjectByName(name: string): Promise<boolean> {
    const projectPath = await this.findProjectByName(name);
    if (projectPath) {
      return await this.loadProject(projectPath);
    }
    return false;
  }

  // Find project by name (utility function)
  async findProjectByName(name: string): Promise<string | null> {
    try {
      await fs.access(this.baseDir);
      const files = await fs.readdir(this.baseDir);

      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(this.baseDir, file);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const store = JSON.parse(content) as Store;

            // Match by exact name (case-insensitive)
            if (store.name.toLowerCase() === name.toLowerCase()) {
              return filePath;
            }
          } catch {
            // Skip invalid JSON files
            continue;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // List all projects in the directory
  async listAllProjects(): Promise<
    Array<{
      name: string;
      path: string;
      createdAt: string;
      description: string;
    }>
  > {
    try {
      await fs.access(this.baseDir);
      const files = await fs.readdir(this.baseDir);
      const projects: Array<{
        name: string;
        path: string;
        createdAt: string;
        description: string;
      }> = [];

      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(this.baseDir, file);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const store = JSON.parse(content) as Store;
            projects.push({
              name: store.name,
              path: filePath,
              createdAt: store.createdAt,
              description: store.description,
            });
          } catch {
            // Skip invalid JSON files
            continue;
          }
        }
      }

      return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  // Get store data
  getStore(): Store | null {
    return this.store;
  }

  // Get project root path
  getProjectRoot(): string | null {
    return this.storePath ? path.dirname(this.storePath) : null;
  }

  // Add an actor to the project
  async addActor(newActors: Actor[]): Promise<void> {
    if (!this.store) {
      throw new Error(
        "Store not initialized. Call initProject or loadProject first."
      );
    }
    const actors = await this.getAllActors();
    for (const actor of newActors) {
      if (!actors.some((a) => a.actor_id === actor.actor_id)) {
        this.store.actors.push(actor);
      }
    }
    this.store.updatedAt = new Date().toISOString();
    await this.writeStore(this.store);
  }

  // Get an actor by id
  async getActor(actorId: string): Promise<Actor | null> {
    if (!this.store) {
      throw new Error(
        "Store not initialized. Call initProject or loadProject first."
      );
    }
    return this.store.actors.find((a) => a.actor_id === actorId) || null;
  }

  // Get all actors
  async getAllActors(): Promise<Actor[]> {
    if (!this.store) {
      throw new Error(
        "Store not initialized. Call initProject or loadProject first."
      );
    }
    return this.store.actors;
  }

  // Add or update a use case
  async saveUseCase({
    id,
    name,
    description,
    mainActorId,
    actorIds,
    steps,
  }: {
    id?: string;
    name: string;
    description: string;
    mainActorId: string;
    actorIds: string[];
    steps: Step[];
  }): Promise<void> {
    if (!this.store) {
      throw new Error(
        "Store not initialized. Call initProject or loadProject first."
      );
    }

    const existingIndex = this.store.useCases.findIndex((uc) => uc.id === id);

    // If mainActor not provided, use first actor or create a default one
    const actualMainActorId = mainActorId || actorIds[0] || "undefined";

    const useCase: UseCase = {
      id,
      name,
      description,
      mainActor: actualMainActorId,
      actors: actorIds,
      steps,
    };

    if (existingIndex >= 0) {
      this.store.useCases[existingIndex] = useCase;
    } else {
      this.store.useCases.push(useCase);
    }

    this.store.updatedAt = new Date().toISOString();
    await this.writeStore(this.store);
  }

  // Get a specific use case
  getUseCase(useCaseId: string): UseCase | null {
    if (!this.store) return null;
    return this.store.useCases.find((uc) => uc.id === useCaseId) || null;
  }

  // Get all use cases
  getAllUseCases(): UseCase[] {
    return this.store?.useCases || [];
  }

  // Get all steps for a specific use case
  getStepsForUseCase(useCaseId: string): Step[] {
    const useCase = this.getUseCase(useCaseId);
    return useCase?.steps || [];
  }

  // Delete a use case
  async deleteUseCase(useCaseId: string): Promise<boolean> {
    if (!this.store) return false;

    const initialLength = this.store.useCases.length;
    this.store.useCases = this.store.useCases.filter(
      (uc) => uc.id !== useCaseId
    );

    if (this.store.useCases.length !== initialLength) {
      this.store.updatedAt = new Date().toISOString();
      await this.writeStore(this.store);
      return true;
    }

    return false;
  }

  // Get project summary
  async getProjectSummary() {
    if (!this.store) return null;

    const uniqueActors = await this.getAllActors();

    return {
      id: this.store.id,
      name: this.store.name,
      description: this.store.description,
      createdAt: this.store.createdAt,
      updatedAt: this.store.updatedAt,
      stats: {
        totalUseCases: this.store.useCases.length,
        totalActors: uniqueActors.length,
        totalSteps: this.store.useCases.reduce(
          (sum, uc) => sum + uc.steps.length,
          0
        ),
      },
      path: this.storePath,
    };
  }
  async log(message: string): Promise<void> {
    if (!this.logPath) {
      throw new Error("Log path not set");
    }
    await fs.appendFile(
      this.logPath,
      `[${new Date().toISOString()}] ${message}\n`,
      "utf-8"
    );
  }

  // Private helper methods
  private async writeStore(store: Store): Promise<void> {
    if (!this.storePath || !this.logPath) {
      throw new Error("Store path not set. Call initProject first.");
    }
    await this.log(`writing store: ${JSON.stringify(store)}`);
    await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), "utf-8");
  }

  private generateId(): string {
    return `store_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// New session-scoped version
export class JsonProjectStore {
  private storePath: string | null = null;
  private store: Store | null = null;
  public logPath: string | null = null;
  private readonly baseDir: string;
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    // Each session gets its own directory
    this.baseDir = path.join(
      os.homedir(),
      "Documents",
      "mcp-thesis-projects",
      sessionId
    );
  }

  // Initialize a new project store
  async initProject(name: string, description: string): Promise<string> {
    // Sanitize project name for filename
    const sanitizedName = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    this.storePath = path.join(this.baseDir, `${sanitizedName}.json`);
    this.logPath = path.join(this.baseDir, `${sanitizedName}.log`);

    const store: Store = {
      id: this.generateId(),
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      actors: [],
      useCases: [],
    };

    await fs.mkdir(this.baseDir, { recursive: true });
    await this.writeStore(store);
    this.store = store;

    return this.storePath;
  }

  // Load existing project store by path
  async loadProject(projectPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(projectPath, "utf-8");
      this.store = JSON.parse(content) as Store;
      this.storePath = projectPath;
      // Set log path based on the store path
      this.logPath = projectPath.replace(/\.json$/, ".log");
      return true;
    } catch {
      return false;
    }
  }

  // Load project by name
  async loadProjectByName(name: string): Promise<boolean> {
    const projectPath = await this.findProjectByName(name);
    if (projectPath) {
      return await this.loadProject(projectPath);
    }
    return false;
  }

  // Find project by name (utility function)
  async findProjectByName(name: string): Promise<string | null> {
    try {
      await fs.access(this.baseDir);
      const files = await fs.readdir(this.baseDir);

      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(this.baseDir, file);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const store = JSON.parse(content) as Store;

            // Match by exact name (case-insensitive)
            if (store.name.toLowerCase() === name.toLowerCase()) {
              return filePath;
            }
          } catch {
            // Skip invalid JSON files
            continue;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // List all projects in the directory
  async listAllProjects(): Promise<
    Array<{
      name: string;
      path: string;
      createdAt: string;
      description: string;
    }>
  > {
    try {
      await fs.access(this.baseDir);
      const files = await fs.readdir(this.baseDir);
      const projects: Array<{
        name: string;
        path: string;
        createdAt: string;
        description: string;
      }> = [];

      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(this.baseDir, file);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const store = JSON.parse(content) as Store;
            projects.push({
              name: store.name,
              path: filePath,
              createdAt: store.createdAt,
              description: store.description,
            });
          } catch {
            // Skip invalid JSON files
            continue;
          }
        }
      }

      return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  // Get store data
  getStore(): Store | null {
    return this.store;
  }

  // Get project root path
  getProjectRoot(): string | null {
    return this.storePath ? path.dirname(this.storePath) : null;
  }

  // Add an actor to the project
  async addActor(newActors: Actor[]): Promise<void> {
    if (!this.store) {
      throw new Error(
        "Store not initialized. Call initProject or loadProject first."
      );
    }
    const actors = await this.getAllActors();
    for (const actor of newActors) {
      if (!actors.some((a) => a.actor_id === actor.actor_id)) {
        this.store.actors.push(actor);
      }
    }
    this.store.updatedAt = new Date().toISOString();
    await this.writeStore(this.store);
  }

  // Get an actor by id
  async getActor(actorId: string): Promise<Actor | null> {
    if (!this.store) {
      throw new Error(
        "Store not initialized. Call initProject or loadProject first."
      );
    }
    return this.store.actors.find((a) => a.actor_id === actorId) || null;
  }

  // Get all actors
  async getAllActors(): Promise<Actor[]> {
    if (!this.store) {
      throw new Error(
        "Store not initialized. Call initProject or loadProject first."
      );
    }
    return this.store.actors;
  }

  // Add or update a use case
  async saveUseCase({
    id,
    name,
    description,
    mainActorId,
    actorIds,
    steps,
  }: {
    id?: string;
    name: string;
    description: string;
    mainActorId: string;
    actorIds: string[];
    steps: Step[];
  }): Promise<void> {
    if (!this.store) {
      throw new Error(
        "Store not initialized. Call initProject or loadProject first."
      );
    }

    const existingIndex = this.store.useCases.findIndex((uc) => uc.id === id);

    // If mainActor not provided, use first actor or create a default one
    const actualMainActorId = mainActorId || actorIds[0] || "undefined";

    const useCase: UseCase = {
      id,
      name,
      description,
      mainActor: actualMainActorId,
      actors: actorIds,
      steps,
    };

    if (existingIndex >= 0) {
      this.store.useCases[existingIndex] = useCase;
    } else {
      this.store.useCases.push(useCase);
    }

    this.store.updatedAt = new Date().toISOString();
    await this.writeStore(this.store);
  }

  // Get a specific use case
  getUseCase(useCaseId: string): UseCase | null {
    if (!this.store) return null;
    return this.store.useCases.find((uc) => uc.id === useCaseId) || null;
  }

  // Get all use cases
  getAllUseCases(): UseCase[] {
    return this.store?.useCases || [];
  }

  // Get all steps for a specific use case
  getStepsForUseCase(useCaseId: string): Step[] {
    const useCase = this.getUseCase(useCaseId);
    return useCase?.steps || [];
  }

  // Delete a use case
  async deleteUseCase(useCaseId: string): Promise<boolean> {
    if (!this.store) return false;

    const initialLength = this.store.useCases.length;
    this.store.useCases = this.store.useCases.filter(
      (uc) => uc.id !== useCaseId
    );

    if (this.store.useCases.length !== initialLength) {
      this.store.updatedAt = new Date().toISOString();
      await this.writeStore(this.store);
      return true;
    }

    return false;
  }

  // Get project summary
  async getProjectSummary() {
    if (!this.store) return null;

    const uniqueActors = await this.getAllActors();

    return {
      id: this.store.id,
      name: this.store.name,
      description: this.store.description,
      createdAt: this.store.createdAt,
      updatedAt: this.store.updatedAt,
      stats: {
        totalUseCases: this.store.useCases.length,
        totalActors: uniqueActors.length,
        totalSteps: this.store.useCases.reduce(
          (sum, uc) => sum + uc.steps.length,
          0
        ),
      },
      path: this.storePath,
    };
  }
  async log(message: string): Promise<void> {
    if (!this.logPath) {
      throw new Error("Log path not set");
    }
    await fs.appendFile(
      this.logPath,
      `[${new Date().toISOString()}] ${message}\n`,
      "utf-8"
    );
  }

  // Private helper methods
  private async writeStore(store: Store): Promise<void> {
    if (!this.storePath || !this.logPath) {
      throw new Error("Store path not set. Call initProject first.");
    }
    await this.log(`writing store: ${JSON.stringify(store)}`);
    await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), "utf-8");
  }

  private generateId(): string {
    return `store_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
