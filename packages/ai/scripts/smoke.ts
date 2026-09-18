/**
 * Manual live smoke test. Costs a fraction of a cent. Not part of `pnpm test`.
 * Run: pnpm -C packages/ai exec tsx scripts/smoke.ts   (needs ANTHROPIC_API_KEY or `ant auth login`)
 */
import { z } from 'zod';
import { createAnthropicModelClient } from '../src/index';

const client = createAnthropicModelClient();

const obj = await client.generateObject(
  z.object({ city: z.string(), country: z.string() }),
  { model: 'fast', messages: [{ role: 'user', content: 'Paris is the capital of which country? Answer as JSON with city and country.' }] },
  { label: 'smoke:object' },
);
console.log('generateObject:', obj.value, obj.usage);

let text = '';
for await (const ev of client.stream({
  model: 'fast',
  system: [{ text: 'You answer in exactly one short sentence.', cache: true }],
  messages: [{ role: 'user', content: 'What is prompt caching?' }],
  tools: [{ name: 'noop', description: 'Never call this.', inputSchema: { type: 'object', properties: {} } }],
  maxTokens: 200,
}, { label: 'smoke:stream' })) {
  if (ev.type === 'text_delta') text += ev.text;
  if (ev.type === 'message_end') console.log('stream end:', ev.stopReason, ev.usage);
  if (ev.type === 'error') console.error('stream error:', ev.error);
}
console.log('stream text:', text);
console.log('ledger:', client.usage.total());
