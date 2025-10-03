import type { Env } from "../types";

export async function embedEvent(env: Env, text: string): Promise<number[]> {
  const resp = await env.AI.run(
    "@cf/baai/bge-base-en-v1.5",
    { text }
  ) as any;
  
  if (!resp?.data?.[0]) {
    throw new Error("No embedding returned");
  }
  
  return resp.data[0];
}

