import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, Trash2, ChevronRight, Loader2, Layers } from "lucide-react";

import { Input } from "~/components/ui/input";

import queryKeys from "~/consts/queryKeys";
import {
  useGetProjects,
  useGetCurrentProject,
  useInitProject,
  useSwitchProject,
  useDeleteProject,
} from "~/modules/projects.module";

interface AppSidebarProps {
  sessionId?: string;
}

export function AppSidebar({ sessionId }: AppSidebarProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const qc = useQueryClient();

  const projectsQuery = useGetProjects(sessionId);
  const currentProjectQuery = useGetCurrentProject(sessionId);
  const initProject = useInitProject();
  const switchProject = useSwitchProject();
  const deleteProject = useDeleteProject();

  const projects = projectsQuery.data ?? [];
  const currentProject = currentProjectQuery.data;

  function invalidate() {
    qc.invalidateQueries({ queryKey: [queryKeys.projectsList, sessionId] });
    qc.invalidateQueries({ queryKey: [queryKeys.currentProject, sessionId] });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || !newName.trim()) return;
    await initProject.mutateAsync({
      sessionId,
      body: { name: newName.trim(), description: newDesc.trim() },
    });
    setNewName("");
    setNewDesc("");
    setShowNewForm(false);
    invalidate();
  }

  async function handleSwitch(projectId: string) {
    if (!sessionId || currentProject?.id === projectId) return;
    await switchProject.mutateAsync({ sessionId, body: { projectId } });
    invalidate();
  }

  async function handleDelete(e: React.MouseEvent, projectId: string) {
    e.stopPropagation();
    if (!sessionId) return;
    setDeletingId(projectId);
    try {
      await deleteProject.mutateAsync({ sessionId, body: { projectId } });
      invalidate();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <Layers size={14} className="text-primary-foreground" />
        </div>
        <span
          className="text-base font-semibold tracking-tight text-sidebar-foreground"
          style={{ fontFamily: "var(--font-display)" }}
        >
          HITL Studio
        </span>
      </div>

      {/* Projects section */}
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Projects
          </span>
          {sessionId && (
            <button
              onClick={() => setShowNewForm((v) => !v)}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="New project"
            >
              <Plus size={13} />
            </button>
          )}
        </div>

        {/* New project form */}
        {sessionId && showNewForm && (
          <form
            onSubmit={handleCreate}
            className="mb-2 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3"
          >
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              className="h-7 text-xs"
            />
            <Input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="h-7 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowNewForm(false);
                  setNewName("");
                  setNewDesc("");
                }}
                className="rounded px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newName.trim() || initProject.isPending}
                className="flex items-center gap-1.5 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {initProject.isPending && <Loader2 size={11} className="animate-spin" />}
                Create
              </button>
            </div>
          </form>
        )}

        {/* Empty / no session state */}
        {!sessionId && (
          <div className="mt-2 px-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Start a session to manage projects.
            </p>
          </div>
        )}

        {/* Loading */}
        {sessionId && projectsQuery.isLoading && (
          <div className="flex items-center gap-2 px-2 py-3">
            <Loader2 size={13} className="animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Loading…</span>
          </div>
        )}

        {/* Empty projects */}
        {sessionId &&
          !projectsQuery.isLoading &&
          projects.length === 0 &&
          !showNewForm && (
            <div className="px-2 py-1">
              <p className="text-xs text-muted-foreground">No projects yet.</p>
            </div>
          )}

        {/* Project list */}
        <div className="flex flex-col gap-0.5">
          {projects.map((project) => {
            const isActive = currentProject?.id === project.id;
            const isDeleting = deletingId === project.id;

            return (
              <button
                key={project.id}
                onClick={() => handleSwitch(project.id)}
                disabled={isDeleting || switchProject.isPending}
                className={`group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-all ${
                  isActive
                    ? "bg-primary/12 text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <FolderOpen
                  size={13}
                  className={isActive ? "text-primary" : "text-muted-foreground"}
                />
                <span className="flex-1 truncate text-xs font-medium">{project.name}</span>
                {isActive && (
                  <ChevronRight size={11} className="shrink-0 text-primary" />
                )}
                {isDeleting ? (
                  <Loader2 size={11} className="shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <button
                    onClick={(e) => handleDelete(e, project.id)}
                    className="hidden shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive group-hover:flex"
                    title="Delete project"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-5 py-3">
        <p className="text-[10px] tracking-wide text-muted-foreground/50">
          HITL Session Manager
        </p>
      </div>
    </aside>
  );
}
