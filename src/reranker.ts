import type { Env } from "./types";
import { embedEvent } from "./lib/embed";
import { goalProximity } from "./lib/companyGraph";

// Cache helper: SHA-1 hash of object for cache key
async function sha1(obj: any): Promise<string> {
  const s = JSON.stringify(obj);
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

type CacheEntry = { value: any; ts: number };

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i=0; i<a.length; i++) {
    dot += a[i]*b[i];
    na += a[i]*a[i];
    nb += b[i]*b[i];
  }
  return dot / (Math.sqrt(na)*Math.sqrt(nb) + 1e-8);
}

function softDTWFromCosine(X: number[][], Y: number[][], gamma = 0.1): number {
  const m = X.length, n = Y.length;
  // D[i][j] = distance between events i and j (1 - cosine)
  const D = Array.from({length: m}, () => Array(n).fill(0));
  for (let i=0; i<m; i++) {
    for (let j=0; j<n; j++) {
      D[i][j] = 1 - cosineSim(X[i], Y[j]);
    }
  }
  
  // Soft-DTW DP
  const R = Array.from({length: m+1}, () => Array(n+1).fill(Infinity));
  R[0][0] = 0;
  for (let i=1; i<=m; i++) {
    for (let j=1; j<=n; j++) {
      const a = R[i-1][j];
      const b = R[i][j-1];
      const c = R[i-1][j-1];
      const minSoft = -gamma * Math.log(Math.exp(-a/gamma) + Math.exp(-b/gamma) + Math.exp(-c/gamma));
      R[i][j] = D[i-1][j-1] + minSoft;
    }
  }
  return R[m][n]; // smaller is better
}

function toSimilarity(dist: number): number {
  return 1 / (1 + dist); // map to (0,1]
}

async function loadSeq(env: Env, candidateId: string): Promise<number[][]> {
  const rs = await env.DB.prepare(
    "SELECT vec FROM event_vectors WHERE candidate_id = ?1 ORDER BY ord ASC"
  ).bind(candidateId).all();
  
  const seq: number[][] = [];
  for (const row of rs.results || []) {
    const buf = row.vec as ArrayBuffer;
    // Reconstruct Float32Array from ArrayBuffer
    const f32 = new Float32Array(buf);
    seq.push(Array.from(f32));
  }
  return seq;
}

async function loadCandidateOrgs(env: Env, candidateId: string): Promise<string[]> {
  const rs = await env.DB.prepare(
    "SELECT org FROM events WHERE candidate_id = ?1 ORDER BY ord ASC"
  ).bind(candidateId).all();
  return (rs.results || []).map((r: any) => r.org).filter(Boolean);
}

export class ReRanker {
  private cache = new Map<string, CacheEntry>(); // key -> { value, ts }
  private TTL_MS = 10 * 60 * 1000; // 10 minutes
  private MAX_SIZE = 200;
  
  constructor(private state: DurableObjectState, private env: Env) {}

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
    const { userEvents, candidateIds, gamma = 0.1, goal } = await req.json() as {
      userEvents: Array<{ role?: string; org?: string; acad_year?: string }>;
      candidateIds: string[];
      gamma?: number;
      goal?: { target_company?: string; target_year?: string };
    };

    // Check cache (include goal in cache key)
    const cacheKey = await sha1({ userEvents, candidateIds, gamma, goal });
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) <= this.TTL_MS) {
      this.touch(cacheKey);
      console.log(`Cache HIT for key ${cacheKey.substring(0, 8)}...`);
      return new Response(JSON.stringify({ results: cached.value, cached: true }), {
        headers: { "content-type": "application/json" }
      });
    }

    console.log(`Cache MISS for key ${cacheKey.substring(0, 8)}...`);

    // 1) Embed user events
    const X: number[][] = [];
    for (const e of userEvents) {
      const text = `${e.acad_year || ""} | ${e.role || ""} | ${e.org || ""}`.trim();
      X.push(await embedEvent(this.env, text));
    }

    // 2) Load candidate sequences and compute blended scores
    const targetCompany = goal?.target_company || "google";
    const scores: { id: string; score: number }[] = [];
    
    for (const cid of candidateIds) {
      const Y = await loadSeq(this.env, cid);
      if (X.length === 0 || Y.length === 0) {
        scores.push({ id: cid, score: 0 });
        continue;
      }
      
      // Soft-DTW similarity
      const dist = softDTWFromCosine(X, Y, gamma);
      const softSim = toSimilarity(dist);
      
      // Goal proximity based on candidate's organizations
      const orgs = await loadCandidateOrgs(this.env, cid);
      const prox = goalProximity(orgs, targetCompany);
      
      // Blended score: 70% Soft-DTW, 30% company proximity
      const blended = 0.7 * softSim + 0.3 * prox;
      
      scores.push({ id: cid, score: blended });
    }

    // 3) Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    
    // Cache the results
    this.setCache(cacheKey, scores);
    console.log(`Cached ${scores.length} results (cache size: ${this.cache.size}/${this.MAX_SIZE})`);
    
    return new Response(JSON.stringify({ results: scores, cached: false }), {
      headers: { "content-type": "application/json" }
    });
  }
}

