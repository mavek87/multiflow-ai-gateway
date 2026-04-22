export type AIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export interface AIBaseResponse {
  model: string;
  aiProvider: string;
}

export interface AIChatResponse extends AIBaseResponse {
  content: string;
}

export interface AIChatStreamResponse extends AIBaseResponse {
  body: ReadableStream<Uint8Array>;
}

export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

export type ModelConfig = {
  url: string;
  model: string;
  apiKey?: string;
  priority?: number;
  aiProviderId?: string;
  aiProviderModelId?: string;
};

interface ToolParameter {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object';
  description?: string;
  enum?: string[];
}

interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolDefinition {
  type: 'function';
  function: ToolFunction;
}

export interface ToolContext {
  tenantId: string;
  tenantName?: string;
}

export type ToolDispatcher = (
  name: string,
  args: Record<string, unknown>,
  ctx?: ToolContext,
) => Promise<string>;

export interface AIClient {
  chat(messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): Promise<AIChatResponse>;
  chatStream?(messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): AsyncGenerator<string>;
  openStream?(messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): Promise<AIChatStreamResponse | null>;
  setTools?(tools: ToolDefinition[], dispatcher: ToolDispatcher): void;
  getTools?(): ToolDefinition[] | undefined;
}
