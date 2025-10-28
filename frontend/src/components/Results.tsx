import { useState, useEffect } from 'react';
import { Search, ExternalLink, Loader2 } from 'lucide-react';

interface ResultsProps {
  websetId: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

export default function Results({ websetId }: ResultsProps) {
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('similar career paths');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    setError(null);
    setLoading(true);
    setSearchQuery(query || 'similar career paths');

    try {
      const API_URL = import.meta.env.PROD
        ? 'https://career-paths.zguoliau.workers.dev/api/webset/search'
        : 'http://localhost:8787/api/webset/search';
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websetId,
          query: query || 'similar career paths',
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResults(data.results || []);
      } else {
        setError(data.error || 'Failed to search');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleSearch();
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        Similar Career Paths
      </h2>

      {/* Search Input */}
      <div className="mb-8">
        <div className="flex gap-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="E.g., 'Software engineers who worked at startups'"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Search className="w-5 h-5" />
                Search
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Results */}
      {loading && (
        <div className="text-center py-12">
          <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-600" />
          <p className="mt-4 text-gray-600">Finding similar career paths...</p>
        </div>
      )}

      {!loading && results.length === 0 && !error && (
        <div className="text-center py-12">
          <Search className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No results found. Try a different search query.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-4">
          {results.map((result, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow"
            >
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                {result.title}
              </h3>
              <p className="text-gray-600 mb-4 line-clamp-3">{result.snippet}</p>
              <div className="flex items-center justify-between">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Profile
                </a>
                {result.score && (
                  <span className="text-sm font-semibold text-blue-600">
                    Match: {Math.round(result.score * 100)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
