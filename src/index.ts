import type { Env } from "./types";
import { exaSearch } from "./lib/exa";
import ingestWorker from "./ingest-worker";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    
    // GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    
    // POST /ingest/start
    if (req.method === "POST" && url.pathname === "/ingest/start") {
      try {
        const { profile, goal } = await req.json() as {
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
          const res = await exaSearch(env, q, 10) as any;
          urls.push(...(res.results || []).map((r: any) => r.url));
        }

        // Deduplicate URLs
        urls = Array.from(new Set(urls));

        // Enqueue each URL to INGEST_QUEUE
        await env.INGEST_QUEUE.sendBatch(
          urls.map(url => ({ body: url }))
        );

        return new Response(JSON.stringify({ enqueued: urls.length }), {
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    
    // GET /debug/r2?key=raw/hash.json
    if (req.method === "GET" && url.pathname === "/debug/r2") {
      const key = url.searchParams.get("key");
      if (!key) {
        return new Response(JSON.stringify({ error: "Missing key parameter" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      try {
        const obj = await env.BLOB.get(key);
        if (!obj) {
          return new Response(JSON.stringify({ error: "Object not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        const text = await obj.text();
        return new Response(text, {
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    
    // GET /debug/exa?q=query
    if (req.method === "GET" && url.pathname === "/debug/exa") {
      const query = url.searchParams.get("q");
      if (!query) {
        return new Response(JSON.stringify({ error: "Missing q parameter" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      try {
        const results = await exaSearch(env, query);
        return new Response(JSON.stringify(results), {
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    
    return new Response("Not found", { status: 404 });
  },

  // Queue consumer handler
  async queue(batch: MessageBatch<string>, env: Env) {
    return ingestWorker.queue(batch, env);
  },
};

