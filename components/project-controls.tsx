"use client";

import { useRef, useState } from "react";
import { useWorkspace } from "@/lib/workspace-store";

export function ProjectControls() {
  const {
    state,
    currentProject,
    availableProjects,
    newProject,
    saveCurrentProject,
    loadProject,
    deleteProject,
    renameProject,
    addModel,
    attachPattern,
    setActive,
  } = useWorkspace();

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [projectName, setProjectName] = useState("");

  const handleNew = () => {
    if (currentProject && !confirm("Start a new project? Any unsaved changes will be lost.")) {
      return;
    }
    newProject();
  };

  const handleSave = () => {
    if (currentProject) {
      saveCurrentProject();
    } else {
      setProjectName("");
      setShowSaveDialog(true);
    }
  };

  const handleSaveAs = () => {
    setProjectName(currentProject?.name ?? "");
    setShowSaveDialog(true);
  };

  const handleSaveConfirm = () => {
    if (!projectName.trim()) return;
    saveCurrentProject(projectName.trim());
    setShowSaveDialog(false);
    setProjectName("");
  };

  const handleLoad = () => {
    setShowLoadDialog(true);
  };

  const handleLoadProject = (id: string) => {
    loadProject(id);
    setShowLoadDialog(false);
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Delete project "${name}"? This cannot be undone.`)) {
      deleteProject(id);
    }
  };

  const handleRename = () => {
    if (!currentProject) return;
    setProjectName(currentProject.name);
    setShowRenameDialog(true);
  };

  const handleRenameConfirm = () => {
    if (!projectName.trim()) return;
    renameProject(projectName.trim());
    setShowRenameDialog(false);
    setProjectName("");
  };

  const handleExport = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      project: currentProject?.name ?? "untitled",
      models: state.models,
      activeModelId: state.activeModelId,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(currentProject?.name ?? "garmentor").replace(/\s+/g, "_")}.garmentor.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importRef = useRef<HTMLInputElement>(null);
  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as {
        models: Record<string, unknown>;
        activeModelId: string | null;
      };
      const models = Object.values(payload.models ?? {}) as Array<{
        id: string;
        glbUrl?: string;
        gcdUrl?: string;
        gcd?: unknown;
        bytes: number;
        description?: string;
        sourceImageUrl?: string;
        drapedGlbUrl?: string;
        drapeMetrics?: { maxStretch: number; maxCompression: number; meanStretch: number };
      }>;
      for (const m of models) {
        addModel({
          id: m.id,
          glbUrl: m.glbUrl,
          gcdUrl: m.gcdUrl,
          bytes: m.bytes,
          description: m.description,
          sourceImageUrl: m.sourceImageUrl,
          drapedGlbUrl: m.drapedGlbUrl,
          drapeMetrics: m.drapeMetrics,
        });
        if (m.gcd && m.gcdUrl) {
          attachPattern(m.id, m.gcdUrl, m.gcd as never);
        }
      }
      if (payload.activeModelId) setActive(payload.activeModelId);
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleNew}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          title="New project"
        >
          New
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          title={currentProject ? "Save project" : "Save as new project"}
        >
          {currentProject ? "Save" : "Save As"}
        </button>
        {currentProject && (
          <button
            type="button"
            onClick={handleSaveAs}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            title="Save as new project"
          >
            Save As
          </button>
        )}
        <button
          type="button"
          onClick={handleLoad}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          title="Load project"
        >
          Load
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={Object.keys(state.models).length === 0}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          title="Export current workspace as JSON"
        >
          Export
        </button>
        <button
          type="button"
          onClick={() => importRef.current?.click()}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          title="Import a previously exported workspace JSON"
        >
          Import
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json,.garmentor.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportFile(f);
            if (importRef.current) importRef.current.value = "";
          }}
        />
        {currentProject && (
          <button
            type="button"
            onClick={handleRename}
            className="truncate rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            title="Click to rename"
          >
            {currentProject.name}
          </button>
        )}
        {!currentProject && (
          <span className="text-xs italic text-zinc-400 dark:text-zinc-500">
            Unsaved project
          </span>
        )}
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Save Project
            </h3>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveConfirm()}
              placeholder="Project name"
              className="mb-4 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowSaveDialog(false);
                  setProjectName("");
                }}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveConfirm}
                disabled={!projectName.trim()}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Dialog */}
      {showLoadDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Load Project
            </h3>
            {availableProjects.length === 0 ? (
              <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
                No saved projects found.
              </p>
            ) : (
              <div className="mb-4 max-h-96 space-y-2 overflow-y-auto">
                {availableProjects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {project.name}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {new Date(project.lastModified).toLocaleString()}
                      </div>
                    </div>
                    <div className="ml-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleLoadProject(project.id)}
                        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(project.id, project.name)}
                        className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowLoadDialog(false)}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Dialog */}
      {showRenameDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Rename Project
            </h3>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameConfirm()}
              placeholder="Project name"
              className="mb-4 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowRenameDialog(false);
                  setProjectName("");
                }}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenameConfirm}
                disabled={!projectName.trim()}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
