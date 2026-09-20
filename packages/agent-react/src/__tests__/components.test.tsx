import { isoDate } from '@de_canter/apogee-kernel';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer, ContextMeter, MessageList, ToolActivity } from '../components';

const at = isoDate('2026-01-01');

describe('components', () => {
  it('MessageList renders messages, skips hidden, and calls renderArtifact per artifact', () => {
    const renderArtifact = vi.fn(() => <span>ART</span>);
    render(<MessageList messages={[
      { id: '1', role: 'user', content: 'hi', at },
      { id: '2', role: 'assistant', content: 'hidden', hidden: true, at },
      { id: '3', role: 'assistant', content: 'yo', artifacts: [{ type: 'a', id: 'x', data: {} }, { type: 'a', id: 'y', data: {} }], at },
    ]} renderArtifact={renderArtifact} />);
    expect(screen.getAllByTestId(/^message-(user|assistant)$/)).toHaveLength(2);
    expect(renderArtifact).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('ART')).toHaveLength(2);
  });
  it('Composer sends on Enter and inserts newline on Shift+Enter', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello');
    expect((input as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByTestId('composer-send'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it('ToolActivity lists active tools and ContextMeter reports percent of budget', () => {
    const { container } = render(<ToolActivity tools={[{ toolUseId: 't', name: 'lookup', input: {}, startedAt: 0 }]} />);
    expect(container.querySelector('[data-tool="lookup"]')).not.toBeNull();
    render(<ContextMeter usage={{ model: 'm', input: 40_000, output: 1, cacheRead: 10_000, cacheWrite: 0, costUsd: 0 }} budgetTokens={200_000} />);
    expect(screen.getByTestId('context-meter')).toHaveTextContent('25%');
  });
});
