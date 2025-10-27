export interface Env {
  EXA_KEY: string;
  DB: D1Database; // D1 binding
  INGEST_QUEUE: Queue<string>;
  BLOB: R2Bucket;
  AI?: any; // Workers AI binding (optional)
}

export interface LinkedInProfile {
  url: string;
  name?: string;
  headline?: string;
  experiences?: Array<{
    role?: string;
    org?: string;
    dates?: string;
    description?: string;
  }>;
  education?: Array<{
    school?: string;
    degree?: string;
    field?: string;
    dates?: string;
  }>;
  skills?: string[];
  certifications?: string[];
}

export interface UserWebset {
  id: string;
  externalId: string;
  linkedinUrl: string;
  school: string;
  major: string;
  gradYear: number;
  createdAt: string;
}

export interface CareerGoal {
  role: string;
  company?: string;
  industry?: string;
  timeframe?: string;
  priority?: number;
}
