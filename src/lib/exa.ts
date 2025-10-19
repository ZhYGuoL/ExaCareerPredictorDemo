import type { Env } from '../types';

// Legacy search API (to be deprecated)
export async function exaSearch(env: Env, query: string, num = 20) {
  const r = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.EXA_KEY,
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

// New function using Exa Websets API
export async function exaWebsetsSearch(env: Env, query: string, websetId: string, num = 20) {
  console.log(`Searching Webset ${websetId} for "${query}"...`);
  
  try {
    // Step 1: Execute search against the specified Webset
    const searchResponse = await fetch(`https://api.exa.ai/websets/${websetId}/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.EXA_KEY,
      },
      body: JSON.stringify({
        query,
        numResults: num,
        includeContents: true,
        contentLength: 6000
      }),
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      throw new Error(`Webset search error: ${errorText}`);
    }

    const results = await searchResponse.json();
    console.log(`Found ${(results as any).results?.length || 0} results in Webset ${websetId}`);
    
    return results;
  } catch (error: any) {
    console.error(`Error searching Webset: ${error?.message || error}`);
    throw error;
  }
}

// Creates a Webset for candidate profiles
export async function createProfilesWebset(env: Env, name: string, description: string) {
  const r = await fetch('https://api.exa.ai/websets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.EXA_KEY,
    },
    body: JSON.stringify({
      name,
      description,
      config: {
        searchStrategy: "manual", // Can be "automated", "manual", or "hybrid"
        minScore: 0.7, // Threshold for automated search
        maxResults: 100 // Maximum number of results per webset
      }
    }),
  });
  
  if (!r.ok) {
    const errorText = await r.text();
    throw new Error(`Failed to create Webset: ${errorText}`);
  }
  
  return r.json();
}

// Adds URLs to a Webset
export async function addUrlsToWebset(env: Env, websetId: string, urls: string[]) {
  const r = await fetch(`https://api.exa.ai/websets/${websetId}/results`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.EXA_KEY,
    },
    body: JSON.stringify({
      urls,
    }),
  });
  
  if (!r.ok) {
    const errorText = await r.text();
    throw new Error(`Failed to add URLs to Webset: ${errorText}`);
  }
  
  return r.json();
}

export async function exaContents(env: Env, urls: string[]) {
  const r = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.EXA_KEY,
    },
    body: JSON.stringify({ urls, summary: false }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
