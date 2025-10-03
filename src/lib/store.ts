import type { Env } from '../types';
import { Event } from './extract';

export async function upsertCandidate(
  env: Env,
  id: string,
  url: string,
  attrs: { school?: string; degree?: string },
) {
  await env.DB.prepare(
    `
    INSERT OR REPLACE INTO candidates (id, url, school, degree)
    VALUES (?1, ?2, ?3, ?4)
  `,
  )
    .bind(id, url, attrs.school || null, attrs.degree || null)
    .run();
}

export async function insertEvents(
  env: Env,
  candidateId: string,
  events: Event[],
) {
  const stmt = env.DB.prepare(`
    INSERT OR REPLACE INTO events (id, candidate_id, role, org, start_iso, end_iso, acad_year, ord)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `);

  for (const e of events) {
    const eid = `${candidateId}:${e.ord}`;
    await stmt
      .bind(
        eid,
        candidateId,
        e.role,
        e.org,
        e.start_iso,
        e.end_iso,
        e.acad_year,
        e.ord,
      )
      .run();
  }
}

export async function upsertEventVector(
  env: Env,
  id: string,
  candidateId: string,
  ord: number,
  vec: number[],
) {
  // Store as binary blob
  const buf = new Float32Array(vec).buffer;
  await env.DB.prepare(
    'INSERT OR REPLACE INTO event_vectors (id, candidate_id, ord, vec) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(id, candidateId, ord, new Uint8Array(buf))
    .run();
}
