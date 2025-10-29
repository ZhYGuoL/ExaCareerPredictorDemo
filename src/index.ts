import type { Env } from './types';
import { 
  exaContents, 
  createUserWebset, 
  findUserWebset, 
  updateUserWebset, 
  searchUserWebset,
  UserProfile,
  generateUserIdentifier 
} from './lib/exa';
import { ReRanker } from './reranker';
import { embedEvent } from './lib/embed';

// Helper function to add CORS headers
function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return newResponse;
}

// Worker entrypoint
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Debug: log incoming method and path
    console.log(`[ROUTING] Incoming request: ${request.method} ${path}`);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return addCorsHeaders(new Response(null, { status: 204 }));
    }

    // Route handling - check API routes first, then UI
    if (path.startsWith('/api/')) {
      console.log(`[ROUTING] API route detected: ${path}`);
      
      if (path === '/api/linkedin/submit') {
        console.log('[ROUTING] Matched: /api/linkedin/submit');
        const response = await handleLinkedinSubmission(request, env);
        return addCorsHeaders(response);
      }
      if (path === '/api/webset/search') {
        console.log('[ROUTING] Matched: /api/webset/search');
        const response = await handleWebsetSearch(request, env);
        return addCorsHeaders(response);
      }
      if (path.startsWith('/api/career-goal/add')) {
        console.log(`[ROUTING] Matched: /api/career-goal/add (path: "${path}")`);
        const response = await handleCareerGoal(request, env);
        return addCorsHeaders(response);
      }
      if (path.startsWith('/api/debug/')) {
        console.log('[ROUTING] Matched: /api/debug/*');
        const response = await handleDebug(path, request, env);
        return addCorsHeaders(response);
      }
      
      console.log(`[ROUTING] No API route matched for: ${path}`);
      return new Response(`API route not found: ${path}`, { status: 404 });
    }
    
    if (path === '/') {
      console.log('[ROUTING] Matched route: / (UI)');
      return ui();
    }

    console.log(`[ROUTING] No route matched for: ${path}`);
    return new Response(`Not found: ${path}`, { status: 404 });
  },

  // Queue handler for background tasks
  async queue(batch: MessageBatch<string>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        // Parse message data
        const data = JSON.parse(message.body);
        
        if (data.type === 'extract_linkedin') {
          await extractLinkedinProfile(data.url, env);
        } else if (data.type === 'update_webset') {
          await updateUserWebset(env, data.websetId, data.profile);
        }
      } catch (error) {
        console.error('Queue processing error:', error);
      }
    }
  }
};

/**
 * Handle LinkedIn URL submission
 * - Check if we already have a Webset for this user
 * - If not, create a new one and extract profile data
 */
