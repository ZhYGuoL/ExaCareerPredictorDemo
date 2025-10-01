import type { Env } from "./types";
import { exaContents } from "./lib/exa";

async function hashUrl(url: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(url));
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, "0")).join("");
}

export default {
  async queue(batch: MessageBatch<string>, env: Env) {
    for (const msg of batch.messages) {
      const url = msg.body;
      try {
        const page = await exaContents(env, [url]);
        const key = `raw/${await hashUrl(url)}.json`;
        await env.BLOB.put(key, JSON.stringify(page));
        console.log("Saved raw:", key);
        msg.ack();
      } catch (err) {
        console.error("Error processing URL:", url, err);
        msg.retry();
      }
    }
  },
};

