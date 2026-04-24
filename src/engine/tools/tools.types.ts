export interface ToolParameter {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object';
  description?: string;
  enum?: string[];
}

export interface ToolFunction {
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
