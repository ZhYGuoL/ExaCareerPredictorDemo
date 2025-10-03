// Company similarity graph for goal proximity scoring
const neighbors: Record<string, Set<string>> = {
  google: new Set(["youtube", "deepmind", "alphabet", "waymo", "verily"]),
  meta: new Set(["facebook", "instagram", "whatsapp", "oculus"]),
  microsoft: new Set(["linkedin", "github", "xbox"]),
  amazon: new Set(["aws", "twitch", "audible"]),
  apple: new Set(["beats"]),
  netflix: new Set([]),
  nvidia: new Set([]),
};

function norm(s: string): string {
  return (s || "").toLowerCase().trim();
}

/**
 * Compute goal proximity score based on candidate's organizations
 * vs target company.
 * 
 * @param candidateOrgs - List of organizations from candidate's career path
 * @param target - Target company from user's goal
 * @returns Score between 0 and 1 (1 = exact match, 0.8 = neighbor, 0.65 = FAANG cross, 0.3 = baseline)
 */
export function goalProximity(candidateOrgs: string[], target: string): number {
  const t = norm(target);
  const orgs = new Set(candidateOrgs.map(norm));
  
  // Exact match
  if (orgs.has(t)) return 1.0;
  
  // Close neighbor (e.g., Google → YouTube)
  const neigh = neighbors[t];
  if (neigh && [...orgs].some(o => neigh.has(o))) return 0.8;
  
  // Cross-FAANG mild boost (e.g., Google goal, has Meta experience)
  const faang = new Set(["google", "meta", "apple", "amazon", "microsoft", "netflix"]);
  if (faang.has(t) && [...orgs].some(o => faang.has(o))) return 0.65;
  
  // Baseline for any other company
  return 0.3;
}

