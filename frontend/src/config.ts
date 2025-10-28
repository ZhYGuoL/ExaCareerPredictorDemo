// API Configuration
export const API_BASE_URL = import.meta.env.PROD
  ? 'https://career-paths.zguoliau.workers.dev'
  : 'http://localhost:8787';

// API endpoints
export const API_ENDPOINTS = {
  linkedinSubmit: `${API_BASE_URL}/api/linkedin/submit`,
  websetSearch: `${API_BASE_URL}/api/webset/search`,
  careerGoalAdd: `${API_BASE_URL}/api/career-goal/add`,
};
