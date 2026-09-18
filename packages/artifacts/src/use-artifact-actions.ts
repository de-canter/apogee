import { useCallback } from 'react';
import { formatArtifactAnnotation, type ArtifactAction } from './types';

export interface SendWithArtifact {
  (text: string, opts: { artifactAction: ArtifactAction; annotations: string[] }): void | Promise<void>;
}

export interface UseArtifactActionsOptions {
  sendMessage: SendWithArtifact;
  /** Text shown as the user's message when the card gives none. */
  defaultMessage?: (action: ArtifactAction) => string;
}

export const defaultArtifactMessage = (a: ArtifactAction): string => `${a.actionType} ${a.artifactId}`;

/** Turns a card interaction into the next agent message plus a model-only annotation. */
export function useArtifactActions({ sendMessage, defaultMessage = defaultArtifactMessage }: UseArtifactActionsOptions) {
  const dispatch = useCallback(
    (artifactId: string, actionType: string, data?: Record<string, unknown>, message?: string) => {
      const action: ArtifactAction = { artifactId, actionType, ...(data !== undefined ? { data } : {}) };
      return sendMessage(message ?? defaultMessage(action), { artifactAction: action, annotations: [formatArtifactAnnotation(action)] });
    },
    [sendMessage, defaultMessage],
  );
  return { dispatch };
}
