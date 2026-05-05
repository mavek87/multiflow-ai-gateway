import { describe, test, expect } from 'bun:test';
import { createModelSelector } from '@/engine/selection/model-selector.factory';
import { UCB1TunedSelector } from '@/engine/selection/algorithms/ucb1-tuned';
import { SWUcb1TunedSelector } from '@/engine/selection/algorithms/sw-ucb1-tuned';
import { ThompsonSelector } from '@/engine/selection/algorithms/thompson';

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
