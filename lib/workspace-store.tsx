"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { nanoId } from "@/lib/utils";
import type { GcdPattern } from "@/lib/garment-gpt";
import type { FabricKey } from "@/lib/fabrics";

export type Seam = {
  id: string;
  vertexIndices: number[];
  createdAt: number;
};

export type Model = {
  id: string;
  glbUrl?: string;
  description?: string;
  bytes: number;
  createdAt: number;
  seams: Seam[];
  sourceImageUrl?: string;
  gcdUrl?: string;
  gcd?: GcdPattern;
};

export type ViewerSettings = {
  fabric: FabricKey;
  showAvatar: boolean;
  avatarScale: number;
};

export type WorkspaceState = {
  models: Record<string, Model>;
  activeModelId: string | null;
  isGenerating: boolean;
  isEditing: boolean;
  pendingImageUrl: string | null;
  pendingImageData: { bytes: Uint8Array; mediaType: string } | null;
  viewer: ViewerSettings;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  lastModified: number;
  workspace: WorkspaceState;
};

const PROJECTS_INDEX_KEY = "garmentor:projects:index";
const CURRENT_PROJECT_KEY = "garmentor:current-project-id";
const STORAGE_VERSION = 2;
const MAX_MODELS = 50;
const SAVE_DEBOUNCE_MS = 250;

type ProjectIndex = {
  version: number;
  projects: Array<{ id: string; name: string; lastModified: number }>;
};

const emptyWorkspace: WorkspaceState = {
  models: {},
  activeModelId: null,
  isGenerating: false,
  isEditing: false,
  pendingImageUrl: null,
  pendingImageData: null,
  viewer: { fabric: "default", showAvatar: true, avatarScale: 1 },
};

function normalizeWorkspace(s: Partial<WorkspaceState> | undefined): WorkspaceState {
  return {
    models: s?.models ?? {},
    activeModelId: s?.activeModelId ?? null,
    isGenerating: false,
    isEditing: false,
    pendingImageUrl: null,
    pendingImageData: null,
    viewer: { ...emptyWorkspace.viewer, ...(s?.viewer ?? {}) },
  };
}

function getProjectKey(id: string): string {
  return `garmentor:project:${id}`;
}

function loadProjectIndex(): ProjectIndex {
  if (typeof window === "undefined") return { version: STORAGE_VERSION, projects: [] };
  try {
    const raw = window.localStorage.getItem(PROJECTS_INDEX_KEY);
    if (!raw) return { version: STORAGE_VERSION, projects: [] };
    const parsed = JSON.parse(raw) as ProjectIndex;
    if (parsed?.version !== STORAGE_VERSION) return { version: STORAGE_VERSION, projects: [] };
    return parsed;
  } catch {
    return { version: STORAGE_VERSION, projects: [] };
  }
}

function saveProjectIndex(index: ProjectIndex) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(index));
  } catch {
    // quota exceeded or storage disabled — ignore
  }
}

function loadProject(id: string): Project | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getProjectKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

function saveProject(project: Project) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getProjectKey(project.id), JSON.stringify(project));
    
    // Update index
    const index = loadProjectIndex();
    const existing = index.projects.findIndex(p => p.id === project.id);
    const entry = { id: project.id, name: project.name, lastModified: project.lastModified };
    
    if (existing >= 0) {
      index.projects[existing] = entry;
    } else {
      index.projects.push(entry);
    }
    
    saveProjectIndex(index);
  } catch {
    // quota exceeded or storage disabled — ignore
  }
}

function deleteProject(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getProjectKey(id));
    
    const index = loadProjectIndex();
    index.projects = index.projects.filter(p => p.id !== id);
    saveProjectIndex(index);
  } catch {
    // ignore
  }
}

function trimToCap(models: Record<string, Model>): Record<string, Model> {
  const list = Object.values(models);
  if (list.length <= MAX_MODELS) return models;
  const sorted = list.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_MODELS);
  const next: Record<string, Model> = {};
  for (const m of sorted) next[m.id] = m;
  return next;
}

