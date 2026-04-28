// ================================================================
// SplitPay — Cloudflare Worker
// Securely proxies requests to Google Gemini API.
// The GEMINI_API_KEY is stored as a Cloudflare Worker Secret —
// it is NEVER sent to the browser or visible in your GitHub code.
//
// Deploy at: https://workers.cloudflare.com
// After deploying, add secret: GEMINI_API_KEY = AIzaSy...
// ================================================================

const ALLOWED_ORIGIN = 'https://neilson2005.github.io';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export default {
  async fetch(request, env) {

    // CORS preflight
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

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const origin = request.headers.get('Origin') || '';
    if (!origin.startsWith('https://neilson2005.github.io')) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!env.GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY secret not configured in Worker' }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN } }
      );
    }

    try {
      const body = await request.json();
      const { imageBase64, mimeType } = body;

      if (!imageBase64) {
        return new Response(
          JSON.stringify({ error: 'Missing imageBase64 in request body' }),
          { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN } }
        );
      }

      const geminiPayload = {
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: mimeType || 'image/jpeg',
                data: imageBase64,
              }
            },
            {
              text: `You are a receipt scanner. Carefully read this receipt image and extract all visible information.

Extract:
1. Store or restaurant name (header text at top)
2. Grand total — look for: TOTAL, GRAND TOTAL, JUMLAH, AMAUN, Amount Due. Use FINAL total after tax, NOT subtotal.
3. Category — reply EXACTLY one of: Food, Transport, Hotel, Shopping, Entertainment, Health, Utilities, Other
   - Nasi lemak, kopi, makan, restaurant, cafe, hawker, kopitiam, food court = Food
   - Grab, taxi, parking, petrol, toll, LRT, MRT = Transport
   - Hotel, resort, airbnb = Hotel
   - Pharmacy, clinic, hospital = Health
   When in doubt, choose Food.
4. Date if visible (YYYY-MM-DD, empty string if not found)
5. All line items with prices

Rules:
- If Subtotal then Total shown — use Total (the larger final number)
- Currency is MYR unless different symbol shown
- Receipt may be in Malay, Chinese, or English

Respond with ONLY this JSON, no markdown, no extra text:
{"name":"store name","total":0.00,"currency":"MYR","category":"Food","date":"","items":[{"desc":"item name","price":0.00}]}`
            }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
      };

      const geminiResp = await fetch(
        `${GEMINI_API_BASE}?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload),
        }
      );

      if (!geminiResp.ok) {
        const errText = await geminiResp.text();
        return new Response(
          JSON.stringify({ error: `Gemini API error: ${geminiResp.status}`, detail: errText }),
          { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN } }
        );
      }

      const geminiData = await geminiResp.json();
      const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

      return new Response(
        JSON.stringify({ result: text }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN } }
      );

    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN } }
      );
    }
  },
};
