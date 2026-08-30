import { useSyncExternalStore } from "react";

export interface StatusState {
  label: string;
  progress?: { current: number; total: number } | null;
  indeterminate?: boolean;
}

let current: StatusState | null = null;
const listeners = new Set<() => void>();

export function setStatus(state: StatusState | null): void {
  current = state;
  listeners.forEach((l) => l());
}

export function clearStatus(): void {
  setStatus(null);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): StatusState | null {
  return current;
}

export function useStatus(): StatusState | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
