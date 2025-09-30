import type { Env } from "./types";

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
    
    return new Response("Not found", { status: 404 });
  },
};

