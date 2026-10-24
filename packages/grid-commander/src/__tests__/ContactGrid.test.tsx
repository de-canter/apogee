import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContactGrid } from '../components/detail/ContactGrid';

const contacts = [
  { id: '1', name: 'John Doe', role: 'Buyer', phone: '555-1234', email: 'john@example.com' },
  { id: '2', name: 'Jane Smith', role: 'Agent', email: 'jane@example.com' },
  { id: '3', name: 'Bob', role: 'Seller' },
];

describe('ContactGrid', () => {
  it('renders contact table with data', () => {
    render(<ContactGrid contacts={contacts} />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Buyer')).toBeInTheDocument();
    expect(screen.getByText('555-1234')).toBeInTheDocument();
  });

  it('renders em dash for missing fields', () => {
    render(<ContactGrid contacts={[{ id: '1', name: 'Test' }]} />);
    const dashes = screen.getAllByText('\u2014');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('renders empty state', () => {
    render(<ContactGrid contacts={[]} />);
    expect(screen.getByText('No contacts')).toBeInTheDocument();
  });

  it('calls onCall when phone button clicked', () => {
    const onCall = vi.fn();
    render(<ContactGrid contacts={contacts} onCall={onCall} />);
    const callBtns = screen.getAllByTitle('Call');
    fireEvent.click(callBtns[0]);
    expect(onCall).toHaveBeenCalledWith(contacts[0]);
  });

  it('calls onEmail when email button clicked', () => {
    const onEmail = vi.fn();
    render(<ContactGrid contacts={contacts} onEmail={onEmail} />);
    const emailBtns = screen.getAllByTitle('Email');
    fireEvent.click(emailBtns[0]);
    expect(onEmail).toHaveBeenCalledWith(contacts[0]);
  });

  it('only shows call button when phone exists', () => {
    const onCall = vi.fn();
    render(
      <ContactGrid
        contacts={[{ id: '1', name: 'No Phone', email: 'a@b.com' }]}
        onCall={onCall}
      />
    );
    expect(screen.queryByTitle('Call')).not.toBeInTheDocument();
  });
});
