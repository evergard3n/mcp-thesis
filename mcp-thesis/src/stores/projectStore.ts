import { Store, Project } from "../interfaces/store.interface.js";
import { Actor, Step, UseCase } from "../interfaces/usecase.interface.js";
import firebaseService from "../services/firebase.service.js";

// Legacy version - kept as backup for non-session-scoped usage
export class JsonProjectStoreLegacy {
  private store: Store | null = null;
  private readonly collectionName = "stores";

  constructor() {}

  // Initialize a new store (one per session in legacy mode)
  async initStore(): Promise<string> {
    const storeId = this.generateId();

    const store: Store = {
      id: storeId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projects: {},
      currentProjectId: null,
    };

    await this.writeStore(store);
    this.store = store;

    return storeId;
  }

  // Initialize a new project within the store
  async initProject(name: string, description: string): Promise<string> {
    if (!this.store) {
      // Auto-initialize store if not exists
      await this.initStore();
    }

    const projectId = this.generateId();

    const project: Project = {
      id: projectId,
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      actors: [],
      useCases: [],
    };

    this.store!.projects[projectId] = project;
    this.store!.currentProjectId = projectId;
    this.store!.updatedAt = new Date().toISOString();

    await this.writeStore(this.store!);

    return projectId;
  }

  // Load existing store by ID
  async loadStore(storeId: string): Promise<boolean> {
    try {
      const doc = await firebaseService.getDocument(
        this.collectionName,
        storeId,
      );
      if (doc) {
        this.store = doc as Store;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Switch to a specific project
  async switchToProject(projectId: string): Promise<boolean> {
    if (!this.store) {
      throw new Error("Store not initialized. Call initStore first.");
    }

    if (this.store.projects[projectId]) {
      this.store.currentProjectId = projectId;
      this.store.updatedAt = new Date().toISOString();
      await this.writeStore(this.store);
      return true;
    }

    return false;
  }

  // Load project by name
  async loadProjectByName(name: string): Promise<boolean> {
    if (!this.store) {
      throw new Error("Store not initialized. Call initStore first.");
    }

    const project = Object.values(this.store.projects).find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );

    if (project) {
      return await this.switchToProject(project.id);
    }

    return false;
  }

  // List all projects in the store
  async listAllProjects(): Promise<
    Array<{
      name: string;
      id: string;
      createdAt: string;
      description: string;
    }>
  > {
    if (!this.store) {
      return [];
    }

    const projects = Object.values(this.store.projects).map((p) => ({
      name: p.name,
      id: p.id,
      createdAt: p.createdAt,
      description: p.description,
    }));

    return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // Get store data
  getStore(): Store | null {
    return this.store;
  }

  // Get current project
  getCurrentProject(): Project | null {
    if (!this.store || !this.store.currentProjectId) {
      return null;
    }
    return this.store.projects[this.store.currentProjectId] || null;
  }

  // Get store ID
  getStoreId(): string | null {
    return this.store?.id || null;
  }

  // Get current project ID
  getProjectId(): string | null {
    return this.store?.currentProjectId || null;
  }

  // Add an actor to the current project
  async addActor(newActors: Actor[]): Promise<void> {
    const project = this.getCurrentProject();
    if (!project) {
      throw new Error(
        "No active project. Call initProject or switchToProject first.",
      );
    }

    const actors = project.actors;
    for (const actor of newActors) {
      if (!actors.some((a) => a.actor_id === actor.actor_id)) {
        project.actors.push(actor);
      }
    }

    project.updatedAt = new Date().toISOString();
    this.store!.updatedAt = new Date().toISOString();
    await this.writeStore(this.store!);
  }

  // Get an actor by id
  async getActor(actorId: string): Promise<Actor | null> {
    const project = this.getCurrentProject();
    if (!project) {
      throw new Error(
        "No active project. Call initProject or switchToProject first.",
      );
    }
    return project.actors.find((a) => a.actor_id === actorId) || null;
  }

  // Get all actors
  async getAllActors(): Promise<Actor[]> {
    const project = this.getCurrentProject();
    if (!project) {
      throw new Error(
        "No active project. Call initProject or switchToProject first.",
      );
    }
    return project.actors;
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
    const project = this.getCurrentProject();
    if (!project) {
      throw new Error(
        "No active project. Call initProject or switchToProject first.",
      );
    }

    const existingIndex = project.useCases.findIndex((uc) => uc.id === id);

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
      project.useCases[existingIndex] = useCase;
    } else {
      project.useCases.push(useCase);
    }

    project.updatedAt = new Date().toISOString();
    this.store!.updatedAt = new Date().toISOString();
    await this.writeStore(this.store!);
  }

  // Get a specific use case
  getUseCase(useCaseId: string): UseCase | null {
    const project = this.getCurrentProject();
    if (!project) return null;
    return project.useCases.find((uc) => uc.id === useCaseId) || null;
  }

  // Get all use cases
  getAllUseCases(): UseCase[] {
    const project = this.getCurrentProject();
    return project?.useCases || [];
  }

  // Get all steps for a specific use case
  getStepsForUseCase(useCaseId: string): Step[] {
    const useCase = this.getUseCase(useCaseId);
    return useCase?.steps || [];
  }

  // Delete a use case
  async deleteUseCase(useCaseId: string): Promise<boolean> {
    const project = this.getCurrentProject();
    if (!project) return false;

    const initialLength = project.useCases.length;
    project.useCases = project.useCases.filter((uc) => uc.id !== useCaseId);

    if (project.useCases.length !== initialLength) {
      project.updatedAt = new Date().toISOString();
      this.store!.updatedAt = new Date().toISOString();
      await this.writeStore(this.store!);
      return true;
    }

    return false;
  }

  // Delete a project
  async deleteProject(projectId: string): Promise<boolean> {
    if (!this.store) return false;

    if (this.store.projects[projectId]) {
      delete this.store.projects[projectId];

      // If deleting current project, switch to another or null
      if (this.store.currentProjectId === projectId) {
        const remainingProjects = Object.keys(this.store.projects);
        this.store.currentProjectId =
          remainingProjects.length > 0 ? remainingProjects[0] : null;
      }

      this.store.updatedAt = new Date().toISOString();
      await this.writeStore(this.store);
      return true;
    }

    return false;
  }

  // Get project summary
  async getProjectSummary() {
    const project = this.getCurrentProject();
    if (!project) return null;

    const uniqueActors = project.actors;

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      stats: {
        totalUseCases: project.useCases.length,
        totalActors: uniqueActors.length,
        totalSteps: project.useCases.reduce(
          (sum, uc) => sum + uc.steps.length,
          0,
        ),
      },
    };
  }

  async log(message: string): Promise<void> {
    if (!this.store) {
      throw new Error("Store not initialized");
    }
    await firebaseService.addLog("legacy", this.store.id, message);
  }

  // Private helper methods
  private async writeStore(store: Store): Promise<void> {
    if (!store.id) {
      throw new Error("Store ID not set. Call initStore first.");
    }
    await this.log(`writing store: ${JSON.stringify(store)}`);
    await firebaseService.setDocument(this.collectionName, store.id, store);
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// New session-scoped version
export class JsonProjectStore {
  private store: Store | null = null;
  private readonly collectionName = "stores";
  private readonly sessionId: string;
  private loadPromise: Promise<boolean> | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    // Start loading asynchronously but don't block constructor
    this.loadPromise = this.loadStore(this.sessionId);
  }

  // Ensure store is loaded from Firestore or initialized
  private async ensureStore(): Promise<void> {
    if (this.store) {
      return; // Already initialized
    }

    // Wait for initial load attempt
    if (this.loadPromise) {
      await this.loadPromise;
      this.loadPromise = null;
    }

    // If still no store, create empty one (will be saved on first write)
    if (!this.store) {
      this.store = {
        id: this.sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projects: {},
        currentProjectId: null,
      };
      console.log("Store initialized in memory for session:", this.sessionId);
    }
  }

  // Initialize a new project within the store
  async initProject(name: string, description: string): Promise<string> {
    await this.ensureStore();

    const projectId = this.generateId();

    const project: Project = {
      id: projectId,
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      actors: [],
      useCases: [],
    };

    this.store!.projects[projectId] = project;
    this.store!.currentProjectId = projectId;
    this.store!.updatedAt = new Date().toISOString();

    console.log("init project", { project, store: this.store });
    // First write - this will create the store in Firestore
    await this.writeStore(this.store!);

    return projectId;
  }

  // Load existing store by sessionId
  async loadStore(sessionId: string): Promise<boolean> {
    try {
      const doc = await firebaseService.getDocument(
        this.collectionName,
        sessionId,
      );
      if (doc) {
        this.store = doc as Store;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Switch to a specific project
  async switchToProject(projectId: string): Promise<boolean> {
    await this.ensureStore();

    if (this.store!.projects[projectId]) {
      this.store!.currentProjectId = projectId;
      this.store!.updatedAt = new Date().toISOString();
      await this.writeStore(this.store!);
      return true;
    }

    return false;
  }

  // Load project by name (within this session)
  async loadProjectByName(name: string): Promise<boolean> {
    await this.ensureStore();

    const project = Object.values(this.store!.projects).find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );

    if (project) {
      return await this.switchToProject(project.id);
    }

    return false;
  }

  // List all projects in this session
  async listAllProjects(): Promise<
    Array<{
      name: string;
      id: string;
      createdAt: string;
      description: string;
    }>
  > {
    await this.ensureStore();

    const projects = Object.values(this.store!.projects).map((p) => ({
      name: p.name,
      id: p.id,
      createdAt: p.createdAt,
      description: p.description,
    }));

    return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // Get store data
  getStore(): Store | null {
    return this.store;
  }

  // Get current project
  getCurrentProject(): Project | null {
    if (!this.store || !this.store.currentProjectId) {
      return null;
    }
    return this.store.projects[this.store.currentProjectId] || null;
  }

  // Get store ID (sessionId)
  getStoreId(): string | null {
    return this.store?.id || null;
  }

  // Get current project ID
  getProjectId(): string | null {
    return this.store?.currentProjectId || null;
  }

  // Add an actor to the current project
  async addActor(newActors: Actor[]): Promise<void> {
    await this.ensureStore();
    
    const project = this.getCurrentProject();
    if (!project) {
      throw new Error(
        "No active project. Call initProject or switchToProject first.",
      );
    }

    const actors = project.actors;
    for (const actor of newActors) {
      if (!actors.some((a) => a.actor_id === actor.actor_id)) {
        project.actors.push(actor);
      }
    }

    project.updatedAt = new Date().toISOString();
    this.store!.updatedAt = new Date().toISOString();
    await this.writeStore(this.store!);
  }

  // Get an actor by id
  async getActor(actorId: string): Promise<Actor | null> {
    await this.ensureStore();
    
    const project = this.getCurrentProject();
    if (!project) {
      throw new Error(
        "No active project. Call initProject or switchToProject first.",
      );
    }
    return project.actors.find((a) => a.actor_id === actorId) || null;
  }

  // Get all actors
  async getAllActors(): Promise<Actor[]> {
    await this.ensureStore();
    
    const project = this.getCurrentProject();
    if (!project) {
      throw new Error(
        "No active project. Call initProject or switchToProject first.",
      );
    }
    return project.actors;
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
    await this.ensureStore();
    
    const project = this.getCurrentProject();
    if (!project) {
      throw new Error(
        "No active project. Call initProject or switchToProject first.",
      );
    }

    const existingIndex = project.useCases.findIndex((uc) => uc.id === id);

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
      project.useCases[existingIndex] = useCase;
    } else {
      project.useCases.push(useCase);
    }

    project.updatedAt = new Date().toISOString();
    this.store!.updatedAt = new Date().toISOString();
    await this.writeStore(this.store!);
  }

  // Get a specific use case
  getUseCase(useCaseId: string): UseCase | null {
    const project = this.getCurrentProject();
    if (!project) return null;
    return project.useCases.find((uc) => uc.id === useCaseId) || null;
  }

  // Get all use cases
  getAllUseCases(): UseCase[] {
    const project = this.getCurrentProject();
    return project?.useCases || [];
  }

  // Get all steps for a specific use case
  getStepsForUseCase(useCaseId: string): Step[] {
    const useCase = this.getUseCase(useCaseId);
    return useCase?.steps || [];
  }

  // Delete a use case
  async deleteUseCase(useCaseId: string): Promise<boolean> {
    await this.ensureStore();
    
    const project = this.getCurrentProject();
    if (!project) return false;

    const initialLength = project.useCases.length;
    project.useCases = project.useCases.filter((uc) => uc.id !== useCaseId);

    if (project.useCases.length !== initialLength) {
      project.updatedAt = new Date().toISOString();
      this.store!.updatedAt = new Date().toISOString();
      await this.writeStore(this.store!);
      return true;
    }

    return false;
  }

  // Delete a project
  async deleteProject(projectId: string): Promise<boolean> {
    await this.ensureStore();

    if (this.store!.projects[projectId]) {
      delete this.store!.projects[projectId];

      // If deleting current project, switch to another or null
      if (this.store!.currentProjectId === projectId) {
        const remainingProjects = Object.keys(this.store!.projects);
        this.store!.currentProjectId =
          remainingProjects.length > 0 ? remainingProjects[0] : null;
      }

      this.store!.updatedAt = new Date().toISOString();
      await this.writeStore(this.store!);
      return true;
    }

    return false;
  }

  // Get project summary
  async getProjectSummary() {
    await this.ensureStore();
    
    const project = this.getCurrentProject();
    if (!project) return null;

    const uniqueActors = project.actors;

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      stats: {
        totalUseCases: project.useCases.length,
        totalActors: uniqueActors.length,
        totalSteps: project.useCases.reduce(
          (sum, uc) => sum + uc.steps.length,
          0,
        ),
      },
      sessionId: this.sessionId,
    };
  }

  async log(message: string): Promise<void> {
    await this.ensureStore();
    await firebaseService.addLog(this.sessionId, this.store!.id, message);
  }

  // Private helper methods
  private async writeStore(store: Store): Promise<void> {
    if (!store.id) {
      throw new Error("Store ID not set.");
    }
    await this.log(`writing store: ${JSON.stringify(store)}`);
    await firebaseService.setDocument(this.collectionName, store.id, store);
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
