import type { Env } from "./types";
import { exaSearch } from "./lib/exa";

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
      return new Response(JSON.stringify({ enqueued: 0 }), {
        headers: { "content-type": "application/json" },
      });
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
};

