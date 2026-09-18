import type { ArtifactDescriptor } from '@apogee/agent';
import type { Usage } from '@apogee/ai';
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { ActiveTool, AgentUiMessage } from './reducer';

export interface MessageListProps {
  messages: AgentUiMessage[];
  renderMessage?: (message: AgentUiMessage, artifacts: ReactNode[]) => ReactNode;
  renderArtifact?: (artifact: ArtifactDescriptor, message: AgentUiMessage) => ReactNode;
  className?: string;
}

/** Unstyled list. Hosts style by className or replace rendering through the slots. */
export function MessageList({ messages, renderMessage, renderArtifact, className }: MessageListProps) {
  return (
    <div className={className} data-testid="message-list" role="log">
      {messages.filter((m) => !m.hidden).map((m) => {
        const artifacts = (m.artifacts ?? []).map((a) => (renderArtifact ? <div key={a.id} data-artifact-slot={a.id}>{renderArtifact(a, m)}</div> : null));
        if (renderMessage) return <div key={m.id}>{renderMessage(m, artifacts)}</div>;
        return (
          <div key={m.id} data-testid={`message-${m.role}`} data-message-id={m.id} data-streaming={m.streaming ? 'true' : undefined}>
            <div data-role={m.role}>{m.role}</div>
            <div>{m.content}</div>
            {artifacts}
          </div>
        );
      })}
    </div>
  );
}

export interface ComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** Textarea plus submit. Enter sends, Shift+Enter inserts a newline. */
export function Composer({ onSend, disabled, placeholder, className }: ComposerProps) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (t === '' || disabled) return;
    onSend(t);
    setText('');
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit(); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };
  return (
    <form className={className} data-testid="composer" onSubmit={onSubmit}>
      <textarea data-testid="composer-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} disabled={disabled} placeholder={placeholder} />
      <button type="submit" data-testid="composer-send" disabled={disabled || text.trim() === ''}>Send</button>
    </form>
  );
}

export interface ToolActivityProps { tools: ActiveTool[]; className?: string }

export function ToolActivity({ tools, className }: ToolActivityProps) {
  if (tools.length === 0) return null;
  return (
    <ul className={className} data-testid="tool-activity" aria-live="polite">
      {tools.map((t) => <li key={t.toolUseId} data-tool={t.name}>{t.name}</li>)}
    </ul>
  );
}

export interface ContextMeterProps { usage?: Usage; budgetTokens: number; className?: string }

/** Share of the context budget used by the last turn's input tokens. */
export function ContextMeter({ usage, budgetTokens, className }: ContextMeterProps) {
  const used = usage ? usage.input + usage.cacheRead : 0;
  const percent = budgetTokens > 0 ? Math.min(100, Math.round((used / budgetTokens) * 100)) : 0;
  return (
    <div className={className} data-testid="context-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      {percent}%
    </div>
  );
}
