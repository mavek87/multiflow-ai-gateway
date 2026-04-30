import type { Tenant } from '@/tenant/tenant.types';
import type { ModelConfig } from '@/engine/client/client.types';

export const fakeTenant: Tenant = { 
  id: 'tenant-1', 
  name: 'Test Tenant', 
  forceAiProviderId: null, 
  rateLimitDailyRequests: null, 
  createdAt: Date.now() 
};

export const fakeModelConfigs: ModelConfig[] = [
  { 
    url: 'https://api.openai.com/v1/chat/completions', 
    model: 'gpt-4o', 
    apiKey: 'sk-fake-key',
    aiProviderId: 'prov-1',
    aiProviderName: 'openai'
  }
];

export function createFakeChatCompletionResponse(content: string = 'Mocked reply') {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o',
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop'
    }]
  };
}

export function createFakeToolCallResponse(toolCallId: string, functionName: string, args: string) {
  const toolCall = {
    id: toolCallId,
    type: 'function' as const,
    function: {name: functionName, arguments: args},
  };

  return {
    id: 'chatcmpl-tool',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o',
    choices: [{
      index: 0,
      message: {role: 'assistant', content: null, tool_calls: [toolCall]},
      finish_reason: 'tool_calls'
    }]
  };
}
