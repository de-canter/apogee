import { describe, expect, it } from 'vitest';
import { defineResource } from '../resource';
import { ticket, ticketDef } from './fixtures/ticket';

describe('the get capability title and description', () => {
  it('defaults to "Get <resource>" for both title and description', () => {
    const get = ticket.capabilities().find((c) => c.name === 'ticket_get')!;
    expect(get.title).toBe('Get ticket');
    expect(get.description).toBe('Get ticket');
  });

  it('uses the resource def\'s get.title and get.description when given', () => {
    const named = defineResource({ ...ticketDef, get: { title: 'Open a ticket', description: 'One ticket by id, with its state.' } });
    const get = named.capabilities().find((c) => c.name === 'ticket_get')!;
    expect(get.title).toBe('Open a ticket');
    expect(get.description).toBe('One ticket by id, with its state.');
  });
});
