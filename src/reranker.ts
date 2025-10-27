// Placeholder ReRanker class for migration purposes only
// This will be deleted after migration is complete

export class ReRanker {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response("ReRanker has been deprecated", { status: 410 });
  }
}