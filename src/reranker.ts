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

// Calculate university similarity score between user's school and candidate's education
function calculateUniversitySimilarity(userSchool: string | undefined, candidateEducation: string[]): number {
  if (!userSchool || !candidateEducation || candidateEducation.length === 0) return 0;
  
  // Normalize university names
  const normalizedUserSchool = userSchool.toLowerCase().trim();
  
  // Common university abbreviations and aliases
  const universityAliases: Record<string, string[]> = {
    'mit': ['massachusetts institute of technology'],
    'cmu': ['carnegie mellon', 'carnegie-mellon'],
    'stanford': ['stanford university'],
    'berkeley': ['uc berkeley', 'university of california berkeley', 'university of california, berkeley'],
    'harvard': ['harvard university'],
    'princeton': ['princeton university'],
    'yale': ['yale university'],
    'columbia': ['columbia university'],
    'cornell': ['cornell university'],
    'ucla': ['university of california los angeles', 'university of california, los angeles'],
    'michigan': ['university of michigan', 'umich'],
    'gatech': ['georgia tech', 'georgia institute of technology'],
    'uiuc': ['university of illinois urbana-champaign', 'university of illinois at urbana-champaign'],
    'caltech': ['california institute of technology'],
    'waterloo': ['university of waterloo']
  };
  
  // Check for exact matches, common abbreviations, or partial matches
  let bestScore = 0;
  
  for (const eduInfo of candidateEducation) {
    const normalizedEduInfo = eduInfo.toLowerCase().trim();
    
    // Check for exact match
    if (normalizedEduInfo.includes(normalizedUserSchool)) {
      return 1.0; // Perfect match
    }
    
    // Check all possible aliases/variations of the school name
    for (const [abbr, aliases] of Object.entries(universityAliases)) {
      if ((normalizedUserSchool.includes(abbr) || aliases.some(a => normalizedUserSchool.includes(a))) && 
          (normalizedEduInfo.includes(abbr) || aliases.some(a => normalizedEduInfo.includes(a)))) {
        return 1.0; // Match through aliases
      }
    }
    
    // Calculate partial match using word overlap
    const userWords = normalizedUserSchool.split(/\s+/);
    let wordMatches = 0;
    
    for (const word of userWords) {
      if (word.length > 2 && normalizedEduInfo.includes(word)) {
        wordMatches++;
      }
    }
    
    // Score based on word matches (higher with more matching words)
    if (userWords.length > 0) {
      const score = wordMatches / userWords.length;
      if (score > bestScore) bestScore = score;
    }
  }
  
  return bestScore;
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

// Extract education/school information from candidate events
async function loadCandidateEducation(
  env: Env,
  candidateId: string,
): Promise<string[]> {
  // First check if we have school directly in candidates table
  const schoolRs = await env.DB.prepare(
    'SELECT school FROM candidates WHERE id = ?1 AND school IS NOT NULL',
  )
    .bind(candidateId)
    .first<{ school: string }>();
  
  if (schoolRs?.school) {
    console.log(`Found school for ${candidateId}: ${schoolRs.school}`);
    return [schoolRs.school]; // Direct school match
  }
  
  // Fall back to looking for education in events
  const rs = await env.DB.prepare(
    'SELECT role, org FROM events WHERE candidate_id = ?1 AND (role LIKE "%student%" OR role LIKE "%Bachelor%" OR role LIKE "%Master%" OR role LIKE "%PhD%" OR role LIKE "%graduate%" OR role LIKE "%undergrad%" OR role LIKE "%education%") ORDER BY ord ASC',
  )
    .bind(candidateId)
    .all();
  
  // Return both roles and orgs as they might contain university information
  const education: string[] = [];
  for (const row of (rs.results || [])) {
    if (row.role && typeof row.role === 'string') education.push(row.role);
    if (row.org && typeof row.org === 'string') education.push(row.org);
  }
  return education.filter(Boolean);
}

export class ReRanker {
  private cache = new Map<string, CacheEntry>(); // key -> { value, ts }
  private TTL_MS = 0; // No caching - always recalculate for testing
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
        profile,
      } = (await req.json()) as {
        userEvents: Array<{ role?: string; org?: string; acad_year?: string }>;
        candidateIds: string[];
        gamma?: number;
        goal?: { target_company?: string; target_year?: string };
        includeAlign?: boolean;
        profile?: { school?: string; major?: string; grad_year?: number };
      };

      // Generate cache key but always skip cache lookup
      const cacheKey = await sha1({
        userEvents,
        candidateIds,
        gamma,
        goal,
        profile,
        includeAlign,
        timestamp: Date.now(), // Add timestamp to ensure uniqueness
      });
      
      // Skip cache lookup - always calculate fresh results
      console.log(`Forced cache MISS [${reqId}] - timestamp: ${Date.now()}`);
      
      // Keep the code below for debugging purposes, but we'll never enter this block
      if (false) {
        this.counters.cacheHits++;
        this.touch(cacheKey);
        const totalMs = Date.now() - t0;
        console.log(`Cache HIT [${reqId}] ${totalMs}ms`);
        return new Response(
          JSON.stringify({
            results: [],
            cached: true,
            reqId,
            timings: { totalMs },
          }),
          {
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      // Already logged cache miss

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
        
        // University similarity based on candidate's education
        let universitySimilarity = 0;
        if (profile?.school) {
          const education = await loadCandidateEducation(this.env, cid);
          universitySimilarity = calculateUniversitySimilarity(profile.school, education);
        }

        // Blended score with weights:
        // - 40% Soft-DTW (career path similarity)
        // - 40% university similarity (increased as requested)
        // - 20% company proximity
        const blended = 0.4 * softSim + 0.4 * universitySimilarity + 0.2 * prox;
        
        // Log score breakdown for debugging
        console.log(`Score for ${cid}: Career=${softSim.toFixed(3)}, University=${universitySimilarity.toFixed(3)}, Company=${prox.toFixed(3)}, Final=${blended.toFixed(3)}`);

        // Create the base result object
        const result: {
          id: string;
          score: number;
          align?: Array<{ x: number; y: number; dx: number }>;
          debugInfo?: {
            careerSimilarity: number;
            universitySimilarity: number;
            companyProximity: number;
          };
        } = {
          id: cid,
          score: blended,
          align
        };
        
        // Add debug info separately
        result.debugInfo = {
          careerSimilarity: softSim,
          universitySimilarity: universitySimilarity,
          companyProximity: prox
        };
        
        scores.push(result);
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
