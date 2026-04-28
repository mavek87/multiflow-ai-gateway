export function badRequestResponse(message?: string): Response {
  return Response.json({ error: message ?? 'Bad Request' }, { status: 400 });
}

export function unauthorizedResponse(message?: string): Response {
  return Response.json({ error: message ?? 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse(message?: string): Response {
  return Response.json({ error: message ?? 'Forbidden' }, { status: 403 });
}

export function notFoundResponse(message?: string): Response {
  return Response.json({ error: message ?? 'Not Found' }, { status: 404 });
}

export function unprocessableResponse(message?: string): Response {
  return Response.json({ error: message ?? 'Unprocessable Entity' }, { status: 422 });
}

export function internalErrorResponse(message?: string): Response {
  return Response.json({ error: message ?? 'Internal Server Error' }, { status: 500 });
}

export function conflictResponse(message?: string): Response {
  return Response.json({ error: message ?? 'Already exists' }, { status: 409 });
}

export function createdResponse(data: unknown): Response {
  return Response.json(data, { status: 201 });
}

export function tooManyRequestsResponse(message?: string): Response {
  return Response.json({ error: message ?? 'Too Many Requests' }, { status: 429 });
}
