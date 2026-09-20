import type { ArtifactDescriptor } from '@de_canter/apogee-agent';
import { createContext, createElement, useContext, type ComponentType, type ReactNode } from 'react';

export type ArtifactActionHandler = (actionType: string, data?: Record<string, unknown>, message?: string) => void;

export interface ArtifactComponentProps<TData = unknown> {
  artifact: ArtifactDescriptor & { data: TData };
  onAction: ArtifactActionHandler;
}

export interface ArtifactRegistry {
  register<TData>(type: string, component: ComponentType<ArtifactComponentProps<TData>>): void;
  get(type: string): ComponentType<ArtifactComponentProps> | undefined;
  has(type: string): boolean;
  types(): string[];
}

/** The host registers one component per artifact type. The framework ships none. */
export function createArtifactRegistry(): ArtifactRegistry {
  const map = new Map<string, ComponentType<ArtifactComponentProps>>();
  return {
    register(type, component) { map.set(type, component as ComponentType<ArtifactComponentProps>); },
    get: (type) => map.get(type),
    has: (type) => map.has(type),
    types: () => [...map.keys()],
  };
}

const RegistryContext = createContext<ArtifactRegistry | undefined>(undefined);

export function ArtifactRegistryProvider({ registry, children }: { registry: ArtifactRegistry; children: ReactNode }) {
  return createElement(RegistryContext.Provider, { value: registry }, children);
}

export function useArtifactRegistry(): ArtifactRegistry {
  const r = useContext(RegistryContext);
  if (!r) throw new Error('useArtifactRegistry: wrap the tree in <ArtifactRegistryProvider>.');
  return r;
}
