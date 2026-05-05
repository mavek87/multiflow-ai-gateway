import { UCB1TunedSelector } from '@/engine/selection/algorithms/ucb1-tuned';
import { SWUcb1TunedSelector } from '@/engine/selection/algorithms/sw-ucb1-tuned';
import { ThompsonSelector } from '@/engine/selection/algorithms/thompson';
import type { ModelSelector, ModelSelectorType } from '@/engine/selection/model-selector.types';

export function createModelSelector(type: ModelSelectorType): ModelSelector {
    switch (type) {
        case 'thompson': return new ThompsonSelector();
        case 'ucb1-tuned': return new UCB1TunedSelector();
        case 'sw-ucb1-tuned': return new SWUcb1TunedSelector();
        default: throw new Error(`Unknown model selector type: "${type as string}"`);
    }
}
