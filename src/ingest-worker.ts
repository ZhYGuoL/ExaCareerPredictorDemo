import type { Env } from './types';
import { exaContents } from './lib/exa';
import { extractLLM } from './lib/extract';
import { upsertCandidate, insertEvents, upsertEventVector } from './lib/store';
import { embedEvent, upsertEmbedding } from './lib/embed';

async function hashUrl(url: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(url),
  );
  return Array.from(new Uint8Array(buf))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

// Filter function to check if a URL is likely a person's profile
function isPersonProfile(url: string): boolean {
  // LinkedIn profile URLs follow the pattern linkedin.com/in/username
  if (url.includes('linkedin.com/in/')) {
    return true;
  }

  // Reject job listings, applications, posts, and non-profile URLs
  const nonProfilePatterns = [
    '/job/',
    '/jobs/',
    'job-listing',
    'talentsprint',
    'talentify',
    'glassdoor',
    'builtin',
    'workday',
    '/applications/',
    'jointaro',
    'reddit.com',
    'chronicle.com',
    'linkedin.com/posts/',
    'activity-',
    '/job',
    'careers',
    'ziprecruiter',
    'indeed',
    'pulse'
  ];
  
  for (const pattern of nonProfilePatterns) {
    if (url.includes(pattern)) {
      return false;
    }
  }

  // For other URLs, let's assume they might be personal websites
  return true;
}

export default {
  async queue(batch: MessageBatch<string>, env: Env) {
    for (const msg of batch.messages) {
      const url = msg.body;
      try {
        // Skip URLs that are not likely person profiles
        if (!isPersonProfile(url)) {
          console.log(`Skipping non-profile URL: ${url}`);
          msg.ack();
          continue;
        }
        const page = await exaContents(env, [url]);
        const key = `raw/${await hashUrl(url)}.json`;
        await env.BLOB.put(key, JSON.stringify(page));
        console.log('Saved raw:', key);

        // Extract events from the page using LLM (with fallback to heuristic)
        const candidateId = await hashUrl(url);
        await upsertCandidate(env, candidateId, url, {});

        const text = (page as any)?.results?.[0]?.text || '';
        const events = await extractLLM(env, text);
        await insertEvents(env, candidateId, events);
        console.log(`Stored ${events.length} events for ${url}`);

        // Generate embeddings for events
        for (const e of events) {
          const text = `${e.acad_year} | ${e.role} | ${e.org}`.trim();
          if (text.length > 0) {
            try {
              const eid = `${candidateId}:${e.ord}`;
              const embedding = await embedEvent(env, text);
              console.log(`Embedding length: ${embedding.length}`);

              // Store embedding in Vectorize
              await upsertEmbedding(env, eid, embedding, {
                candidate_id: candidateId,
                ord: e.ord,
                role: e.role,
                org: e.org,
                acad_year: e.acad_year,
                url: url,
              });

              // Store embedding in D1
              await upsertEventVector(env, eid, candidateId, e.ord, embedding);
              console.log(`Vector stored in Vectorize + D1: ${eid}`);
            } catch (embErr) {
              console.error('Error generating embedding:', embErr);
            }
          }
        }

        msg.ack();
      } catch (err) {
        console.error('Error processing URL:', url, err);
        msg.retry();
      }
    }
  },
};
