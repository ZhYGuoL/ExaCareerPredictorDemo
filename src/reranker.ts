import type { Env } from "./types";

function softDTW(X: number[][], Y: number[][], gamma = 0.1): number {
  const m = X.length, n = Y.length;
  const D = Array.from({length: m}, () => Array(n).fill(0));
  for (let i=0;i<m;i++){
    for (let j=0;j<n;j++){
      const d = 1 - cosineSim(X[i], Y[j]);
      D[i][j] = d;
    }
  }
  const R = Array.from({length: m+1}, () => Array(n+1).fill(Infinity));
  R[0][0] = 0;
  for (let i=1;i<=m;i++){
    for (let j=1;j<=n;j++){
      const r0 = R[i-1][j-1];
      const r1 = R[i-1][j];
      const r2 = R[i][j-1];
      const rmin = -gamma * Math.log(Math.exp(-r0/gamma) + Math.exp(-r1/gamma) + Math.exp(-r2/gamma));
      R[i][j] = D[i-1][j-1] + rmin;
    }
  }
  return R[m][n];
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i=0;i<a.length;i++){
    dot += a[i]*b[i];
    na += a[i]*a[i];
    nb += b[i]*b[i];
  }
  return dot / (Math.sqrt(na)*Math.sqrt(nb) + 1e-8);
}

export class ReRanker {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const { query, candidates } = await req.json() as {
      query: string[];
      candidates: { id: string; events: string[] }[];
    };
    
    // TODO: fetch embeddings for query+events from Vectorize
    // For now, stub with random vectors
    const scores = candidates.map(c => ({
      id: c.id,
      score: Math.random()
    }));
    
    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    
    return new Response(JSON.stringify(scores), {
      headers: { "content-type": "application/json" }
    });
  }
}

