'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { templates } = require('../lib/plaza-card-catalog');
const { aiInput, validatedOutput } = require('../lib/plaza-program');
const { createClaudeProvider, plazaAiFromEnv, schemaFor, DEFAULT_MODEL } = require('../lib/plaza-ai');

const card = templates({ synthetic: true }).find(t => t.program_key === 'perfumer-gypsum');
const ideasInput = aiInput(card, 'ideas', { customer_id: 'gentle', material_ids: ['test-a', 'test-b'] });
// A reply is built from the saved draft; its free text must not reach the provider.
const draft = { customer_id: 'gift', material_ids: ['test-a'], plan: '내 구상 메모', artwork_name: '비밀 작품', store_name: '우리 가게' };
const replyInput = aiInput(card, 'reply', { ...draft, request_id: 'place' });

function fakeClient(response) {
  const calls = [];
  return { calls, beta: { messages: { create: async (body, options) => { calls.push({ body, options }); return response; } } } };
}
const answer = (json, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(json) }] });

test('Claude is used only when named and given a key', () => {
  assert.equal(plazaAiFromEnv({}), null);
  assert.equal(plazaAiFromEnv({ ANTHROPIC_API_KEY: 'k' }), null);
  assert.equal(plazaAiFromEnv({ PLAZA_AI_PROVIDER: 'anthropic' }), null);
  const provider = plazaAiFromEnv({ PLAZA_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' });
  assert.equal(provider.model, DEFAULT_MODEL);
  assert.ok(provider.timeoutMs < 20000, 'must finish before a running suggestion is recovered as an example');
});

test('the request carries only the vetted card options and constrains the answer to their IDs', async () => {
  const client = fakeClient(answer({ first: { combination_id: 'test-a-only', introduction_id: 'listen' }, second: { combination_id: 'test-b-only', introduction_id: 'guide' } }));
  const signal = new AbortController().signal;
  const output = await createClaudeProvider({ client })(structuredClone(ideasInput), { signal });
  const { body, options } = client.calls[0];
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.output_config.effort, 'low');
  assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.messages, [{ role: 'user', content: JSON.stringify(ideasInput) }]);
  const idea = body.output_config.format.schema.properties.first.properties;
  assert.deepEqual(idea.combination_id.enum, ['test-a-only', 'test-b-only']);
  assert.deepEqual(idea.introduction_id.enum, ['listen', 'describe', 'guide']);
  assert.equal(options.signal, signal);
  assert.deepEqual(validatedOutput(ideasInput, output).ideas.map(i => i.combination_id), ['test-a-only', 'test-b-only']);
});

test('reply requests leave out the student plan, artwork and store names', async () => {
  const sent = JSON.stringify(replyInput);
  for (const secret of ['내 구상 메모', '비밀 작품', '우리 가게']) assert.ok(!sent.includes(secret), secret);
  assert.deepEqual(schemaFor(replyInput).properties.reply_id.enum, ['ask', 'guide', 'choice']);
  const output = await createClaudeProvider({ client: fakeClient(answer({ reply_id: 'guide' })) })(replyInput);
  assert.deepEqual(validatedOutput(replyInput, output), { reply_id: 'guide' });
});

test('refusals, truncation and unreadable answers fail so the example is used instead', async () => {
  for (const response of [answer({ reply_id: 'guide' }, 'refusal'), answer({ reply_id: 'guide' }, 'max_tokens'),
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }, { stop_reason: 'end_turn', content: [] }]) {
    await assert.rejects(createClaudeProvider({ client: fakeClient(response) })(replyInput));
  }
  // An answer outside the options is still refused by the existing check.
  const stray = await createClaudeProvider({ client: fakeClient(answer({ reply_id: 'invented' })) })(replyInput);
  assert.throws(() => validatedOutput(replyInput, stray));
});
