import { describe, test, expect } from 'bun:test';
import { parseJsonBody } from './openai-response-parser';
import { createFakeToolCallResponse } from '@test/fixtures/chat-fixtures';

describe('parseJsonBody', () => {
  test('extracts content from a valid response', () => {
    const result = parseJsonBody({
      choices: [{ message: { content: 'hello', tool_calls: undefined } }],
    });
    expect(result.content).toBe('hello');
    expect(result.toolCalls).toBeUndefined();
  });

  test('extracts tool_calls when present', () => {
    const response = createFakeToolCallResponse('call_1', 'get_weather', '{}');
    const result = parseJsonBody(response as any);
    expect(result.toolCalls).toEqual(response.choices[0]!.message.tool_calls);
  });

  test('returns empty content when choices is missing', () => {
    const result = parseJsonBody({});
    expect(result.content).toBe('');
    expect(result.toolCalls).toBeUndefined();
  });

  test('returns empty content when message is missing', () => {
    const result = parseJsonBody({ choices: [{}] });
    expect(result.content).toBe('');
  });
});
