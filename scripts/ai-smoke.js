// Smoke test for the Anthropic SDK + API key. Run with:
//   node --env-file=.env scripts/ai-smoke.js
// Confirms the key loads, the SDK works, and a Haiku call returns
// successfully. Should cost <$0.001.

import Anthropic from '@anthropic-ai/sdk';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not found. Did you create .env at the repo root with the key?');
  process.exit(1);
}

const client = new Anthropic();

const response = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'Say hello in one word.' }],
});

console.log('key loaded:', true);
console.log('model:    ', response.model);
console.log('usage:    ', response.usage);
console.log('response: ', response.content[0].text);
