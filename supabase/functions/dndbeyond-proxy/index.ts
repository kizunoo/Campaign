// Supabase Edge Function: dndbeyond-proxy
//
// Fetches a character from D&D Beyond's unofficial character-service
// API on the SERVER SIDE and returns the JSON to your page. This sidesteps
// the browser CORS restriction entirely, since the restriction only applies
// to requests made from a browser tab — server-to-server calls aren't
// subject to it. No third-party proxy needed.
//
// Deploy:
//   supabase functions deploy dndbeyond-proxy --no-verify-jwt
//
// Call from the browser:
//   https://<your-project-ref>.functions.supabase.co/dndbeyond-proxy?id=168259911
//
// Only works for characters whose D&D Beyond sharing setting is "Public".

import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';

const ALLOWED_ORIGIN = '*'; // tighten to your site's domain once this is live

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id || !/^\d+$/.test(id)) {
        return new Response(JSON.stringify({ error: 'Missing or invalid ?id= character id' }), {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    }

    try {
        const upstream = await fetch(
            `https://character-service.dndbeyond.com/character/v5/character/${id}`,
            { headers: { Accept: 'application/json' } }
        );

        if (!upstream.ok) {
            return new Response(
                JSON.stringify({ error: `D&D Beyond returned ${upstream.status}`, id }),
                { status: upstream.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
            );
        }

        const data = await upstream.json();
        return new Response(JSON.stringify(data), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Upstream fetch failed', detail: String(err) }), {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    }
});