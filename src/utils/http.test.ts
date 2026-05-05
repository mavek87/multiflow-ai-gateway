import { test, expect, describe } from 'bun:test';
import * as http from '@/utils/http';

describe('HTTP Utilities', () => {
  test('badRequestResponse returns 400', async () => {
    const res = http.badRequestResponse('err');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'err' });
  });

  test('unauthorizedResponse returns 401', () => {
    expect(http.unauthorizedResponse().status).toBe(401);
  });

  test('forbiddenResponse returns 403', () => {
    expect(http.forbiddenResponse().status).toBe(403);
  });

  test('notFoundResponse returns 404', () => {
    expect(http.notFoundResponse().status).toBe(404);
  });

  test('conflictResponse returns 409', () => {
    expect(http.conflictResponse().status).toBe(409);
  });

  test('internalErrorResponse returns 500', () => {
    expect(http.internalErrorResponse().status).toBe(500);
  });

  test('createdResponse returns 201 with body', async () => {
    const data = { id: 1 };
    const res = http.createdResponse(data);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(data);
  });
});
