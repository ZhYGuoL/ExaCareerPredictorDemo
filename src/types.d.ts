export interface Env {
  EXA_KEY: string;
  VDB: any; // Vectorize binding
  DB: D1Database; // D1 binding
  INGEST_QUEUE: Queue<string>;
  BLOB: R2Bucket;
  RERANKER: DurableObjectNamespace;
  AI: any; // Workers AI binding
}
