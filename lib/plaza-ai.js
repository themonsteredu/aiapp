'use strict';
// Server-side Claude adapter for the plaza (docs/plaza-design.md: AI runs on the server).
// It receives only lib/plaza-program.js aiInput(): the customer card, the kit options the teacher
// approved and, for replies, the request and reply choices. No student ID, name, photo or free text.
// The answer is constrained to those option IDs by the JSON schema and checked again by
// validatedOutput(); any failure, refusal or timeout falls back to the prepared example.
const { Anthropic } = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-opus-5-5';
const SYSTEM = `You help a teacher run a hands-on career class for school students in Korea.
Students pick a customer card and kit materials. You choose among options the teacher already approved;
you never write new text, product claims, health effects, amounts or ratios.
For "ideas": choose two different ideas. Each idea is one combination_id and one introduction_id from the lists.
Prefer the combinations and introductions that best suit the customer's situation, and make the two ideas meaningfully different.
For "reply": choose the reply_id that best answers the visitor's request for that customer.
Answer only with the JSON the schema asks for.`;

const ids = list => list.map(item => item.id);
function schemaFor(input) {
  if (input.kind === 'reply') {
    return { type: 'object', additionalProperties: false, required: ['reply_id'],
      properties: { reply_id: { type: 'string', enum: ids(input.reply_options) } } };
  }
  const idea = { type: 'object', additionalProperties: false, required: ['combination_id', 'introduction_id'],
    properties: { combination_id: { type: 'string', enum: ids(input.combinations) }, introduction_id: { type: 'string', enum: ids(input.introductions) } } };
  return { type: 'object', additionalProperties: false, required: ['first', 'second'], properties: { first: idea, second: idea } };
}

function createClaudeProvider({ apiKey, model = DEFAULT_MODEL, client } = {}) {
  // One attempt per student action: the caller already bounds time and falls back to the example.
  const anthropic = client || new Anthropic({ apiKey, maxRetries: 0 });
  async function provider(input, { signal } = {}) {
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: schemaFor(input) } },
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    }, { signal });
    if (response.stop_reason !== 'end_turn') throw new Error(`plaza ai stopped: ${response.stop_reason}`);
    const text = response.content.find(block => block.type === 'text');
    if (!text) throw new Error('plaza ai returned no answer');
    const answer = JSON.parse(text.text);
    return input.kind === 'reply' ? { reply_id: answer.reply_id } : { ideas: [answer.first, answer.second] };
  }
  // Leaves room inside the 20 s window after which a running suggestion is recovered as an example.
  provider.timeoutMs = 15000;
  provider.model = model;
  return provider;
}

// Enabled only when asked for by name and given a key; otherwise the plaza keeps using examples.
function plazaAiFromEnv(env = process.env) {
  if (env.PLAZA_AI_PROVIDER !== 'anthropic' || !env.ANTHROPIC_API_KEY) return null;
  return createClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.PLAZA_AI_MODEL || DEFAULT_MODEL });
}

module.exports = { DEFAULT_MODEL, SYSTEM, schemaFor, createClaudeProvider, plazaAiFromEnv };
