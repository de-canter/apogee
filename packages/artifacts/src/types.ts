export type { ArtifactDescriptor } from '@apogee/agent';

/** A user interaction with a card, sent back to the agent with the next message. */
export interface ArtifactAction {
  artifactId: string;
  /** Host-defined vocabulary: submit, confirm, cancel, select, edit, remove, ... */
  actionType: string;
  data?: Record<string, unknown>;
}

/** The annotation the server passes to `session.run(text, { annotations })`. */
export function formatArtifactAnnotation(action: ArtifactAction): string {
  const data = action.data !== undefined ? `\nData: ${JSON.stringify(action.data)}` : '';
  return `[Artifact Action: ${action.actionType} on ${action.artifactId}${data}]`;
}
