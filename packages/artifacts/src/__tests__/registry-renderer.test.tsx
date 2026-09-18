import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactContainer } from '../ArtifactContainer';
import { ArtifactRenderer } from '../ArtifactRenderer';
import { ArtifactRegistryProvider, createArtifactRegistry, type ArtifactComponentProps } from '../registry';

function NoteCard({ artifact, onAction }: ArtifactComponentProps<{ text: string }>) {
  return (
    <ArtifactContainer artifactType={artifact.type} artifactId={artifact.id} title="Note">
      <span>{artifact.data.text}</span>
      <button onClick={() => onAction('confirm', { id: artifact.id }, 'Confirm the note')}>ok</button>
    </ArtifactContainer>
  );
}

describe('registry + renderer + container', () => {
  it('renders the registered component and forwards actions', () => {
    const registry = createArtifactRegistry();
    registry.register<{ text: string }>('note-card', NoteCard);
    expect(registry.types()).toEqual(['note-card']);
    expect(registry.has('note-card')).toBe(true);
    const onAction = vi.fn();
    render(
      <ArtifactRegistryProvider registry={registry}>
        <ArtifactRenderer artifact={{ type: 'note-card', id: 'n1', data: { text: 'milk' } }} onAction={onAction} />
      </ArtifactRegistryProvider>,
    );
    expect(screen.getByText('milk')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-container')).toHaveAttribute('data-artifact-id', 'n1');
    fireEvent.click(screen.getByText('ok'));
    expect(onAction).toHaveBeenCalledWith('confirm', { id: 'n1' }, 'Confirm the note');
  });
  it('falls back for unknown types, with a custom fallback when given', () => {
    const registry = createArtifactRegistry();
    const { rerender } = render(
      <ArtifactRegistryProvider registry={registry}>
        <ArtifactRenderer artifact={{ type: 'mystery', id: 'm', data: null }} onAction={() => undefined} />
      </ArtifactRegistryProvider>,
    );
    expect(screen.getByTestId('artifact-unknown')).toHaveTextContent('mystery');
    rerender(
      <ArtifactRegistryProvider registry={registry}>
        <ArtifactRenderer artifact={{ type: 'mystery', id: 'm', data: null }} onAction={() => undefined} fallback={(a) => <i>custom {a.type}</i>} />
      </ArtifactRegistryProvider>,
    );
    expect(screen.getByText('custom mystery')).toBeInTheDocument();
  });
  it('throws without a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ArtifactRenderer artifact={{ type: 'x', id: '1', data: null }} onAction={() => undefined} />)).toThrow(/ArtifactRegistryProvider/);
    spy.mockRestore();
  });
  it('container fires onShown once and shows loading/error states', () => {
    const onShown = vi.fn();
    const { rerender } = render(<ArtifactContainer artifactType="t" artifactId="1" onShown={onShown} isLoading>x</ArtifactContainer>);
    expect(screen.getByTestId('artifact-loading')).toBeInTheDocument();
    rerender(<ArtifactContainer artifactType="t" artifactId="1" onShown={onShown} error="bad">x</ArtifactContainer>);
    expect(screen.getByRole('alert')).toHaveTextContent('bad');
    rerender(<ArtifactContainer artifactType="t" artifactId="1" onShown={onShown}>child</ArtifactContainer>);
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(onShown).toHaveBeenCalledTimes(1);
  });
});
