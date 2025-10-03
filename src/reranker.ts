import type { Env } from "./types";
import { embedEvent } from "./lib/embed";

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

export class ReRanker {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const { userEvents, candidateIds, gamma = 0.1 } = await req.json() as {
      userEvents: Array<{ role?: string; org?: string; acad_year?: string }>;
      candidateIds: string[];
      gamma?: number;
    };

    // 1) Embed user events
    const X: number[][] = [];
    for (const e of userEvents) {
      const text = `${e.acad_year || ""} | ${e.role || ""} | ${e.org || ""}`.trim();
      X.push(await embedEvent(this.env, text));
    }

    // 2) Load candidate sequences from D1 and compute scores
    const scores: { id: string; score: number }[] = [];
    for (const cid of candidateIds) {
      const Y = await loadSeq(this.env, cid);
      if (X.length === 0 || Y.length === 0) {
        scores.push({ id: cid, score: 0 });
        continue;
      }
      const dist = softDTWFromCosine(X, Y, gamma);
      scores.push({ id: cid, score: toSimilarity(dist) });
    }

    // 3) Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    
    return new Response(JSON.stringify({ results: scores }), {
      headers: { "content-type": "application/json" }
    });
  }
}

