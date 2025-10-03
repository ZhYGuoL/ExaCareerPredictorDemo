import type { Env } from './types';
import { exaSearch } from './lib/exa';
import { embedEvent } from './lib/embed';
import ingestWorker from './ingest-worker';

function ui(): Response {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Career Path Matcher</title>
  <style>
    body{font-family: system-ui, sans-serif; margin: 24px; max-width: 900px}
    input, textarea, select, button{width:100%; padding:8px; margin:6px 0}
    table{width:100%; border-collapse: collapse; margin-top: 16px}
    th, td{border:1px solid #ddd; padding:8px}
    th{text-align:left; background:#f7f7f7}
    .row{display:grid; grid-template-columns:1fr 1fr; gap:12px}
    .muted{color:#666; font-size:12px}
  </style>
</head>
<body>
  <h1>Career Path Matcher</h1>
  <div class="row">
    <div><label>School <input id="school" placeholder="MIT"></label></div>
    <div><label>Major <input id="major" placeholder="CS"></label></div>
  </div>
  <div class="row">
    <div><label>Grad Year <input id="grad" type="number" placeholder="2026"></label></div>
    <div><label>Target Company <input id="company" placeholder="Google"></label></div>
  </div>
  <div class="row">
    <div>
      <label>Target Year
        <select id="tyear">
          <option>freshman</option><option>sophomore</option>
          <option selected>junior</option><option>senior</option>
        </select>
      </label>
    </div>
    <div class="muted">Enter a few user events below (JSON). Example:<br/>
      <code>[{"role":"Research Assistant","org":"ML Lab","acad_year":"freshman"},{"role":"Backend Intern","org":"Startup X","acad_year":"sophomore"}]</code>
    </div>
  </div>
  <label>User Events (JSON)</label>
  <textarea id="events" rows="6" placeholder='[{"role":"Software Engineer Intern","org":"Google","acad_year":"sophomore"}]'></textarea>
  <button id="go">Search</button>
  <div id="out"></div>
  <script>
  async function go(){
    const profile = { school: school.value, major: major.value, grad_year: Number(grad.value||0) };
    const goal = { target_company: company.value, target_year: tyear.value };
    let userEvents = [];
    try { userEvents = JSON.parse(events.value || "[]"); } catch(e){ alert("Invalid JSON for events"); return; }
    out.innerHTML = '<p>Loading...</p>';
    try {
      const res = await fetch('/rank/final', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ profile, goal, userEvents, topK: 50, topN: 10, gamma: 0.1 })
      });
      const data = await res.json();
      if (data.error) {
        out.innerHTML = '<p style="color:red">Error: ' + data.error + '</p>';
        return;
      }
      const rows = (data.results||[]).map(r=>\`
        <tr>
          <td>\${r.candidate_id}</td>
          <td>\${(r.score||0).toFixed(4)}</td>
          <td>\${r.url ? '<a href="'+r.url+'" target="_blank">open</a>' : ''}</td>
        </tr>\`).join('');
      if (rows) {
        out.innerHTML = '<table><thead><tr><th>Candidate ID</th><th>Score</th><th>URL</th></tr></thead><tbody>'+rows+'</tbody></table>';
      } else {
        out.innerHTML = '<p>No results found. Try different criteria or ingest more data first.</p>';
      }
    } catch (err) {
      out.innerHTML = '<p style="color:red">Error: ' + err.message + '</p>';
    }
  }
  document.getElementById('go').addEventListener('click', go);
  </script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // GET / - UI
    if (req.method === 'GET' && url.pathname === '/') {
      return ui();
    }

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // GET /metrics - Proxy to ReRanker DO metrics
    if (req.method === 'GET' && url.pathname === '/metrics') {
      try {
        const id = env.RERANKER.idFromName('global-reranker');
        const stub = env.RERANKER.get(id);
        const res = await stub.fetch('http://do/metrics');
        return new Response(await res.text(), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // POST /ingest/start
    if (req.method === 'POST' && url.pathname === '/ingest/start') {
      try {
        const { profile, goal } = (await req.json()) as {
          profile: { school: string; major: string };
          goal: { target_company: string; target_year: string };
        };

        // Generate queries
        const queries = [
          `${profile.school} ${profile.major} ${goal.target_year} SWE internship ${goal.target_company}`,
          `${profile.major} ${goal.target_year} internship ${goal.target_company} site:linkedin.com/in`,
          `${profile.school} ${goal.target_year} software engineering intern`,
        ];

        // Collect URLs from all queries
        let urls: string[] = [];
        for (const q of queries) {
          const res = (await exaSearch(env, q, 10)) as any;
          urls.push(...(res.results || []).map((r: any) => r.url));
        }

        // Deduplicate URLs
        urls = Array.from(new Set(urls));

        // Enqueue each URL to INGEST_QUEUE
        await env.INGEST_QUEUE.sendBatch(urls.map((url) => ({ body: url })));

        return new Response(JSON.stringify({ enqueued: urls.length }), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // GET /debug/r2?key=raw/hash.json
    if (req.method === 'GET' && url.pathname === '/debug/r2') {
      const key = url.searchParams.get('key');
      if (!key) {
        return new Response(
          JSON.stringify({ error: 'Missing key parameter' }),
          {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      try {
        const obj = await env.BLOB.get(key);
        if (!obj) {
          return new Response(JSON.stringify({ error: 'Object not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        const text = await obj.text();
        return new Response(text, {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // GET /debug/exa?q=query
    if (req.method === 'GET' && url.pathname === '/debug/exa') {
      const query = url.searchParams.get('q');
      if (!query) {
        return new Response(JSON.stringify({ error: 'Missing q parameter' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      try {
        const results = await exaSearch(env, query);
        return new Response(JSON.stringify(results), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // POST /rerank
    if (req.method === 'POST' && url.pathname === '/rerank') {
      try {
        const id = env.RERANKER.idFromName('global-reranker');
        const stub = env.RERANKER.get(id);
        return await stub.fetch(req);
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // POST /rank/final - End-to-end ranking pipeline
    if (req.method === 'POST' && url.pathname === '/rank/final') {
      try {
        const body = (await req.json()) as {
          profile: { school: string; major: string; grad_year: number };
          goal: { target_company: string; target_year: string };
          userEvents: Array<{
            role?: string;
            org?: string;
            acad_year?: string;
          }>;
          topK?: number;
          topN?: number;
          gamma?: number;
        };

        const { goal, userEvents, topK = 80, topN = 10, gamma = 0.1 } = body;

        // 1) Embed userEvents
        const X: number[][] = [];
        for (const e of userEvents) {
          const text =
            `${e.acad_year || ''} | ${e.role || ''} | ${e.org || ''}`.trim();
          X.push(await embedEvent(env, text));
        }

        // 2) Build goal text & embed it for shortlist query
        const goalText = `${goal.target_year} ${goal.target_company} software engineering`;
        const goalVec = await embedEvent(env, goalText);

        // 3) Shortlist from Vectorize
        const shortlist = await env.VDB.query(goalVec, { topK });

        // Normalize to unique candidate IDs
        // Extract candidate_id from metadata or from vector ID (format: candidateId:ord)
        const allCandidates = (shortlist.matches || [])
          .map((m: any) => {
            return m.metadata?.candidate_id || m.id?.split(':')[0];
          })
          .filter(Boolean);

        const candidateIds = Array.from(new Set(allCandidates)).slice(0, topK);

        // If no candidates found, return empty results
        if (candidateIds.length === 0) {
          return new Response(JSON.stringify({ results: [] }), {
            headers: { 'content-type': 'application/json' },
          });
        }

        // 4) Call Durable Object for re-rank
        const id = env.RERANKER.idFromName('global-reranker');
        const stub = env.RERANKER.get(id);
        const rerankRes = (await stub
          .fetch('http://do/rerank', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userEvents, candidateIds, gamma, goal }),
          })
          .then((r) => r.json())) as {
          results: Array<{ id: string; score: number }>;
          cached?: boolean;
        };

        const sorted = rerankRes.results.slice(0, topN);

        // 5) Hydrate URLs from D1
        const out = [];
        for (const r of sorted) {
          const row = await env.DB.prepare(
            'SELECT url FROM candidates WHERE id = ?1',
          )
            .bind(r.id)
            .first<{ url: string }>();
          out.push({
            candidate_id: r.id,
            score: r.score,
            url: row?.url || null,
          });
        }

        return new Response(
          JSON.stringify({
            results: out,
            cached: rerankRes.cached || false,
          }),
          {
            headers: { 'content-type': 'application/json' },
          },
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    return new Response('Not found', { status: 404 });
  },

  // Queue consumer handler
  async queue(batch: MessageBatch<string>, env: Env) {
    return ingestWorker.queue(batch, env);
  },
};

// Export Durable Object
export { ReRanker } from './reranker';
