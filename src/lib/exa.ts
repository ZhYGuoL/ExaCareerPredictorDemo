import type { Env } from "../types";

export async function exaSearch(env: Env, query: string, num = 20) {
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.EXA_KEY,
    },
    body: JSON.stringify({
      query,
      numResults: num,
      contents: { maxCharacters: 6000 },
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function exaContents(env: Env, urls: string[]) {
  const r = await fetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.EXA_KEY,
    },
    body: JSON.stringify({ urls, summary: false }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

