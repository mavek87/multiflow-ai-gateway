import { test, expect, describe } from 'bun:test';
import { stripThinkTags } from './text';

describe('Text Utilities', () => {
  test('stripThinkTags removes think blocks', () => {
    const input = '<think>some reasoning</think>Actual answer';
    expect(stripThinkTags(input)).toBe('Actual answer');
  });

  test('stripThinkTags handles multiline reasoning', () => {
    const input = '<think>\nline 1\nline 2\n</think>Hello';
    expect(stripThinkTags(input)).toBe('Hello');
  });

  test('stripThinkTags returns original string if no tags present', () => {
    const input = 'Plain text';
    expect(stripThinkTags(input)).toBe('Plain text');
  });

  test('stripThinkTags handles multiple think blocks', () => {
    const input = '<think>A</think> Middle <think>B</think> End';
    expect(stripThinkTags(input)).toBe('Middle  End');
  });
});
