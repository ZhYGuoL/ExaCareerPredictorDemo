import type { Env } from '../types';

/**
 * Fetches content from specific URLs using Exa's Contents API
 * Useful for extracting data from LinkedIn profiles
 */
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

/**
 * User profile interface for creating personalized Websets
 */
export interface UserProfile {
  school: string;
  major: string;
  grad_year: number;
  research?: string[];
  experiences?: Array<{role?: string; org?: string; acad_year?: string;}>;
  interests?: string[];
  target_companies?: string[];
}

/**
 * Generate a unique identifier for a user based on their LinkedIn URL
 */
export function generateUserIdentifier(linkedinUrl: string, profile: UserProfile): string {
  // Create a hash of the LinkedIn URL
  const encoder = new TextEncoder();
  const data = encoder.encode(linkedinUrl);
  
  // Convert to a simple hash string (for demo purposes)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0; // Convert to 32bit integer
  }
  
  // Combine with user profile elements for a unique but recognizable identifier
  return `user-${profile.school.replace(/\s+/g, '-').toLowerCase()}-${profile.grad_year}-${Math.abs(hash).toString(16)}`;
} 

/**
 * Creates a personalized Webset for a user based on their LinkedIn profile
 */ 
export async function createUserWebset(env: Env, userProfile: UserProfile): Promise<any> {
  // Build search query based on user profile
  const query = `I am looking for current or recently graduated ${userProfile.school} students who studied ${userProfile.major} and have relevant career experiences`;
  
  // Build criteria array based on user profile
  const criteria: string[] = [
    `Currently enrolled as a student at ${userProfile.school} OR graduated from ${userProfile.school} in ${userProfile.grad_year-1} or ${userProfile.grad_year}`,
    `Studied ${userProfile.major} or a related field`
  ];

  // Add research criteria if available
  if (userProfile.research && userProfile.research.length > 0) {
    criteria.push(`Has conducted research at ${userProfile.school} or similar institutions`);
  }

  // Add experience criteria if available
  if (userProfile.experiences && userProfile.experiences.length > 0) {
    const companies = userProfile.experiences
      .map(exp => exp.org)
      .filter(Boolean)
      .slice(0, 3); // Limit to top 3 to avoid overly specific criteria
    
    if (companies.length > 0) {
      criteria.push(`Has work experience at companies similar to ${companies.join(", ")}`);
    }
    
    // Add role-based criteria
    const roles = userProfile.experiences
      .map(exp => exp.role)
      .filter(Boolean)
      .slice(0, 3);
    
    if (roles.length > 0) {
      criteria.push(`Has held roles similar to ${roles.join(", ")}`);
    }
  }
  
  // Add target companies if available
  if (userProfile.target_companies && userProfile.target_companies.length > 0) {
    criteria.push(`Has worked at or has connections to ${userProfile.target_companies.join(", ")}`);
  }

  // Create the Webset with the Exa API
  console.log(`Creating user Webset with criteria: ${JSON.stringify(criteria)}`);
  
  try {
    // Use the correct Exa Websets API endpoint format with /v0/websets
    let endpoint = 'https://api.exa.ai/websets/v0/websets';
    
    // This format matches the one we're using for search and retrieval
    console.log(`Attempting to create Webset at ${endpoint}`);
    
    // Build the Webset with query and criteria as the user requested
    const websetIdentifier = generateUserIdentifier(userProfile.school + userProfile.major, userProfile);
    
    console.log("=".repeat(60));
    console.log("CREATING WEBSET");
    console.log("=".repeat(60));
    console.log("User Profile:", userProfile);
    console.log("Query:", query);
    console.log("Criteria:", criteria);
    
    // Start with minimal payload - just create an empty Webset
    // We'll add searches and enrichments through separate API calls
    const payload = {
      externalId: websetIdentifier
    };
    
    console.log("Webset creation payload:", JSON.stringify(payload, null, 2));
    
    // Step 1: Create the empty Webset
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.EXA_KEY,
      },
      body: JSON.stringify(payload),
    });
    
    if (!r.ok) {
      const errorText = await r.text();
      
      // Check if it's a conflict (409) - the Webset already exists
      if (r.status === 409 || errorText.includes("already exists") || errorText.includes("Conflict")) {
        console.log("Webset already exists, attempting to retrieve it...");
        try {
          const existingWebset = await findUserWebset(env, websetIdentifier);
          if (existingWebset && existingWebset.id) {
            console.log("Found existing Webset:", existingWebset.id);
            return existingWebset;
          }
        } catch (findError) {
          console.warn("Could not retrieve existing Webset:", findError);
        }
        throw new Error(`A Webset with this identifier already exists`);
      }
      
      console.error(`Failed to create user Webset: ${errorText}`);
      
      // Check for common error types and provide more helpful messages
      if (errorText.includes("404") || errorText.includes("Not Found")) {
        throw new Error(`Invalid API endpoint. Please check the Exa Websets API documentation for the correct endpoint.`);
      } else if (errorText.includes("403") || errorText.includes("Forbidden")) {
        throw new Error(`Authentication error. Please verify your Exa API key has permission to create Websets.`);
      } else if (errorText.includes("429") || errorText.includes("Too Many Requests")) {
        throw new Error(`Rate limit exceeded. Please try again later.`);
      } else {
        throw new Error(`Failed to create user Webset: ${errorText}`);
      }
    }
    
    let result;
    try {
      result = await r.json();
      console.log("Webset creation successful:", result);
      
      // Validate that we have a valid response with an ID
      if (!result || typeof result !== 'object' || !result.id) {
        console.error("Unexpected Webset creation response format:", result);
        throw new Error("Webset created but returned in unexpected format");
      }
      
      // The Webset is created
      // Now try to add a search to it using the searches endpoint
      console.log("Webset created successfully, ID:", result.id);
      console.log("Now adding initial search...");
      
      try {
        // Try to add the search using the searches endpoint
        const searchEndpoint = `https://api.exa.ai/websets/v0/websets/${result.id}/searches`;
        console.log(`Adding search to endpoint: ${searchEndpoint}`);
        
        const searchPayload = {
          query: query,
          count: 25,
          // Add criteria if available
          ...(criteria.length > 0 && {
            criteria: criteria.map(c => ({ text: c }))
          })
        };
        
        console.log("Search payload:", JSON.stringify(searchPayload));
        
        const searchResponse = await fetch(searchEndpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': env.EXA_KEY,
          },
          body: JSON.stringify(searchPayload),
        });
        
        if (searchResponse.ok) {
          const searchResult = await searchResponse.json();
          console.log("✅ Search added successfully to Webset");
          console.log("Search details:", searchResult);
        } else {
          const errorText = await searchResponse.text();
          console.warn("⚠️ Could not add search to Webset (continuing anyway):", errorText);
        }
      } catch (searchError) {
        console.warn("⚠️ Error adding search to Webset (continuing anyway):", searchError);
        // Continue even if search addition fails
      }
      
      console.log("=".repeat(60));
      console.log("✅ WEBSET CREATION COMPLETE");
      console.log("Webset ID:", result.id);
      console.log("Webset is ready for dynamic searching");
      console.log("=".repeat(60));
      return result;
    } catch (parseError) {
      console.error("Failed to parse Webset creation response:", parseError);
      throw new Error("Failed to parse Webset creation response");
    }
  } catch (error) {
    console.error("Error in createUserWebset:", error);
    throw error;
  }
}

