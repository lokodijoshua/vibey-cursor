import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';
import { config } from '../lib/config.js';
import { AI_MODEL, estimateCostUsd, estimateInputTokens } from '../lib/ai-costs.js';
import { findLicense, entitlementFor, openActivations, hashIdentity, recordEvent } from '../lib/licensing.js';
import crypto from 'crypto';

// POST /api/enhance { prompt, licenseKey, installationId? }
// Server-side Pro AI proxy with cost protection:
// - valid license + active Pro entitlement (subscription-derived, never client flags)
// - installation must hold an open activation slot when installationId given
// - PRO_ENHANCE_LIMIT OpenAI calls per license per rolling 24h
// - input length cap; prompt content is never stored (hashes/metadata only)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 20, windowMs: 60 * 1000, keyPrefix: 'enhance' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { prompt, licenseKey, installationId } = req.body || {};

  if (!licenseKey) return res.status(403).json({ error: 'Invalid or expired license' });
  if (typeof prompt !== 'string' || prompt.length === 0) return res.status(400).json({ error: 'Missing prompt' });
  if (prompt.length > config.PRO_ENHANCE_MAX_CHARS) return res.status(400).json({ error: 'Prompt too long' });

  // Client-provided element metadata is informational only: capped, never
  // trusted for billing or security decisions. Sizes are recorded from the
  // server-measured prompt, not client claims.
  const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
  const elementType = typeof meta.elementType === 'string' ? meta.elementType.slice(0, 32) : null;

  const { license } = await findLicense(supabase, licenseKey);
  const { pro } = entitlementFor(license);
  if (!license || !pro) {
    return res.status(403).json({ error: 'Invalid or expired license' });
  }

  if (installationId) {
    try {
      const slots = await openActivations(supabase, license.id);
      if (!slots.find((s) => s.installation_id === installationId)) {
        return res.status(403).json({ error: 'Installation not activated', code: 'activation_required' });
      }
    } catch (err) {
      console.error('enhance activation check failed');
      return res.status(503).json({ error: 'Service temporarily unavailable', retry_after_seconds: config.QUOTA_UNAVAILABLE_RETRY_SECONDS });
    }
  }

  // Daily OpenAI cost ceiling per license (rolling 24h, server timestamps).
  const licenseHash = hashIdentity(`license:${license.id}`);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentEnhance, error: quotaError } = await supabase
    .from('usage_events')
    .select('id')
    .eq('identity_hash', licenseHash)
    .eq('operation', 'enhance')
    .eq('result', 'allowed')
    .gte('created_at', since);
  if (quotaError) {
    console.error('enhance quota read failed');
    return res.status(503).json({ error: 'Service temporarily unavailable', retry_after_seconds: config.QUOTA_UNAVAILABLE_RETRY_SECONDS });
  }
  if ((recentEnhance || []).length >= config.PRO_ENHANCE_LIMIT) {
    try {
      await recordEvent(supabase, { identityHash: licenseHash, identityType: 'license', operation: 'enhance', result: 'denied' });
    } catch (err) {
      console.error('enhance deny-record failed');
    }
    return res.status(429).json({ error: 'Daily enhancement limit reached', code: 'quota_exceeded', retry_after_seconds: 3600 });
  }

  const requestId = crypto.randomUUID();
  const installationHash = installationId ? hashIdentity(`install:${installationId}`) : null;
  const t0 = Date.now();

  async function recordAi(partial) {
    try {
      await supabase.from('ai_usage_events').insert({
        license_id: license.id,
        installation_hash: installationHash,
        operation: 'enhance',
        element_type: elementType,
        prompt_chars: prompt.length,
        estimated_input_tokens: estimateInputTokens(prompt.length),
        model: AI_MODEL,
        latency_ms: Date.now() - t0,
        request_id: requestId,
        ...partial,
      });
    } catch (err) {
      console.error('ai usage record failed');
    }
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
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
      await recordAi({
        status: 'failed',
        error_category: response.status < 500 ? 'upstream-4xx' : 'upstream-5xx',
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        estimated_cost_usd: null,
      });
      return res.status(500).json({ error: 'Enhancement failed' });
    }

    const data = await response.json();
    const enhanced = data?.choices?.[0]?.message?.content;
    if (!enhanced) {
      await recordAi({ status: 'failed', error_category: 'empty-response', input_tokens: null, output_tokens: null, total_tokens: null, estimated_cost_usd: null });
      return res.status(500).json({ error: 'Enhancement failed' });
    }

    // Authoritative usage comes from the OpenAI response — never estimates,
    // never client values.
    const usage = data?.usage || {};
    const inputTokens = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
    const outputTokens = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
    const totalTokens = Number.isFinite(usage.total_tokens) ? usage.total_tokens : null;
    const cachedInput = Number.isFinite(usage?.prompt_tokens_details?.cached_tokens)
      ? usage.prompt_tokens_details.cached_tokens
      : null;

    await recordAi({
      status: 'allowed',
      error_category: null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cached_input_tokens: cachedInput,
      estimated_cost_usd: estimateCostUsd(AI_MODEL, inputTokens, outputTokens),
    });

    try {
      await recordEvent(supabase, { identityHash: licenseHash, identityType: 'license', operation: 'enhance', result: 'allowed' });
    } catch (err) {
      console.error('enhance allow-record failed');
    }

    res.status(200).json({ enhanced });
  } catch (err) {
    console.error('Enhancement failed');
    await recordAi({ status: 'failed', error_category: 'exception', input_tokens: null, output_tokens: null, total_tokens: null, estimated_cost_usd: null });
    res.status(500).json({ error: 'Enhancement failed' });
  }
}
