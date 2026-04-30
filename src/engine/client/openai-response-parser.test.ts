import { describe, test, expect } from 'bun:test';
import { parseJsonResponse } from './openai-response-parser';
import { createFakeToolCallResponse } from '@test/fixtures/chat-fixtures';

function fakeResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

describe('parseJsonResponse', () => {
  test('extracts content from a valid response', async () => {
    const result = await parseJsonResponse(fakeResponse({ choices: [{ message: { content: 'hello' } }] }), Date.now());
    expect(result.content).toBe('hello');
    expect(result.toolCalls).toBeUndefined();
  });

  test('extracts tool_calls when present', async () => {
    const body = createFakeToolCallResponse('call_1', 'get_weather', '{}');
    const result = await parseJsonResponse(fakeResponse(body), Date.now());
    expect(result.toolCalls).toEqual(body.choices[0]!.message.tool_calls);
  });

  test('returns empty content when choices is missing', async () => {
    const result = await parseJsonResponse(fakeResponse({}), Date.now());
    expect(result.content).toBe('');
    expect(result.toolCalls).toBeUndefined();
  });

  test('returns empty content when message is missing', async () => {
    const result = await parseJsonResponse(fakeResponse({ choices: [{}] }), Date.now());
    expect(result.content).toBe('');
  });

  test('includes rawBody', async () => {
    const body = { choices: [{ message: { content: 'hi' } }] };
    const result = await parseJsonResponse(fakeResponse(body), Date.now());
    expect(result.rawBody).toMatchObject(body);
  });
});
