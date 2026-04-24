import { describe, test, expect, spyOn, beforeEach } from 'bun:test';
import { AuditedAIClient } from './audit.ai-client.decorator';
import * as auditLog from './audit.log';
import type { AIClient, AIChatResponse, AIChatStreamResponse } from '@/engine/client/client.types';

describe('AuditedAIClient', () => {
  let mockClient: AIClient;
  let logAuditSpy: any;

  beforeEach(() => {
    logAuditSpy = spyOn(auditLog, 'logAudit');
    logAuditSpy.mockClear();
    mockClient = {
      chat: async () => ({
        content: 'test',
        model: 'test-model',
        aiProvider: 'test-provider',
        aiProviderUrl: 'http://test',
      } as AIChatResponse),
      chatStream: async () => ({
        body: new ReadableStream(),
        model: 'test-model',
        aiProvider: 'test-provider',
        aiProviderUrl: 'http://test',
      } as AIChatStreamResponse),
    } as any;
  });

  test('logs audit on successful chat', async () => {
    const audited = new AuditedAIClient(mockClient);
    await audited.chat('system', [{ role: 'user', content: 'hi' }], { tenantId: 't1' } as any);

    expect(logAuditSpy).toHaveBeenCalled();
    const entry = logAuditSpy.mock.calls[0][0];
    expect(entry.tenantId).toBe('t1');
    expect(entry.success).toBe(true);
    expect(entry.model).toBe('test-model');
  });

  test('logs audit on failure (exception)', async () => {
    mockClient.chat = async () => { throw new Error('fail'); };
    const audited = new AuditedAIClient(mockClient);

    try {
      await audited.chat('system', [{ role: 'user', content: 'hi' }], { tenantId: 't2' } as any);
    } catch {
      // expected
    }

    expect(logAuditSpy).toHaveBeenCalled();
    const entry = logAuditSpy.mock.calls[0][0];
    expect(entry.tenantId).toBe('t2');
    expect(entry.success).toBe(false);
    expect(entry.statusCode).toBe(500);
  });

  test('logs audit on null response', async () => {
    mockClient.chatStream = async () => null;
    const audited = new AuditedAIClient(mockClient);
    await audited.chatStream('system', [{ role: 'user', content: 'hi' }], { tenantId: 't3' } as any);

    expect(logAuditSpy).toHaveBeenCalled();
    const entry = logAuditSpy.mock.calls[0][0];
    expect(entry.tenantId).toBe('t3');
    expect(entry.success).toBe(false);
    expect(entry.statusCode).toBe(503);
  });
});
