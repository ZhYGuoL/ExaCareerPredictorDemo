import type { Env } from './types';
import { embedEvent } from './lib/embed';
import { goalProximity } from './lib/companyGraph';

// Generate short request ID for tracing
function rid(): string {
  return Math.random().toString(16).slice(2, 10);
}

// Cache helper: SHA-1 hash of object for cache key
async function sha1(obj: any): Promise<string> {
  const s = JSON.stringify(obj);
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type CacheEntry = { value: any; ts: number };

function cosineSim(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

function softDTWFromCosine(X: number[][], Y: number[][], gamma = 0.1): number {
  const m = X.length,
    n = Y.length;
  // D[i][j] = distance between events i and j (1 - cosine)
  const D = Array.from({ length: m }, () => Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      D[i][j] = 1 - cosineSim(X[i], Y[j]);
    }
  }

  // Soft-DTW DP
  const R = Array.from({ length: m + 1 }, () => Array(n + 1).fill(Infinity));
  R[0][0] = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const a = R[i - 1][j];
      const b = R[i][j - 1];
      const c = R[i - 1][j - 1];
      const minSoft =
        -gamma *
        Math.log(
          Math.exp(-a / gamma) + Math.exp(-b / gamma) + Math.exp(-c / gamma),
        );
      R[i][j] = D[i - 1][j - 1] + minSoft;
    }
  }
  return R[m][n]; // smaller is better
}

function toSimilarity(dist: number): number {
  return 1 / (1 + dist); // map to (0,1]
}

// Soft-DTW with alignment trace
function softDTWTrace(
  X: number[][],
  Y: number[][],
  gamma = 0.1,
): { dist: number; align: Array<{ x: number; y: number; dx: number }> } {
  const m = X.length,
    n = Y.length;
  const D = Array.from({ length: m }, () => Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      D[i][j] = 1 - cosineSim(X[i], Y[j]);
    }
  }

  // Soft-DTW DP with predecessor tracking
  const R = Array.from({ length: m + 1 }, () => Array(n + 1).fill(Infinity));
  const P = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0)); // 0=diag,1=up,2=left
  R[0][0] = 0;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const a = R[i - 1][j],
        b = R[i][j - 1],
        c = R[i - 1][j - 1];
      // Soft min for distance
      const ea = Math.exp(-a / gamma),
        eb = Math.exp(-b / gamma),
        ec = Math.exp(-c / gamma);
      const soft = -gamma * Math.log(ea + eb + ec);
      R[i][j] = D[i - 1][j - 1] + soft;

      // Hard choice for traceback (argmin)
      if (c <= a && c <= b) P[i][j] = 0;
      else if (a <= b) P[i][j] = 1;
      else P[i][j] = 2;
    }
  }

  // Traceback to get alignment path
  const path: Array<{ x: number; y: number; dx: number }> = [];
  let i = m,
    j = n;
  while (i > 0 && j > 0) {
    path.push({ x: i - 1, y: j - 1, dx: D[i - 1][j - 1] });
    const p = P[i][j];
    if (p === 0) {
      i--;
      j--;
    } else if (p === 1) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();

  return { dist: R[m][n], align: path };
}

async function loadSeq(env: Env, candidateId: string): Promise<number[][]> {
  const rs = await env.DB.prepare(
    'SELECT vec FROM event_vectors WHERE candidate_id = ?1 ORDER BY ord ASC',
  )
    .bind(candidateId)
    .all();

  const seq: number[][] = [];
  for (const row of rs.results || []) {
    const buf = row.vec as ArrayBuffer;
    // Reconstruct Float32Array from ArrayBuffer
    const f32 = new Float32Array(buf);
    seq.push(Array.from(f32));
  }
  return seq;
}

async function loadCandidateOrgs(
  env: Env,
  candidateId: string,
): Promise<string[]> {
  const rs = await env.DB.prepare(
    'SELECT org FROM events WHERE candidate_id = ?1 ORDER BY ord ASC',
  )
    .bind(candidateId)
    .all();
  return (rs.results || []).map((r: any) => r.org).filter(Boolean);
}

export class ReRanker {
  private cache = new Map<string, CacheEntry>(); // key -> { value, ts }
  private TTL_MS = 10 * 60 * 1000; // 10 minutes
  private MAX_SIZE = 200;
  private counters = { totalRequests: 0, cacheHits: 0, reranks: 0, errors: 0 };

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  // LRU touch: move key to end of map
  private touch(key: string) {
    const v = this.cache.get(key);
    if (!v) return;
    this.cache.delete(key);
    this.cache.set(key, v);
  }

