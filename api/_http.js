export function applyApiHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

export function requireMethod(request, response, methods) {
  if (methods.includes(request.method)) return true;
  response.setHeader('Allow', methods.join(', '));
  response.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: `Use ${methods.join(' or ')}` } });
  return false;
}

export function authorize(request, response, env = process.env) {
  const expected = env.STRATUS_API_KEY?.trim();
  if (!expected) {
    if (env.VERCEL_ENV !== 'production') return true;
    response.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Stratus production authentication is not configured' } });
    return false;
  }
  if (request.headers['x-stratus-api-key'] === expected) return true;
  response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'A valid X-Stratus-API-Key header is required' } });
  return false;
}

export function sendError(response, error) {
  const status = Number(error?.status) || 500;
  response.status(status).json({ error: { code: error?.code || 'INTERNAL_ERROR', message: status >= 500 && !error?.code ? 'The request could not be completed' : error.message } });
}