/**
 * Searches for profiles within a user's personalized Webset
 */
export async function searchUserWebset(env: Env, websetId: string, query: string, filters: any = {}) {
  console.log(`Searching user Webset ${websetId} for "${query}"...`);
  
  try {
    // Execute search against the user's personalized Webset
    const endpoint = `https://api.exa.ai/websets/v0/websets/${websetId}/search`;
    console.log(`Using search endpoint: ${endpoint}`);
    
    // Prepare filters in the correct format if provided
    const formattedFilters = Array.isArray(filters) 
      ? filters 
      : (typeof filters === 'object' && Object.keys(filters).length > 0 
          ? Object.entries(filters).map(([key, value]) => ({ 
              field: key, 
              value: value 
            })) 
          : undefined);
          
    // Build search request body according to Exa's API docs
    const requestBody = {
      query,
      count: 20,
      includeContents: true,
      contentLength: 6000,
      // Only include filters if they exist and are properly formatted
      ...(formattedFilters && formattedFilters.length > 0 ? { filters: formattedFilters } : {})
    };
    
    console.log("Search request body:", JSON.stringify(requestBody));
    
    const searchResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.EXA_KEY,
      },
      body: JSON.stringify(requestBody),
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error(`Webset search error: Status ${searchResponse.status}, ${errorText}`);
      throw new Error(`Webset search error: ${errorText}`);
    }

    const results = await searchResponse.json();
    console.log(`Found ${(results as any).results?.length || 0} results in user Webset ${websetId}`);
    
    // Make sure we have a consistent response format even if the API returns something unexpected
    if (!results || !Array.isArray((results as any).results)) {
      console.warn("Unexpected search results format:", results);
      return { results: [] };
    }
    
    return results;
  } catch (error: any) {
    console.error(`Error searching user Webset: ${error?.message || error}`);
    throw error;
  }
}

