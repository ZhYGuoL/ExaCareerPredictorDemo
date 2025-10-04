// run with: npx ts-node scripts/loadtest.ts http://localhost:8787/rank/final 100 10
import fetch from 'node-fetch';

const url = process.argv[2] || 'http://localhost:8787/rank/final';
const total = Number(process.argv[3] || 100);
const conc = Number(process.argv[4] || 10);

const profile = { school: 'UIUC', major: 'CS', grad_year: 2026 };
const goal = { target_company: 'Google', target_year: 'junior' };
const userEvents = [
  { role: 'research assistant', org: 'ML Lab', acad_year: 'freshman' },
  { role: 'backend intern', org: 'Startup X', acad_year: 'sophomore' },
  { role: 'SWE intern', org: 'Google', acad_year: 'junior' },
];

function body() {
  return JSON.stringify({
    profile,
    goal,
    userEvents,
    topK: 80,
    topN: 10,
    gamma: 0.1,
    includeAlign: false,
  });
}

async function one() {
  const t0 = Date.now();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body(),
  });
  const j: any = await r.json();
  const ms = Date.now() - t0;
  return { ms, ok: r.ok, cached: !!j.cached };
}

async function run() {
  const lat: number[] = [];
  let ok = 0,
    cached = 0;
  const start = Date.now();

  // Simple concurrency limiter
  const workers: Promise<void>[] = [];
  let idx = 0;

  for (let w = 0; w < conc; w++) {
    workers.push(
      (async () => {
        while (idx < total) {
          const myIdx = idx++;
          if (myIdx >= total) break;
          const x = await one();
          lat.push(x.ms);
          if (x.ok) ok++;
          if (x.cached) cached++;
        }
      })(),
    );
  }

  await Promise.all(workers);
  const dur = (Date.now() - start) / 1000;
  lat.sort((a, b) => a - b);
  const pct = (p: number) =>
    lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
  console.log({
    total,
    conc,
    ok,
    qps: (total / dur).toFixed(2),
    p50: pct(50),
    p95: pct(95),
    cached,
    cacheRate: ((cached / total) * 100).toFixed(1) + '%',
  });
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
