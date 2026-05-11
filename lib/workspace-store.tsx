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

export type Seam = {
  id: string;
  vertexIndices: number[];
  createdAt: number;
};

export type Model = {
  id: string;
  glbUrl: string;
  description?: string;
  bytes: number;
  createdAt: number;
  seams: Seam[];
  sourceImageUrl?: string;
};

export type WorkspaceState = {
  models: Record<string, Model>;
  activeModelId: string | null;
  isGenerating: boolean;
  isEditing: boolean;
  pendingImageUrl: string | null;
  pendingImageData: { bytes: Uint8Array; mediaType: string } | null;
};

const STORAGE_KEY = "garmentor:workspace:v1";
const STORAGE_VERSION = 1;
const MAX_MODELS = 50;
const SAVE_DEBOUNCE_MS = 250;

type Persisted = { version: number; state: WorkspaceState };

const empty: WorkspaceState = { 
  models: {}, 
  activeModelId: null,
  isGenerating: false,
  isEditing: false,
  pendingImageUrl: null,
  pendingImageData: null,
};

function load(): WorkspaceState {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed?.version !== STORAGE_VERSION) return empty;
    return parsed.state ?? empty;
  } catch {
    return empty;
  }
}

function save(state: WorkspaceState) {
  if (typeof window === "undefined") return;
  try {
    const payload: Persisted = { version: STORAGE_VERSION, state };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded or storage disabled — ignore
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
  addModel: (input: Omit<Model, "createdAt" | "seams"> & { seams?: Seam[] }) => void;
  setActive: (id: string | null) => void;
  addSeam: (modelId: string, vertexIndices: number[]) => string;
  removeSeam: (modelId: string, seamId: string) => void;
  clearSeams: (modelId: string) => void;
  setGenerating: (isGenerating: boolean) => void;
  setEditing: (isEditing: boolean) => void;
  setPendingImage: (url: string | null, data: { bytes: Uint8Array; mediaType: string } | null) => void;
  approvePendingImage: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(empty);
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setState(load());
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(state), SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state]);

  const addModel = useCallback<WorkspaceContextValue["addModel"]>((input) => {
    setState((prev) => {
      if (prev.models[input.id]) {
        return { ...prev, activeModelId: input.id, isGenerating: false };
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
      // This will be called by the approve button
      // The actual 3D generation will be triggered via the chat API
      setState((prev) => ({ ...prev, isGenerating: true }));
    },
    [],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({ 
      state, 
      addModel, 
      setActive, 
      addSeam, 
      removeSeam, 
      clearSeams, 
      setGenerating, 
      setEditing,
      setPendingImage,
      approvePendingImage,
    }),
    [state, addModel, setActive, addSeam, removeSeam, clearSeams, setGenerating, setEditing, setPendingImage, approvePendingImage],
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
