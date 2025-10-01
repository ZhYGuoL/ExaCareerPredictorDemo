import type { Env } from "./types";

export default {
  async queue(batch: MessageBatch<string>, env: Env) {
    for (const msg of batch.messages) {
      const url = msg.body;
      console.log("Ingesting URL:", url);
      // TODO: fetch contents, store, parse, embed
      msg.ack();
    }
  },
};

