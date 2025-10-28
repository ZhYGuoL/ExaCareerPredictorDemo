import type { Env } from '../types';

/**
 * Process LinkedIn markdown using Workers AI to extract key information
 * and generate natural language query and criteria for Websets
 */
export async function processLinkedinProfile(env: Env, linkedinMarkdown: string, linkedinUrl: string): Promise<{
  query: string;
  criteria: string[];
}> {
  console.log("🤖 Processing LinkedIn profile with Workers AI...");
  console.log(`📝 LinkedIn markdown length: ${linkedinMarkdown.length} characters`);
  
  // Use Workers AI to extract key information from the LinkedIn markdown
  const prompt = `You are analyzing a LinkedIn profile to find people with similar career paths. 

Here is the LinkedIn profile in markdown format:
${linkedinMarkdown}

Based on this profile, generate:
1. A search query (2-3 sentences) describing what kind of people we want to find - those with similar backgrounds, experiences, or career trajectories
2. A list of specific criteria that these people should meet (like "graduated from X", "worked at Y", "has experience in Z")

Consider:
- Education history (universities, majors, graduation years, or if they didn't graduate)
- Work experience (companies, roles, internships)
- Skills and certifications
- Any notable achievements
- Career trajectory and timeline

Return your response as JSON with this structure:
{
  "query": "natural language query describing who to find",
  "criteria": ["criterion 1", "criterion 2", "criterion 3"]
}

Make the query and criteria specific enough to be useful but not so narrow that it returns no results.`;

  try {
    const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that analyzes LinkedIn profiles and generates search queries for finding similar career paths.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.7
    });

    console.log("✅ Workers AI response received");
    console.log("📦 Raw AI Response:");
    console.log(aiResponse);
    
    // Parse the AI response
    const aiContent = aiResponse.response || '';
    console.log("\n📄 AI Response Text:");
    console.log(aiContent.substring(0, 500) + (aiContent.length > 500 ? "..." : ""));
    
    // Try to extract JSON from the response
    let extractedData;
    try {
      // Look for JSON in the response
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: try to parse the entire response
        extractedData = JSON.parse(aiContent);
      }
    } catch (parseError) {
      console.warn("Failed to parse AI response as JSON, using fallback extraction");
      // Fallback extraction
      extractedData = extractFromText(aiContent);
    }
    
    console.log("Extracted data:", extractedData);
    
    const result = {
      query: extractedData.query || "Looking for professionals with similar career backgrounds",
      criteria: extractedData.criteria || []
    };
    
    // Print the natural language profile for debugging
    console.log("=".repeat(80));
    console.log("📋 NATURAL LANGUAGE PROFILE GENERATED FROM LINKEDIN");
    console.log("=".repeat(80));
    console.log("🔍 Search Query:");
    console.log(result.query);
    console.log("\n📊 Criteria:");
    result.criteria.forEach((criterion, index) => {
      console.log(`  ${index + 1}. ${criterion}`);
    });
    console.log("=".repeat(80));
    
    return result;
    
  } catch (error) {
    console.error("Error processing LinkedIn with Workers AI:", error);
    
    // Fallback: Generate basic query from the LinkedIn URL
    return {
      query: "Looking for professionals with similar career backgrounds and experiences",
      criteria: [
        "Has relevant work experience",
        "Has relevant education or certifications"
      ]
    };
  }
}

/**
 * Fallback function to extract query and criteria from text
 */
function extractFromText(text: string): { query: string; criteria: string[] } {
  // Try to find query and criteria in the text
  const queryMatch = text.match(/query["\s:]+["']?([^"'\]]+)["']?/i);
  const criteriaMatch = text.match(/criteria["\s:]+\[([^\]]+)\]/i);
  
  return {
    query: queryMatch ? queryMatch[1].trim() : "Looking for professionals with similar career backgrounds",
    criteria: criteriaMatch ? criteriaMatch[1].split(',').map(c => c.trim().replace(/["']/g, '')) : []
  };
}

/**
 * Fetch LinkedIn profile content using Exa API
 */
export async function fetchLinkedinContent(env: Env, linkedinUrl: string): Promise<string> {
  console.log(`Fetching LinkedIn content from Exa for: ${linkedinUrl}`);
  
  try {
    // Use Exa's contents API to get the LinkedIn page as markdown
    const response = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.EXA_KEY,
      },
      body: JSON.stringify({
        urls: [linkedinUrl],
        summary: false,
        text: true,
        highlights: false
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch LinkedIn content: ${errorText}`);
    }
    
    const result = await response.json();
    console.log("Exa contents API response received");
    
    // Extract the markdown/text content
    if (result.results && result.results.length > 0) {
      const content = result.results[0].text || result.results[0].content || '';
      console.log(`Extracted ${content.length} characters from LinkedIn profile`);
      console.log("📄 LinkedIn Profile Content (first 500 chars):");
      console.log(content.substring(0, 500) + "...");
      return content;
    }
    
    throw new Error('No content found in Exa response');
    
  } catch (error) {
    console.error("Error fetching LinkedIn content:", error);
    throw error;
  }
}
