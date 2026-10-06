import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';

const MAX_PROMPT_LENGTH = 4000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 20, windowMs: 60 * 1000, keyPrefix: 'enhance' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { prompt, licenseKey } = req.body || {};

  if (!licenseKey) return res.status(403).json({ error: 'Invalid or expired license' });
  if (typeof prompt !== 'string' || prompt.length === 0) return res.status(400).json({ error: 'Missing prompt' });
  if (prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: 'Prompt too long' });

  const { data: license, error: licenseError } = await supabase
    .from('licenses')
    .select('plan, status')
    .eq('license_key', licenseKey)
    .single();

  if (licenseError || !license || license.status !== 'active' || license.plan === 'free') {
    return res.status(403).json({ error: 'Invalid or expired license' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a UI prompt engineer. Rewrite raw CSS/layout specs into a clean, concise, natural-language prompt an AI coding assistant can use to rebuild the exact design. Keep all measurements and colors precise.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      console.error('OpenAI request failed with status', response.status);
      return res.status(500).json({ error: 'Enhancement failed' });
    }

    const data = await response.json();
    const enhanced = data?.choices?.[0]?.message?.content;
    if (!enhanced) {
      return res.status(500).json({ error: 'Enhancement failed' });
    }

    res.status(200).json({ enhanced });
  } catch (err) {
    console.error('Enhancement failed');
    res.status(500).json({ error: 'Enhancement failed' });
  }
}
