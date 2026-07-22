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

export async function authorize(request, response, env = process.env, verifyOidc = verifyLitosOidcToken) {
  const expected = env.STRATUS_API_KEY?.trim();
  if (expected && request.headers['x-stratus-api-key'] === expected) return true;
  if (env.VERCEL_ENV !== 'production' && !expected) return true;
  const authorization = request.headers.authorization;
  const token = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  if (token) {
    try {
      await verifyOidc(token);
      return true;
    } catch {
      // The response below intentionally does not reveal which claim failed.
    }
  }
  response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'A valid Litos service identity is required' } });
  return false;
}

export function sendError(response, error) {
  const status = Number(error?.status) || 500;
  response.status(status).json({ error: { code: error?.code || 'INTERNAL_ERROR', message: status >= 500 && !error?.code ? 'The request could not be completed' : error.message } });
}
import { createRemoteJWKSet, jwtVerify } from 'jose';

const VERCEL_ISSUER = 'https://oidc.vercel.com/mehek-builds-projects';
const VERCEL_AUDIENCE = 'https://vercel.com/mehek-builds-projects';
const LITOS_PRODUCTION_SUBJECT = 'owner:mehek-builds-projects:project:student-outreach-backend:environment:production';
const VERCEL_JWKS = createRemoteJWKSet(new URL(`${VERCEL_ISSUER}/.well-known/jwks`));

async function verifyLitosOidcToken(token) {
  await jwtVerify(token, VERCEL_JWKS, {
    issuer: VERCEL_ISSUER,
    audience: VERCEL_AUDIENCE,
    subject: LITOS_PRODUCTION_SUBJECT
  });
}
