// SplitPay — Cloudflare Worker
// Proxies requests to Anthropic API to bypass browser CORS restrictions
// Deploy this at: https://workers.cloudflare.com

const ALLOWED_ORIGIN = 'https://neilson2005.github.io';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only allow POST from our GitHub Pages domain
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const origin = request.headers.get('Origin') || '';
    if (!origin.startsWith(ALLOWED_ORIGIN)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await request.text();

      // Forward to Anthropic — API key stored as Worker secret
      const resp = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body,
      });

      const data = await resp.text();

      return new Response(data, {
        status: resp.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
      });
    }
  },
};
