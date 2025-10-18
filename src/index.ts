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
  
  <h3 style="margin-top:20px">Filters & Options</h3>
  <div class="row">
    <div><label>Filter School <input id="f_school" placeholder="e.g., MIT"></label></div>
    <div><label>Filter Degree <input id="f_degree" placeholder="e.g., CS"></label></div>
  </div>
  <div class="row">
    <div>
      <label>Company Tier
        <select id="f_tier">
          <option value="">Any</option>
          <option value="faang">FAANG</option>
          <option value="bigtech">Big Tech</option>
          <option value="startup">Startup</option>
        </select>
      </label>
    </div>
    <div><label><input type="checkbox" id="showAlign"> Show event alignment (slower)</label></div>
  </div>
  <div class="row">
    <div><label>Page <input id="page" type="number" value="1" min="1"></label></div>
    <div><label>Page Size <input id="pageSize" type="number" value="10" min="1" max="50"></label></div>
  </div>
  
  <button id="go">Search</button>
  <div id="out"></div>
  <script>
  async function go(){
    // Get form values with defaults and timestamps to ensure requests aren't duplicated
    const timestamp = new Date().getTime();
    
    // Check for required fields and show alert if missing
    if (!school.value.trim()) {
      alert("Please enter a school name - this is required for proper ranking.");
      return;
    }
    
    if (!company.value.trim()) {
      alert("Please enter a target company name.");
      return;
    }
    
    const profile = { 
      school: school.value.trim(), 
      major: major.value.trim() || 'Computer Science', 
      grad_year: Number(grad.value||0),
      _ts: timestamp // Add timestamp to force cache miss
    };
    const goal = { 
      target_company: company.value.trim() || 'Google', 
      target_year: tyear.value || 'junior',
      _ts: timestamp
    };
    
    let userEvents = [];
    try { 
      userEvents = JSON.parse(events.value || "[]"); 
    } catch(e){ 
      alert("Invalid JSON for events"); 
      return; 
    }
    
    const filters = {
      school: document.getElementById('f_school').value || null,
      degree: document.getElementById('f_degree').value || null,
      company_tier: document.getElementById('f_tier').value || null,
      _ts: timestamp
    };
    
    const includeAlign = showAlign.checked;
    const pageNum = Number(document.getElementById('page').value || 1);
    const pageSizeNum = Number(document.getElementById('pageSize').value || 10);
    
    out.innerHTML = '<p>Loading...</p>';
    
    // Add cache busting query parameter
    const searchParams = new URLSearchParams({cacheBust: timestamp.toString()});
    
    try {
      const res = await fetch('/rank/final?' + searchParams.toString(), {
        method:'POST', 
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ 
          profile, 
          goal, 
          userEvents, 
          topK: 100, 
          topN: pageNum * pageSizeNum, 
          gamma: 0.1, 
          includeAlign,
          filters,
          page: pageNum,
          pageSize: pageSizeNum,
          _ts: timestamp // Add timestamp to request body too
        })
      });
      const data = await res.json();
      
      // No raw response debugging needed
      
      if (data.error) {
        out.innerHTML = '<p style="color:red">Error: ' + data.error + '</p>';
        return;
      }
      let html = '';
      if (data.results && data.results.length > 0) {
        // Show pagination info
        html += \`<div style="background:#f7f7f7; padding:12px; margin:12px 0; border-radius:4px">
          <strong>Results:</strong> Showing page \${data.page || pageNum} of \${Math.ceil((data.total||0)/pageSizeNum)} 
          (Total: \${data.total||0} candidates, Page size: \${data.pageSize || pageSizeNum})
        </div>\`;
        
        for (const r of data.results) {
          html += \`<div style="border:1px solid #ddd; padding:12px; margin:12px 0; border-radius:4px">
            <h3 style="margin:0 0 8px 0">Candidate \${r.candidate_id.slice(0,8)}... (Score: \${(r.score||0).toFixed(4)})</h3>
            \${r.url ? '<a href="'+r.url+'" target="_blank">View profile</a>' : ''}
            \`;
            
          // Show score breakdown if available
          if (r.scoreBreakdown) {
            const sb = r.scoreBreakdown;
            html += \`<div style="font-size:12px; margin:8px 0; padding:8px; background:#f7f7f7; border-radius:4px">
              <strong>Score Breakdown:</strong>
              <ul style="margin:4px 0; padding-left:20px">
                <li>University Match: \${(sb.universitySimilarity * 100).toFixed(1)}%</li>
                <li>Career Path: \${(sb.careerSimilarity * 100).toFixed(1)}%</li>
                <li>Target Company: \${(sb.companyProximity * 100).toFixed(1)}%</li>
              </ul>
            </div>\`
          }
          if (includeAlign && r.align && r.candidateEvents) {
            html += '<h4 style="margin:12px 0 4px 0">Event Alignment:</h4>';
            html += '<table style="width:auto; font-size:13px"><thead><tr><th>Your Event</th><th>→</th><th>Their Event</th><th>Similarity</th></tr></thead><tbody>';
            for (const a of r.align) {
              const ue = userEvents[a.x];
              const ce = r.candidateEvents[a.y];
              const sim = (1 - a.dx).toFixed(3);
              html += \`<tr>
                <td>\${ue.acad_year||'?'}: \${ue.role||'?'} @ \${ue.org||'?'}</td>
                <td>→</td>
                <td>\${ce.acad_year||'?'}: \${ce.role||'?'} @ \${ce.org||'?'}</td>
                <td>\${sim}</td>
              </tr>\`;
            }
            html += '</tbody></table>';
          }
          html += '</div>';
        }
        out.innerHTML = html;
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

    // GET /debug/candidate?cid=<candidate_id>
    if (req.method === 'GET' && url.pathname === '/debug/candidate') {
      const cid = url.searchParams.get('cid');
      if (!cid) {
        return new Response(
          JSON.stringify({ error: 'Missing cid parameter' }),
          {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      try {
        const rs = await env.DB.prepare(
          'SELECT role, org, acad_year, ord FROM events WHERE candidate_id = ?1 ORDER BY ord ASC',
        )
          .bind(cid)
          .all();
        return new Response(JSON.stringify(rs.results || []), {
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
    if (req.method === 'POST' && url.pathname.startsWith('/rank/final')) {
      try {
        // Log cache busting param to ensure we're getting it
        const cacheBust = url.searchParams.get('cacheBust');
        if (cacheBust) {
          console.log(`Cache bust: ${cacheBust}`);
        }
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
          includeAlign?: boolean;
          filters?: {
            school?: string | null;
            degree?: string | null;
            company_tier?: string | null;
          };
          page?: number;
          pageSize?: number;
        };

        const {
          goal,
          userEvents,
          topK = 80,
          topN = 10,
          gamma = 0.1,
          includeAlign = false,
          filters,
          page = 1,
          pageSize = 10,
        } = body;

        // 1) Embed userEvents
        const X: number[][] = [];
        for (const e of userEvents) {
          const text =
            `${e.acad_year || ''} | ${e.role || ''} | ${e.org || ''}`.trim();
          X.push(await embedEvent(env, text));
        }

        // 2) Build goal text & embed it for shortlist query
        // Include school and major to ensure embedding captures these criteria
        // Using stronger weighting for school by repeating it multiple times
        const schoolInfo = body.profile?.school 
          ? `${body.profile.school} ${body.profile.school} ${body.profile.school} ` 
          : '';
        const majorInfo = body.profile?.major ? `${body.profile.major} ` : '';
        const goalText = `${schoolInfo}${majorInfo}${goal.target_year} ${goal.target_company} software engineering`;
        
        // Log the search criteria for debugging
        console.log(`Search criteria - School: ${body.profile?.school || 'none'}, Major: ${body.profile?.major || 'none'}, Target: ${goal.target_company}, Year: ${goal.target_year}`);
        console.log(`Goal text: ${goalText}`);
        const goalVec = await embedEvent(env, goalText);

        // 3) Build filter object for Vectorize query
        const filter: any = {};
        if (filters?.school) filter.school = filters.school;
        if (filters?.degree) filter.degree = filters.degree;
        if (filters?.company_tier) filter.company_tier = filters.company_tier;

        // 4) Shortlist from Vectorize with optional filters
        if (!env.VDB) {
          return new Response(
            JSON.stringify({
              error:
                'Vectorize (VDB) not available. Please deploy to production or ensure VDB binding is configured.',
            }),
            {
              status: 503,
              headers: { 'content-type': 'application/json' },
            },
          );
        }
        
        const shortlist = await env.VDB.query(goalVec, {
          topK,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
        });

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
            body: JSON.stringify({
              userEvents,
              candidateIds,
              gamma,
              goal,
              profile: body.profile, // Pass profile info including school for university similarity
              includeAlign,
            }),
          })
          .then((r) => r.json())) as {
          results: Array<{
            id: string;
            score: number;
            align?: Array<{ x: number; y: number; dx: number }>;
            debugInfo?: {
              careerSimilarity: number;
              universitySimilarity: number;
              companyProximity: number;
            };
          }>;
          cached?: boolean;
        };

        const sorted = rerankRes.results;
        const total = sorted.length;

        // 5) Apply pagination to re-ranked results
        const start = Math.max(0, (page - 1) * pageSize);
        const end = start + pageSize;
        const paged = sorted.slice(start, end);

        // 6) Hydrate URLs from D1 and optionally fetch candidate events
        const out = [];
        for (const r of paged) {
          const row = await env.DB.prepare(
            'SELECT url FROM candidates WHERE id = ?1',
          )
            .bind(r.id)
            .first<{ url: string }>();

          // Fetch candidate events if alignment is included
          let candidateEvents: Array<{
            role: string;
            org: string;
            acad_year: string;
            ord: number;
          }> = [];

          if (includeAlign && r.align) {
            const eventsRes = await env.DB.prepare(
              'SELECT role, org, acad_year, ord FROM events WHERE candidate_id = ?1 ORDER BY ord ASC',
            )
              .bind(r.id)
              .all();
            candidateEvents = eventsRes.results as any;
          }

          out.push({
            candidate_id: r.id,
            score: r.score,
            url: row?.url || null,
            align: r.align,
            candidateEvents: includeAlign ? candidateEvents : undefined,
            scoreBreakdown: r.debugInfo,
          });
        }

        return new Response(
          JSON.stringify({
            results: out,
            total,
            page,
            pageSize,
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
