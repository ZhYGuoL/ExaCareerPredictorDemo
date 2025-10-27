import { useState, FormEvent } from 'react';
import { Target, Loader2 } from 'lucide-react';

interface GoalsFormProps {
  onComplete: () => void;
  linkedinUrl: string;
}

export default function GoalsForm({ onComplete, linkedinUrl }: GoalsFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    targetRole: '',
    targetCompany: '',
    targetIndustry: '',
    timeframe: '',
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/career-goal/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkedinUrl,
          ...formData,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        onComplete();
      } else {
        setError(data.error || 'Failed to save career goals');
        setLoading(false);
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        Define Your Career Goals
      </h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="targetRole" className="block text-sm font-medium text-gray-700 mb-2">
              Target Role
            </label>
            <input
              type="text"
              id="targetRole"
              required
              value={formData.targetRole}
              onChange={(e) => setFormData({ ...formData, targetRole: e.target.value })}
              placeholder="Senior Software Engineer"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="targetCompany" className="block text-sm font-medium text-gray-700 mb-2">
              Target Company (optional)
            </label>
            <input
              type="text"
              id="targetCompany"
              value={formData.targetCompany}
              onChange={(e) => setFormData({ ...formData, targetCompany: e.target.value })}
              placeholder="Google, Amazon, etc."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="targetIndustry" className="block text-sm font-medium text-gray-700 mb-2">
              Target Industry (optional)
            </label>
            <input
              type="text"
              id="targetIndustry"
              value={formData.targetIndustry}
              onChange={(e) => setFormData({ ...formData, targetIndustry: e.target.value })}
              placeholder="Finance, Healthcare, etc."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="timeframe" className="block text-sm font-medium text-gray-700 mb-2">
              Timeframe (optional)
            </label>
            <select
              id="timeframe"
              value={formData.timeframe}
              onChange={(e) => setFormData({ ...formData, timeframe: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select timeframe</option>
              <option value="1 year">1 year</option>
              <option value="2 years">2 years</option>
              <option value="3-5 years">3-5 years</option>
              <option value="5+ years">5+ years</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Saving Goals...
            </>
          ) : (
            <>
              <Target className="w-5 h-5" />
              Set Career Goals
            </>
          )}
        </button>

        <p className="text-sm text-gray-600 text-center">
          We'll use this information to find the most relevant career paths
        </p>
      </form>
    </div>
  );
}
