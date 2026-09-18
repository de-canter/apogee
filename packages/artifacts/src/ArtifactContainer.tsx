import { useEffect, useRef, type ReactNode } from 'react';

export type ArtifactVariant = 'default' | 'compact' | 'inline';

export interface ArtifactContainerProps {
  artifactType: string;
  artifactId: string;
  title?: string;
  variant?: ArtifactVariant;
  isLoading?: boolean;
  error?: string;
  /** Fires once when the card mounts (drive `recordShown` from here). */
  onShown?: () => void;
  className?: string;
  children?: ReactNode;
}

export function ArtifactContainer({ artifactType, artifactId, title, variant = 'default', isLoading, error, onShown, className, children }: ArtifactContainerProps) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    onShown?.();
  }, [onShown]);
  return (
    <section className={className} data-artifact-type={artifactType} data-artifact-id={artifactId} data-variant={variant} data-testid="artifact-container">
      {title !== undefined && <header data-testid="artifact-title">{title}</header>}
      {isLoading ? <div data-testid="artifact-loading">Loading…</div> : error !== undefined ? <div role="alert" data-testid="artifact-error">{error}</div> : children}
    </section>
  );
}
