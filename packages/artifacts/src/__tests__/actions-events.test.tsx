import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatArtifactAnnotation } from '../types';
import { useArtifactActions } from '../use-artifact-actions';
import { createArtifactEventsRecorder, useArtifactEvents, type ArtifactEvent } from '../use-artifact-events';

describe('artifact actions', () => {
  it('formats annotations and dispatches with a default or explicit message', () => {
    expect(formatArtifactAnnotation({ artifactId: 'a1', actionType: 'submit' })).toBe('[Artifact Action: submit on a1]');
    expect(formatArtifactAnnotation({ artifactId: 'a1', actionType: 'edit', data: { x: 1 } })).toBe('[Artifact Action: edit on a1\nData: {"x":1}]');
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useArtifactActions({ sendMessage }));
    void result.current.dispatch('a1', 'submit', { name: 'Jane' });
    expect(sendMessage).toHaveBeenCalledWith('submit a1', { artifactAction: { artifactId: 'a1', actionType: 'submit', data: { name: 'Jane' } }, annotations: ['[Artifact Action: submit on a1\nData: {"name":"Jane"}]'] });
    void result.current.dispatch('a1', 'cancel', undefined, 'Never mind');
    expect(sendMessage).toHaveBeenLastCalledWith('Never mind', { artifactAction: { artifactId: 'a1', actionType: 'cancel' }, annotations: ['[Artifact Action: cancel on a1]'] });
  });
});

describe('artifact events', () => {
  it('debounces per field, batches, flushes pending fields on submit, and flushes on cleanup', () => {
    vi.useFakeTimers();
    const batches: ArtifactEvent[][] = [];
    const rec = createArtifactEventsRecorder({ artifactType: 'form', artifactId: 'f1', sink: (b) => { batches.push(b); } });
    rec.recordShown();
    rec.recordFieldChange('name', '', 'J');
    rec.recordFieldChange('name', 'J', 'Ja');
    rec.recordFieldChange('email', '', 'x@y');
    vi.advanceTimersByTime(299);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(1000);
    expect(batches).toHaveLength(1);
    const types = batches[0]!.map((e) => [e.eventType, e.data?.['fieldName'], e.data?.['newValue']]);
    expect(types).toEqual([['artifact_shown', undefined, undefined], ['artifact_field_change', 'name', 'Ja'], ['artifact_field_change', 'email', 'x@y']]);
    expect(batches[0]![1]?.data?.['previousValue']).toBe('');
    rec.recordFieldChange('phone', '', '5');
    rec.recordSubmit({ name: 'Ja', phone: '5' });
    expect(batches).toHaveLength(2);
    expect(batches[1]!.map((e) => e.eventType)).toEqual(['artifact_field_change', 'artifact_submit']);
    rec.recordAction('view');
    rec.cleanup();
    expect(batches[2]!.map((e) => e.eventType)).toEqual(['artifact_action']);
    vi.useRealTimers();
  });
  it('the hook cleans up on unmount', () => {
    const sink = vi.fn();
    const { result, unmount } = renderHook(() => useArtifactEvents({ artifactType: 't', artifactId: '1', sink }));
    result.current.recordAction('a');
    unmount();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]?.[0]).toHaveLength(1);
  });
});
