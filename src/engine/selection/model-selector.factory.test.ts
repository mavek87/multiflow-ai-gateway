import { describe, test, expect } from 'bun:test';
import { createModelSelector } from './model-selector.factory';
import { UCB1TunedSelector } from './algorithms/ucb1-tuned';
import { SWUcb1TunedSelector } from './algorithms/sw-ucb1-tuned';
import { ThompsonSelector } from './algorithms/thompson';

describe('ModelSelectorFactory', () => {
  test('creates ThompsonSelector', () => {
    const selector = createModelSelector('thompson');
    expect(selector).toBeInstanceOf(ThompsonSelector);
  });

  test('creates UCB1TunedSelector', () => {
    const selector = createModelSelector('ucb1-tuned');
    expect(selector).toBeInstanceOf(UCB1TunedSelector);
  });

  test('creates SWUcb1TunedSelector', () => {
    const selector = createModelSelector('sw-ucb1-tuned');
    expect(selector).toBeInstanceOf(SWUcb1TunedSelector);
  });
});