/**
 * Finds a user's existing Webset by external ID
 */
export async function findUserWebset(env: Env, userIdentifier: string) {
  try {
    console.log(`Looking for existing Webset with ID: ${userIdentifier}`);
    const r = await fetch(`https://api.exa.ai/websets/v0/websets?externalId=${encodeURIComponent(userIdentifier)}`, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.EXA_KEY,
      }
    });
    
    if (!r.ok) {
      const errorText = await r.text();
      throw new Error(`Failed to find user Webset: ${errorText}`);
    }
    
    const response = await r.json() as {data?: Array<{id: string; externalId: string;}>};
    
    // Return the first Webset that matches the user identifier
    return response.data && response.data.length > 0 ? response.data[0] : null;
  } catch (error: any) {
    console.error(`Error finding user Webset: ${error?.message || error}`);
    return null; // Return null instead of throwing to allow for graceful handling
  }
}

/**
 * Updates a user's Webset with new criteria or experiences
 */
export async function updateUserWebset(env: Env, websetId: string, updatedProfile: Partial<UserProfile>) {
  try {
    // Build updated search criteria based on the changed profile
    const criteria: string[] = [];
    
    if (updatedProfile.experiences && updatedProfile.experiences.length > 0) {
      // Add new experience criteria
      const companies = updatedProfile.experiences
        .map(exp => exp.org)
        .filter(Boolean);
      
      if (companies.length > 0) {
        criteria.push(`Has work experience at companies similar to ${companies.join(", ")}`);
      }
    }
    
    if (updatedProfile.target_companies && updatedProfile.target_companies.length > 0) {
      criteria.push(`Has worked at or has connections to ${updatedProfile.target_companies.join(", ")}`);
    }
    
    // If no new criteria, no need to update
    if (criteria.length === 0) {
      return null;
    }
    
    console.log(`Updating Webset ${websetId} with new criteria:`, criteria);
    
    // Update the Webset with new search criteria
    // Use PATCH method for updating an existing Webset
    const r = await fetch(`https://api.exa.ai/websets/v0/websets/${websetId}`, {
      method: 'PATCH', // Use PATCH for updates instead of POST
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.EXA_KEY,
      },
      body: JSON.stringify({
        additionalSearch: { // Use additionalSearch instead of search
          query: `${criteria.join(" AND ")}`, // Join criteria as a single query
          filters: criteria.map(c => ({ text: c })), // Also add as filters
          count: 10, // Add 10 more matching profiles
        }
      }),
    });
    
    if (!r.ok) {
      const errorText = await r.text();
      throw new Error(`Failed to update user Webset: ${errorText}`);
    }
    
    return r.json();
  } catch (error: any) {
    console.error(`Error updating user Webset: ${error?.message || error}`);
    throw error;
  }
}
