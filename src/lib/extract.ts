import type { Env } from '../types';

export interface Event {
  role: string;
  org: string;
  start_iso: string | null;
  end_iso: string | null;
  acad_year: string;
  ord: number;
}

/**
 * Extract career events from text using Workers AI LLM with structured JSON output.
 * Retries up to 2 times if JSON parsing fails, then falls back to heuristic extraction.
 */
export async function extractLLM(env: Env, text: string): Promise<Event[]> {
  const system = `You extract structured career timeline events from free-form text.
Return STRICT JSON only with shape: {"events":[{"role":string,"org":string,"start_iso":string|null,"end_iso":string|null,"acad_year":string,"ord":number}]}
Rules:
- role: concise (e.g., "Software Engineering Intern")
- org: company or lab (e.g., "Google", "UIUC ML Lab")
- dates: ISO-8601 "YYYY-MM" if known else null
- acad_year: one of "freshman","sophomore","junior","senior","unknown"
- ord: increasing from 0 in event order
- No prose, no markdown; JSON ONLY.`;

  const prompt = `TEXT:\n${text.slice(0, 3000)}\nJSON ONLY:`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_tokens: 800,
        temperature: 0.2,
      });

      const raw =
        typeof res === 'string'
          ? res
          : res?.response || res?.result || res?.output || '';

      // Try to extract JSON from response (model might wrap in markdown or add text)
      let jsonStr = raw.trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*"events"[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const json = JSON.parse(jsonStr);
      const events = Array.isArray(json?.events) ? json.events : [];

      // Sanitize and reindex ord
      const sanitized = events.map((e: any, i: number) => ({
        role: String(e.role || '').slice(0, 200),
        org: String(e.org || '').slice(0, 200),
        start_iso: e.start_iso ?? null,
        end_iso: e.end_iso ?? null,
        acad_year: ['freshman', 'sophomore', 'junior', 'senior'].includes(
          (e.acad_year || '').toLowerCase(),
        )
          ? e.acad_year || 'unknown'
          : 'unknown',
        ord: i,
      }));

      if (sanitized.length > 0) {
        console.log(
          `[LLM Extract] Found ${sanitized.length} events (attempt ${attempt + 1})`,
        );
        return sanitized;
      }
    } catch (err) {
      console.warn(
        `[LLM Extract] Attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Fallback: heuristic extraction
  console.log('[LLM Extract] Falling back to heuristic extraction');
  return extractEvents({ results: [{ text }] });
}

/**
 * Heuristic event extractor (fallback).
 * Looks for keywords like "intern", "research", "offer" in text lines.
 */
export function extractEvents(page: any): Event[] {
  const text = page?.results?.[0]?.text || '';
  const lines = text.split(/\n+/);
  const events: Event[] = [];
  let ord = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes('intern') ||
      lower.includes('research') ||
      lower.includes('offer')
    ) {
      events.push({
        role: line.trim(),
        org: 'unknown',
        start_iso: null,
        end_iso: null,
        acad_year: 'unknown',
        ord: ord++,
      });
    }
  }
  return events;
}

export function inferAcademicYear(_date: string, _gradYear: number): string {
  // stub: real logic later
  return 'unknown';
}