async function handleLinkedinSubmission(request: Request, env: Env): Promise<Response> {
  try {
    console.log("LinkedIn submission received");
    
    const data = await request.json();
    console.log("Request data:", data);
    
    const linkedinUrl = data.linkedinUrl as string;
    const school = data.school as string;
    const major = data.major as string;
    const gradYear = data.gradYear as number;
    
    console.log(`Processing LinkedIn URL: ${linkedinUrl}, School: ${school}, Major: ${major}, Grad Year: ${gradYear}`);
    
    // Validate input
    if (!linkedinUrl || !school || !major || !gradYear) {
      console.log("Missing required fields in request");
      return new Response(JSON.stringify({ 
        error: 'Missing required fields' 
      }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Clean and normalize LinkedIn URL
    const normalizedUrl = normalizeLinkedinUrl(linkedinUrl);
    
    // Generate a hash for this LinkedIn URL
    const urlHash = await generateUrlHash(normalizedUrl);
    
    // Check if we already have a Webset for this user
    const existingRecord = await env.DB.prepare(
      'SELECT * FROM user_websets WHERE linkedin_hash = ?'
    ).bind(urlHash).first();
    
    if (existingRecord) {
      // Update last accessed timestamp
      await env.DB.prepare(
        'UPDATE user_websets SET last_accessed_at = ? WHERE id = ?'
      ).bind(new Date().toISOString(), existingRecord.id).run();
      
      // Return existing Webset info
      return new Response(JSON.stringify({
        status: 'existing',
        websetId: existingRecord.webset_id,
        school: existingRecord.user_school,
        major: existingRecord.user_major,
        gradYear: existingRecord.user_grad_year
      }), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    // Store basic profile data in linkedin_profiles table (no Webset created yet)
    console.log("Storing LinkedIn profile for later Webset creation:", normalizedUrl);
    
    try {
      await env.DB.prepare(`
        INSERT INTO linkedin_profiles
        (linkedin_url, full_name, headline, profile_data, extracted_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (linkedin_url) DO UPDATE SET
        headline = excluded.headline,
        profile_data = excluded.profile_data,
        extracted_at = excluded.extracted_at
      `).bind(
        normalizedUrl,
        `${school} - ${major}`,
        `Student at ${school}`,
        JSON.stringify({ school, major, gradYear }),
        new Date().toISOString()
      ).run();
      
      console.log("LinkedIn profile stored successfully with normalized URL:", normalizedUrl);
      
      // Verify the profile was stored
      const verifyProfile = await env.DB.prepare(
        'SELECT linkedin_url FROM linkedin_profiles WHERE linkedin_url = ?'
      ).bind(normalizedUrl).first();
      console.log("Verification query result:", verifyProfile ? "Confirmed stored" : "NOT stored!");
      
      // Queue the LinkedIn profile extraction to get experiences
      await env.INGEST_QUEUE.send(JSON.stringify({
        type: 'extract_linkedin',
        url: normalizedUrl
      }));
      
      console.log("LinkedIn extraction queued");
      
      return new Response(JSON.stringify({
        status: 'profile_stored',
        linkedinUrl: normalizedUrl,
        message: 'Profile stored. Please define your career goals to create your personalized Webset.'
      }), { 
        headers: { 'Content-Type': 'application/json' } 
      });
      
    } catch (dbError) {
      console.error("Database error:", dbError);
      return new Response(JSON.stringify({
        error: 'Failed to store profile: ' + (dbError instanceof Error ? dbError.message : String(dbError))
      }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
  } catch (error) {
    console.error('LinkedIn submission error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to process LinkedIn profile'
    }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * Extract information from a LinkedIn profile
 * - Uses Exa contents API to get the profile HTML
 * - Parses experiences, education, etc.
 * - Updates the user's Webset with the new information
 */
async function extractLinkedinProfile(url: string, env: Env) {
  try {
    // Get the profile record from our database
    const userRecord = await env.DB.prepare(
      'SELECT * FROM user_websets WHERE linkedin_url = ?'
    ).bind(url).first();
    
    if (!userRecord) {
      throw new Error(`No user record found for URL: ${url}`);
    }
    
    // Use Exa to extract the LinkedIn page content
    const contentResponse = await exaContents(env, [url]);
    
    if (!contentResponse.results || contentResponse.results.length === 0) {
      throw new Error('Failed to extract LinkedIn content');
    }
    
    const content = contentResponse.results[0].content;
    
    // Extract profile information
    const extractedProfile = parseLinkedinProfile(content);
    
    // Store the extracted profile in our database
    await env.DB.prepare(`
      INSERT INTO linkedin_profiles
      (linkedin_url, full_name, headline, profile_data, extracted_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (linkedin_url) DO UPDATE SET
      full_name = excluded.full_name,
      headline = excluded.headline,
      profile_data = excluded.profile_data,
      extracted_at = excluded.extracted_at
    `).bind(
      url,
      extractedProfile.name || '',
      extractedProfile.headline || '',
      JSON.stringify(extractedProfile),
      new Date().toISOString()
    ).run();
    
    // Update the user profile with the extracted information
    const updatedProfile: UserProfile = {
      school: userRecord.user_school,
      major: userRecord.user_major,
      grad_year: userRecord.user_grad_year,
      experiences: extractedProfile.experiences || [],
      research: extractedProfile.research || []
    };
    
    // Update the Webset with this new information
    await updateUserWebset(env, userRecord.webset_id, updatedProfile);
    
    console.log('Successfully extracted and processed LinkedIn profile:', url);
  } catch (error) {
    console.error('Error extracting LinkedIn profile:', error);
  }
}

/**
 * Handle searching within a user's Webset
 */
async function handleWebsetSearch(request: Request, env: Env): Promise<Response> {
  try {
    const data = await request.json();
    const websetId = data.websetId as string;
    const query = data.query as string;
    const filters = data.filters as Record<string, any> | undefined;
    
    if (!websetId || !query) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields' 
      }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    // Get user record for this Webset
    const userRecord = await env.DB.prepare(
      'SELECT * FROM user_websets WHERE webset_id = ?'
    ).bind(websetId).first();
    
    if (!userRecord) {
      return new Response(JSON.stringify({ 
        error: 'Invalid Webset ID' 
      }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    // Search the user's Webset
    const results = await searchUserWebset(env, websetId, query, filters || {});
    
    // Process and return the results
    const typedResults = results as any;
    return new Response(JSON.stringify({
      results: typedResults.results.map((result: any) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        content: result.content,
        score: result.score
      }))
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
    
  } catch (error) {
    console.error('Webset search error:', error);
    console.error('Error details:', error instanceof Error ? error.message : String(error));
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    return new Response(JSON.stringify({ 
      error: 'Failed to search Webset: ' + (error instanceof Error ? error.message : String(error))
    }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * Handle adding a new career goal for a user
 */
async function handleCareerGoal(request: Request, env: Env): Promise<Response> {
  console.log('[handleCareerGoal] Function called');
  try {
    console.log('[handleCareerGoal] Parsing request body...');
    const data = await request.json();
    console.log('[handleCareerGoal] Request data received:', Object.keys(data));
    const linkedinUrl = data.linkedinUrl as string;
    const role = data.role as string;
    const company = data.company as string | undefined;
    const industry = data.industry as string | undefined;
    const timeframe = data.timeframe as string | undefined;
    
    if (!linkedinUrl || !role) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields' 
      }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    // Normalize the LinkedIn URL
    const normalizedUrl = normalizeLinkedinUrl(linkedinUrl);
    console.log("Career goals handler - Looking for LinkedIn profile with URL:", normalizedUrl);
    
    // Get the LinkedIn profile with experiences
    const linkedinProfile = await env.DB.prepare(
      'SELECT * FROM linkedin_profiles WHERE linkedin_url = ?'
    ).bind(normalizedUrl).first();
    
    console.log("LinkedIn profile query result:", linkedinProfile ? "Found" : "Not found");
    
    if (!linkedinProfile) {
      // Debug: Check what profiles exist in the database
      const allProfiles = await env.DB.prepare(
        'SELECT linkedin_url FROM linkedin_profiles LIMIT 10'
      ).all();
      console.log("Available profiles in database:", allProfiles);
      
      return new Response(JSON.stringify({ 
        error: 'LinkedIn profile not found. Please submit your LinkedIn profile first.' 
      }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    // Parse the profile data
    const profileData = JSON.parse(linkedinProfile.profile_data || '{}');
    
    // Build user profile for Webset creation
    const userProfile: UserProfile = {
      school: profileData.school || '',
      major: profileData.major || '',
      grad_year: profileData.gradYear || profileData.grad_year || 2024,
      experiences: profileData.experiences || [],
      target_companies: company ? [company] : []
    };
    
    // Build query from career goals (what they want to achieve)
    const query = `Looking for professionals who have achieved or are working toward: ${role}${company ? ` at ${company}` : ''}${industry ? ` in the ${industry} industry` : ''}`;
    
    console.log("Creating Webset with career goals as query and experiences as criteria");
    console.log("Query (career goals):", query);
    
    // Create the Webset with the query (career goals) and criteria (their experiences)
    try {
      const websetResult = await createUserWebset(env, userProfile, normalizedUrl, query);
      
      if (!websetResult || !websetResult.id) {
        throw new Error('Failed to create Webset');
      }
      
      // Store the Webset ID and career goal
      await env.DB.prepare(`
        INSERT INTO user_websets 
        (linkedin_url, linkedin_hash, webset_id, webset_external_id, user_school, user_major, user_grad_year, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        normalizedUrl,
        await generateUrlHash(normalizedUrl),
        websetResult.id,
        websetResult.externalId || generateUserIdentifier(profileData.school + profileData.major, userProfile),
        profileData.school || '',
        profileData.major || '',
        profileData.gradYear || profileData.grad_year || 2024,
        new Date().toISOString()
      ).run();
      
      // Save the career goal
      await env.DB.prepare(`
        INSERT INTO user_career_goals
        (linkedin_url, target_role, target_company, target_industry, timeframe, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        normalizedUrl,
        role,
        company || null,
        industry || null,
        timeframe || null,
        new Date().toISOString()
      ).run();
      
      return new Response(JSON.stringify({
        status: 'success',
        websetId: websetResult.id,
        message: 'Webset created successfully with your career goals and experiences'
      }), { 
        headers: { 'Content-Type': 'application/json' } 
      });
      
    } catch (websetError) {
      console.error("Error creating Webset from career goals:", websetError);
      return new Response(JSON.stringify({
        error: 'Failed to create Webset: ' + (websetError instanceof Error ? websetError.message : String(websetError))
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
  } catch (error) {
    console.error('Career goal error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to add career goal'
    }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * Handle debug endpoints for development and testing
 */
async function handleDebug(path: string, request: Request, env: Env): Promise<Response> {
  try {
    const debugPath = path.replace('/api/debug/', '');
    
    if (debugPath === 'websets') {
      // List all user Websets in our database
      const websets = await env.DB.prepare(
        'SELECT * FROM user_websets ORDER BY created_at DESC LIMIT 100'
      ).all();
      
      return new Response(JSON.stringify(websets), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    if (debugPath === 'goals') {
      // List all career goals in our database
      const goals = await env.DB.prepare(
        'SELECT * FROM user_career_goals ORDER BY created_at DESC LIMIT 100'
      ).all();
      
      return new Response(JSON.stringify(goals), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    if (debugPath === 'profiles') {
      // List all LinkedIn profiles in our database
      const profiles = await env.DB.prepare(
        'SELECT linkedin_url, full_name, headline, extracted_at FROM linkedin_profiles ORDER BY extracted_at DESC LIMIT 100'
      ).all();
      
      return new Response(JSON.stringify(profiles), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    return new Response(JSON.stringify({ error: 'Unknown debug endpoint' }), { 
      status: 404, 
      headers: { 'Content-Type': 'application/json' } 
    });
    
  } catch (error) {
    console.error('Debug endpoint error:', error);
    return new Response(JSON.stringify({ error: 'Debug endpoint failed' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * Generate the UI HTML
 */
function ui(): Response {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Career Path Explorer</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f7f9fc;
      color: #333;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 24px;
    }
    header {
      background-color: #1e3a8a;
      color: white;
      padding: 20px 0;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 600;
    }
    h2 {
      color: #1e3a8a;
      margin-top: 30px;
      font-size: 20px;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    input, textarea, select, button {
      width: 100%;
      padding: 12px;
      margin: 8px 0 16px;
      border: 1px solid #ddd;
      border-radius: 4px;
      box-sizing: border-box;
      font-size: 16px;
    }
    button {
      background-color: #1e3a8a;
      color: white;
      border: none;
      cursor: pointer;
      font-weight: 600;
      transition: background-color 0.2s;
    }
    button:hover {
      background-color: #1e40af;
    }
    .muted {
      color: #666;
      font-size: 14px;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .hidden {
      display: none;
    }
    .result-card {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .result-card h3 {
      margin-top: 0;
      color: #1e3a8a;
    }
    .result-card p {
      margin-bottom: 8px;
    }
    .result-card a {
      color: #2563eb;
      text-decoration: none;
    }
    .result-card a:hover {
      text-decoration: underline;
    }
    .loading {
      text-align: center;
      padding: 20px;
    }
    .score {
      font-weight: bold;
      color: #1e3a8a;
    }
    .step-indicator {
      display: flex;
      margin-bottom: 24px;
    }
    .step {
      flex: 1;
      text-align: center;
      padding: 12px;
      background-color: #e5e7eb;
      color: #6b7280;
      position: relative;
    }
    .step.active {
      background-color: #1e3a8a;
      color: white;
    }
    .step.completed {
      background-color: #10b981;
      color: white;
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>Career Path Explorer</h1>
      <p>Find and learn from career paths similar to yours</p>
    </div>
  </header>
  
  <div class="container">
    <!-- Step indicator -->
    <div class="step-indicator">
      <div class="step active" id="step1">1. Add LinkedIn Profile</div>
      <div class="step" id="step2">2. Define Career Goals</div>
      <div class="step" id="step3">3. Explore Similar Paths</div>
    </div>
    
    <!-- Step 1: LinkedIn input -->
    <div class="card" id="linkedinCard">
      <h2>Start with Your LinkedIn Profile</h2>
      <form id="linkedinForm">
        <div class="row">
          <div>
            <label for="linkedinUrl">Your LinkedIn URL:</label>
            <input type="url" id="linkedinUrl" name="linkedinUrl" placeholder="https://www.linkedin.com/in/yourname/" required>
          </div>
        </div>
        
        <div class="row">
          <div>
            <label for="school">University/School:</label>
            <input type="text" id="school" name="school" placeholder="Carnegie Mellon University" required>
          </div>
          <div>
            <label for="major">Major/Field of Study:</label>
            <input type="text" id="major" name="major" placeholder="Computer Science" required>
          </div>
        </div>
        
        <div class="row">
          <div>
            <label for="gradYear">Graduation Year:</label>
            <input type="number" id="gradYear" name="gradYear" placeholder="2024" min="1950" max="2030" required>
          </div>
          <div></div>
        </div>
        
        <button type="submit">Submit Profile</button>
        <p class="muted">We'll analyze your LinkedIn profile to find similar career paths</p>
      </form>
      <div id="linkedinLoading" class="loading hidden">
        <p>Processing your LinkedIn profile...</p>
      </div>
    </div>
    
    <!-- Step 2: Career Goals -->
    <div class="card hidden" id="goalsCard">
      <h2>Define Your Career Goals</h2>
      <form id="goalsForm">
        <div class="row">
          <div>
            <label for="targetRole">Target Role:</label>
            <input type="text" id="targetRole" name="targetRole" placeholder="Senior Software Engineer" required>
          </div>
          <div>
            <label for="targetCompany">Target Company (optional):</label>
            <input type="text" id="targetCompany" name="targetCompany" placeholder="Google, Amazon, etc.">
          </div>
        </div>
        
        <div class="row">
          <div>
            <label for="targetIndustry">Target Industry (optional):</label>
            <input type="text" id="targetIndustry" name="targetIndustry" placeholder="Finance, Healthcare, etc.">
          </div>
          <div>
            <label for="timeframe">Timeframe (optional):</label>
            <select id="timeframe" name="timeframe">
              <option value="">Select timeframe</option>
              <option value="1 year">1 year</option>
              <option value="2 years">2 years</option>
              <option value="3-5 years">3-5 years</option>
              <option value="5+ years">5+ years</option>
            </select>
          </div>
        </div>
        
        <button type="submit">Set Career Goals</button>
        <p class="muted">We'll use this information to find the most relevant career paths</p>
      </form>
    </div>
    
    <!-- Step 3: Results -->
    <div class="card hidden" id="resultsCard">
      <h2>Similar Career Paths</h2>
      <div id="searchForm">
        <div class="row">
          <div>
            <label for="searchQuery">Refine your search:</label>
            <input type="text" id="searchQuery" placeholder="E.g., 'Software engineers who worked at startups'">
          </div>
          <div style="display: flex; align-items: flex-end;">
            <button id="searchButton" style="margin-top: 8px;">Search</button>
          </div>
        </div>
      </div>
      
      <div id="resultsLoading" class="loading hidden">
        <p>Finding similar career paths...</p>
      </div>
      
      <div id="resultsContainer">
        <p>Submit your career goals to see results</p>
      </div>
    </div>
  </div>

  <script>
    // Enable console logging for debugging
    console.log("Career Path Explorer loading...");
    
    // Wait for DOM to be fully loaded
    document.addEventListener('DOMContentLoaded', function() {
      console.log("DOM fully loaded, initializing app...");
      
      // State variables
      let currentWebsetId = null;
      let currentLinkedinUrl = null;
      
      // DOM elements
      const linkedinForm = document.getElementById('linkedinForm');
      const linkedinCard = document.getElementById('linkedinCard');
      const linkedinLoading = document.getElementById('linkedinLoading');
      
      const goalsForm = document.getElementById('goalsForm');
      const goalsCard = document.getElementById('goalsCard');
      
      const resultsCard = document.getElementById('resultsCard');
      const resultsContainer = document.getElementById('resultsContainer');
      const resultsLoading = document.getElementById('resultsLoading');
      
      const searchQuery = document.getElementById('searchQuery');
      const searchButton = document.getElementById('searchButton');
      
      const step1 = document.getElementById('step1');
      const step2 = document.getElementById('step2');
      const step3 = document.getElementById('step3');
      
      // Check if all required elements exist
      if (!linkedinForm || !linkedinCard) {
        console.error("Critical DOM elements missing!");
        return;
      }
      
      console.log("All DOM elements found, setting up event listeners...");
    
    // Handle LinkedIn form submission
    linkedinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      console.log("LinkedIn form submitted");
      
      // Show loading indicator
      linkedinForm.classList.add('hidden');
      linkedinLoading.classList.remove('hidden');
      
      // Get form data
      const linkedinUrl = document.getElementById('linkedinUrl').value;
      const school = document.getElementById('school').value;
      const major = document.getElementById('major').value;
      const gradYear = document.getElementById('gradYear').value;
      
      console.log("Form data:", { linkedinUrl, school, major, gradYear });
      
      try {
        console.log("Submitting to API...");
        // Submit to API
        const response = await fetch('/api/linkedin/submit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ linkedinUrl, school, major, gradYear })
        });
        
        console.log("API response status:", response.status);
        const data = await response.json();
        console.log("API response data:", data);
        
        if (response.ok) {
          console.log("LinkedIn submission successful");
          // Save LinkedIn URL for later use (no webset ID yet, will be created with career goals)
          currentLinkedinUrl = data.linkedinUrl || linkedinUrl;
          console.log("Stored LinkedIn URL:", currentLinkedinUrl);
          
          // Update step indicators
          step1.classList.remove('active');
          step1.classList.add('completed');
          step2.classList.add('active');
          
          // Move to next step
          linkedinCard.classList.add('hidden');
          goalsCard.classList.remove('hidden');
          console.log("UI updated to show goals card");
        } else {
          console.error("LinkedIn submission error:", data.error);
          alert('Error: ' + (data.error || 'Failed to process LinkedIn profile'));
          // Reset form
          linkedinForm.classList.remove('hidden');
          linkedinLoading.classList.add('hidden');
        }
      } catch (error) {
        alert('Error submitting form: ' + error.message);
        // Reset form
        linkedinForm.classList.remove('hidden');
        linkedinLoading.classList.add('hidden');
      }
    });
    
    // Handle Career Goals form submission
    goalsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Get form data
      const targetRole = document.getElementById('targetRole').value;
      const targetCompany = document.getElementById('targetCompany').value;
      const targetIndustry = document.getElementById('targetIndustry').value;
      const timeframe = document.getElementById('timeframe').value;
      
      try {
        // Submit to API
        const response = await fetch('/api/career-goal/add', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            linkedinUrl: currentLinkedinUrl,
            role: targetRole,
            company: targetCompany,
            industry: targetIndustry,
            timeframe
          })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          console.log("Career goals submission successful");
          // Save webset ID (created with career goals)
          currentWebsetId = data.websetId;
          console.log("Stored Webset ID:", currentWebsetId);
          
          // Update step indicators
          step2.classList.remove('active');
          step2.classList.add('completed');
          step3.classList.add('active');
          
          // Move to next step
          goalsCard.classList.add('hidden');
          resultsCard.classList.remove('hidden');
          
          // Trigger initial search
          searchWebset(targetRole + " at " + (targetCompany || 'companies') + " in " + (targetIndustry || 'any industry'));
        } else {
          alert('Error: ' + (data.error || 'Failed to save career goals'));
        }
      } catch (error) {
        alert('Error submitting career goals: ' + error.message);
      }
    });
    
    // Handle search button click
    searchButton.addEventListener('click', () => {
      searchWebset(searchQuery.value);
    });
    
    // Function to search the Webset
    async function searchWebset(query) {
      if (!currentWebsetId) {
        alert('No Webset ID available. Please complete the previous steps first.');
        return;
      }
      
      // Show loading indicator
      resultsContainer.innerHTML = '';
      resultsLoading.classList.remove('hidden');
      
      try {
        // Call search API
        const response = await fetch('/api/webset/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            websetId: currentWebsetId,
            query: query || 'similar career paths'
          })
        });
        
        const data = await response.json();
        
        // Hide loading indicator
        resultsLoading.classList.add('hidden');
        
        console.log("Search response status:", response.status);
        console.log("Search response data:", data);
        
        if (response.ok && data.results) {
          // Display results
          if (data.results.length === 0) {
            resultsContainer.innerHTML = '<p>No results found. Try a different search query.</p>';
          } else {
            resultsContainer.innerHTML = '';
            data.results.forEach(result => {
              const resultCard = document.createElement('div');
              resultCard.className = 'result-card';
              
              // Build HTML content for result card
              resultCard.innerHTML = 
                '<h3>' + (result.title || 'Career Profile') + '</h3>' +
                '<p><a href="' + result.url + '" target="_blank">' + result.url + '</a></p>' +
                '<p>' + (result.snippet || '') + '</p>' +
                '<p class="score">Match Score: ' + Math.round(result.score * 100) + '%</p>';
              
              resultsContainer.appendChild(resultCard);
            });
          }
        } else {
          console.error("Search failed:", data.error || data);
          resultsContainer.innerHTML = '<p>Error loading results: ' + (data.error || 'Unknown error') + '</p>';
        }
      } catch (error) {
        resultsLoading.classList.add('hidden');
        resultsContainer.innerHTML = '<p>Error searching: ' + error.message + '</p>';
      }
    }
    }); // End DOMContentLoaded
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
    },
  });
}

/**
 * Parse LinkedIn profile content from HTML
 * This is a simple example - in a real app, you'd want more robust parsing
 */
function parseLinkedinProfile(content: string): {
  name?: string;
  headline?: string;
  experiences?: Array<{role?: string; org?: string;}>;
  education?: Array<{school?: string; degree?: string;}>;
  research?: string[];
} {
  // Extract basic profile information using regex
  // Note: This is a simplified example - real parsing would be more robust
  const nameMatch = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const headlineMatch = content.match(/<div[^>]*headline[^>]*>([^<]+)<\/div>/i);
  
  // Extract experiences
  const experiences = [];
  const expMatches = content.matchAll(/position[^>]*>([^<]+)<[\s\S]*?company[^>]*>([^<]+)</ig);
  
  if (expMatches) {
    for (const match of expMatches) {
      if (match[1] && match[2]) {
        experiences.push({
          role: match[1].trim(),
          org: match[2].trim()
        });
      }
    }
  }
  
  // Extract education
  const education = [];
  const eduMatches = content.matchAll(/school[^>]*>([^<]+)<[\s\S]*?degree[^>]*>([^<]+)</ig);
  
  if (eduMatches) {
    for (const match of eduMatches) {
      if (match[1] && match[2]) {
        education.push({
          school: match[1].trim(),
          degree: match[2].trim()
        });
      }
    }
  }
  
  // Look for research keywords
  const research = [];
  const researchKeywords = ['research', 'thesis', 'laboratory', 'lab', 'study', 'investigation'];
  
  for (const keyword of researchKeywords) {
    const regex = new RegExp(`(?:experience|education|section)[^>]*>[\\s\\S]{0,100}${keyword}[\\s\\S]{0,100}?<`, 'ig');
    const matches = content.match(regex);
    
    if (matches && matches.length > 0) {
      research.push(keyword);
    }
  }
  
  return {
    name: nameMatch ? nameMatch[1].trim() : '',
    headline: headlineMatch ? headlineMatch[1].trim() : '',
    experiences,
    education,
    research: Array.from(new Set(research)) // Remove duplicates
  };
}

/**
 * Normalize a LinkedIn URL to a standard format
 */
function normalizeLinkedinUrl(url: string): string {
  // Handle variations of LinkedIn URLs
  let normalized = url.trim();
  
  // Ensure https://
  if (!normalized.startsWith('http')) {
    normalized = 'https://' + normalized;
  }
  
  // Remove tracking parameters
  normalized = normalized.split('?')[0];
  
  // Remove trailing slash
  normalized = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  
  return normalized;
}

/**
 * Generate a hash for a URL to use as a unique identifier
 */
async function generateUrlHash(url: string): Promise<string> {
  // Convert string to arraybuffer
  const encoder = new TextEncoder();
  const data = encoder.encode(url);
  
  // Generate SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // Convert to hex string
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Export ReRanker for Durable Object migration
export { ReRanker };