export type WorkspaceContextValue = {
  state: WorkspaceState;
  currentProject: Project | null;
  availableProjects: Array<{ id: string; name: string; lastModified: number }>;
  addModel: (input: Omit<Model, "createdAt" | "seams"> & { seams?: Seam[] }) => void;
  attachPattern: (modelId: string, gcdUrl: string, gcd: GcdPattern) => void;
  setActive: (id: string | null) => void;
  addSeam: (modelId: string, vertexIndices: number[]) => string;
  removeSeam: (modelId: string, seamId: string) => void;
  clearSeams: (modelId: string) => void;
  setGenerating: (isGenerating: boolean) => void;
  setEditing: (isEditing: boolean) => void;
  setPendingImage: (url: string | null, data: { bytes: Uint8Array; mediaType: string } | null) => void;
  approvePendingImage: () => Promise<void>;
  setViewer: (next: Partial<ViewerSettings>) => void;
  newProject: () => void;
  saveCurrentProject: (name?: string) => void;
  loadProject: (id: string) => void;
  deleteProject: (id: string) => void;
  renameProject: (name: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(emptyWorkspace);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [availableProjects, setAvailableProjects] = useState<Array<{ id: string; name: string; lastModified: number }>>([]);
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load available projects on mount
  useEffect(() => {
    const index = loadProjectIndex();
    setAvailableProjects(index.projects.sort((a, b) => b.lastModified - a.lastModified));
    
    // Don't auto-load any project - start with empty workspace
    hydrated.current = true;
  }, []);

  // Auto-save current project when state changes
  useEffect(() => {
    if (!hydrated.current || !currentProject) return;
    
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const updated: Project = {
        ...currentProject,
        workspace: state,
        lastModified: Date.now(),
      };
      saveProject(updated);
      setCurrentProject(updated);
      
      // Update available projects list
      setAvailableProjects(prev => {
        const filtered = prev.filter(p => p.id !== updated.id);
        return [
          { id: updated.id, name: updated.name, lastModified: updated.lastModified },
          ...filtered,
        ].sort((a, b) => b.lastModified - a.lastModified);
      });
    }, SAVE_DEBOUNCE_MS);
    
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, currentProject]);

  const addModel = useCallback<WorkspaceContextValue["addModel"]>((input) => {
    setState((prev) => {
      if (prev.models[input.id]) {
        const merged: Model = { ...prev.models[input.id], ...input };
        return {
          ...prev,
          models: { ...prev.models, [input.id]: merged },
          activeModelId: input.id,
          isGenerating: false,
        };
      }
      const next: Model = {
        ...input,
        seams: input.seams ?? [],
        createdAt: Date.now(),
      };
      const models = trimToCap({ ...prev.models, [next.id]: next });
      return { ...prev, models, activeModelId: next.id, isGenerating: false };
    });
  }, []);

  const attachPattern = useCallback<WorkspaceContextValue["attachPattern"]>(
    (modelId, gcdUrl, gcd) => {
      setState((prev) => {
        const m = prev.models[modelId];
        if (!m) return prev;
        return {
          ...prev,
          models: { ...prev.models, [modelId]: { ...m, gcdUrl, gcd } },
        };
      });
    },
    [],
  );

  const setViewer = useCallback<WorkspaceContextValue["setViewer"]>((next) => {
    setState((prev) => ({ ...prev, viewer: { ...prev.viewer, ...next } }));
  }, []);

  const setActive = useCallback<WorkspaceContextValue["setActive"]>((id) => {
    setState((prev) => {
      if (id !== null && !prev.models[id]) return prev;
      return { ...prev, activeModelId: id };
    });
  }, []);

  const addSeam = useCallback<WorkspaceContextValue["addSeam"]>(
    (modelId, vertexIndices) => {
      const seam: Seam = { id: nanoId(8), vertexIndices, createdAt: Date.now() };
      setState((prev) => {
        const m = prev.models[modelId];
        if (!m) return prev;
        return {
          ...prev,
          models: {
            ...prev.models,
            [modelId]: { ...m, seams: [...m.seams, seam] },
          },
        };
      });
      return seam.id;
    },
    [],
  );

  const removeSeam = useCallback<WorkspaceContextValue["removeSeam"]>(
    (modelId, seamId) => {
      setState((prev) => {
        const m = prev.models[modelId];
        if (!m) return prev;
        return {
          ...prev,
          models: {
            ...prev.models,
            [modelId]: { ...m, seams: m.seams.filter((s) => s.id !== seamId) },
          },
        };
      });
    },
    [],
  );

  const clearSeams = useCallback<WorkspaceContextValue["clearSeams"]>(
    (modelId) => {
      setState((prev) => {
        const m = prev.models[modelId];
        if (!m) return prev;
        return {
          ...prev,
          models: { ...prev.models, [modelId]: { ...m, seams: [] } },
        };
      });
    },
    [],
  );

  const setGenerating = useCallback<WorkspaceContextValue["setGenerating"]>(
    (isGenerating) => {
      setState((prev) => ({ ...prev, isGenerating }));
    },
    [],
  );

  const setEditing = useCallback<WorkspaceContextValue["setEditing"]>(
    (isEditing) => {
      setState((prev) => ({ ...prev, isEditing }));
    },
    [],
  );

  const setPendingImage = useCallback<WorkspaceContextValue["setPendingImage"]>(
    (url, data) => {
      setState((prev) => ({ ...prev, pendingImageUrl: url, pendingImageData: data }));
    },
    [],
  );

  const approvePendingImage = useCallback<WorkspaceContextValue["approvePendingImage"]>(
    async () => {
      setState((prev) => ({ ...prev, isGenerating: true }));
    },
    [],
  );

  const newProject = useCallback(() => {
    setState(emptyWorkspace);
    setCurrentProject(null);
  }, []);

  const saveCurrentProject = useCallback((name?: string) => {
    const projectName = name ?? currentProject?.name ?? "Untitled Project";
    const now = Date.now();
    
    const project: Project = currentProject
      ? { ...currentProject, name: projectName, workspace: state, lastModified: now }
      : {
          id: nanoId(12),
          name: projectName,
          createdAt: now,
          lastModified: now,
          workspace: state,
        };
    
    saveProject(project);
    setCurrentProject(project);
    
    // Update available projects
    setAvailableProjects(prev => {
      const filtered = prev.filter(p => p.id !== project.id);
      return [
        { id: project.id, name: project.name, lastModified: project.lastModified },
        ...filtered,
      ].sort((a, b) => b.lastModified - a.lastModified);
    });
  }, [currentProject, state]);

  const loadProjectCallback = useCallback((id: string) => {
    const project = loadProject(id);
    if (!project) return;

    setState(normalizeWorkspace(project.workspace));
    setCurrentProject(project);
    
    // Update last modified
    const updated = { ...project, lastModified: Date.now() };
    saveProject(updated);
    setCurrentProject(updated);
  }, []);

  const deleteProjectCallback = useCallback((id: string) => {
    deleteProject(id);
    setAvailableProjects(prev => prev.filter(p => p.id !== id));
    
    if (currentProject?.id === id) {
      setState(emptyWorkspace);
      setCurrentProject(null);
    }
  }, [currentProject]);

  const renameProject = useCallback((name: string) => {
    if (!currentProject) return;
    
    const updated = { ...currentProject, name, lastModified: Date.now() };
    saveProject(updated);
    setCurrentProject(updated);
    
    setAvailableProjects(prev => {
      const filtered = prev.filter(p => p.id !== updated.id);
      return [
        { id: updated.id, name: updated.name, lastModified: updated.lastModified },
        ...filtered,
      ].sort((a, b) => b.lastModified - a.lastModified);
    });
  }, [currentProject]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      currentProject,
      availableProjects,
      addModel,
      attachPattern,
      setActive,
      addSeam,
      removeSeam,
      clearSeams,
      setGenerating,
      setEditing,
      setPendingImage,
      approvePendingImage,
      setViewer,
      newProject,
      saveCurrentProject,
      loadProject: loadProjectCallback,
      deleteProject: deleteProjectCallback,
      renameProject,
    }),
    [
      state,
      currentProject,
      availableProjects,
      addModel,
      attachPattern,
      setActive,
      addSeam,
      removeSeam,
      clearSeams,
      setGenerating,
      setEditing,
      setPendingImage,
      approvePendingImage,
      setViewer,
      newProject,
      saveCurrentProject,
      loadProjectCallback,
      deleteProjectCallback,
      renameProject,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

export function useActiveModel(): Model | null {
  const { state } = useWorkspace();
  if (!state.activeModelId) return null;
  return state.models[state.activeModelId] ?? null;
}

export function useModel(id: string | null | undefined): Model | null {
  const { state } = useWorkspace();
  if (!id) return null;
  return state.models[id] ?? null;
}