  // Set cache with eviction
  private setCache(key: string, value: any) {
    // Evict expired entries
    const now = Date.now();
    for (const [k, entry] of this.cache) {
      if (now - entry.ts > this.TTL_MS) {
        this.cache.delete(k);
      }
    }

    // LRU size cap: evict oldest entries
    while (this.cache.size >= this.MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.cache.set(key, { value, ts: now });
  }

  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);

    // Handle /metrics endpoint
    if (u.pathname.endsWith('/metrics')) {
      return new Response(JSON.stringify(this.counters), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // Generate request ID and start timing
    const reqId = rid();
    const t0 = Date.now();
    this.counters.totalRequests++;

    try {
      const {
        userEvents,
        candidateIds,
        gamma = 0.1,
        goal,
        includeAlign = false,
      } = (await req.json()) as {
        userEvents: Array<{ role?: string; org?: string; acad_year?: string }>;
        candidateIds: string[];
        gamma?: number;
        goal?: { target_company?: string; target_year?: string };
        includeAlign?: boolean;
      };

      // Check cache (include goal and includeAlign in cache key)
      const cacheKey = await sha1({
        userEvents,
        candidateIds,
        gamma,
        goal,
        includeAlign,
      });
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.ts <= this.TTL_MS) {
        this.counters.cacheHits++;
        this.touch(cacheKey);
        const totalMs = Date.now() - t0;
        console.log(`Cache HIT [${reqId}] ${totalMs}ms`);
        return new Response(
          JSON.stringify({
            results: cached.value,
            cached: true,
            reqId,
            timings: { totalMs },
          }),
          {
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      console.log(`Cache MISS [${reqId}]`);

      // 1) Embed user events
      const embedStart = Date.now();
      const X: number[][] = [];
      for (const e of userEvents) {
        const text =
          `${e.acad_year || ''} | ${e.role || ''} | ${e.org || ''}`.trim();
        X.push(await embedEvent(this.env, text));
      }
      const embedMs = Date.now() - embedStart;

      // 2) Load candidate sequences
      const loadStart = Date.now();
      const targetCompany = goal?.target_company || 'google';
      const scores: Array<{
        id: string;
        score: number;
        align?: Array<{ x: number; y: number; dx: number }>;
      }> = [];

      for (const cid of candidateIds) {
        const Y = await loadSeq(this.env, cid);
        if (X.length === 0 || Y.length === 0) {
          scores.push({ id: cid, score: 0 });
          continue;
        }

        // Compute Soft-DTW (with or without alignment)
        let dist: number;
        let align: Array<{ x: number; y: number; dx: number }> | undefined;

        if (includeAlign) {
          const result = softDTWTrace(X, Y, gamma);
          dist = result.dist;
          align = result.align;
        } else {
          dist = softDTWFromCosine(X, Y, gamma);
        }

        const softSim = toSimilarity(dist);

        // Goal proximity based on candidate's organizations
        const orgs = await loadCandidateOrgs(this.env, cid);
        const prox = goalProximity(orgs, targetCompany);

        // Blended score: 70% Soft-DTW, 30% company proximity
        const blended = 0.7 * softSim + 0.3 * prox;

        scores.push({ id: cid, score: blended, align });
      }
      const loadMs = Date.now() - loadStart;

      // 3) Sort by score descending (DTW compute is included in load time)
      const dtwStart = Date.now();
      scores.sort((a, b) => b.score - a.score);
      const dtwMs = Date.now() - dtwStart;

      this.counters.reranks++;

      // Cache the results
      this.setCache(cacheKey, scores);

      const totalMs = Date.now() - t0;
      const timings = { embedMs, loadMs, dtwMs, totalMs };

      console.log(
        JSON.stringify({
          reqId,
          ...timings,
          candidateCount: candidateIds?.length || 0,
          cacheSize: this.cache.size,
        }),
      );

      return new Response(
        JSON.stringify({
          results: scores,
          cached: false,
          reqId,
          timings,
        }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    } catch (e: any) {
      this.counters.errors++;
      console.error(
        'ReRanker error',
        reqId,
        e?.stack || e?.message || String(e),
      );
      return new Response(
        JSON.stringify({
          error: 'rerank_failed',
          reqId,
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        },
      );
    }
  }
}
