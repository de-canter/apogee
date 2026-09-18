import type { ArtifactDescriptor } from '@apogee/agent';
import type { ReactNode } from 'react';
import { ArtifactContainer } from './ArtifactContainer';
import { useArtifactRegistry, type ArtifactActionHandler } from './registry';

export interface ArtifactRendererProps {
  artifact: ArtifactDescriptor;
  onAction: ArtifactActionHandler;
  fallback?: (artifact: ArtifactDescriptor) => ReactNode;
}

/** Looks the artifact type up in the registry and renders the host's component. */
export function ArtifactRenderer({ artifact, onAction, fallback }: ArtifactRendererProps) {
  const registry = useArtifactRegistry();
  const Component = registry.get(artifact.type);
  if (!Component) {
    if (fallback) return <>{fallback(artifact)}</>;
    return (
      <ArtifactContainer artifactType={artifact.type} artifactId={artifact.id} variant="compact">
        <span data-testid="artifact-unknown">Unknown artifact type: {artifact.type}</span>
      </ArtifactContainer>
    );
  }
  return <Component artifact={artifact} onAction={onAction} />;
}
