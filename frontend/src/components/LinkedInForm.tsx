import { useState, FormEvent } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface LinkedInFormProps {
  onComplete: (websetId: string, linkedinUrl: string) => void;
}

export default function LinkedInForm({ onComplete }: LinkedInFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    linkedinUrl: '',
    school: '',
    major: '',
    gradYear: '',
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/linkedin/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkedinUrl: formData.linkedinUrl,
          school: formData.school,
          major: formData.major,
          gradYear: parseInt(formData.gradYear),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        onComplete(data.websetId, formData.linkedinUrl);
      } else {
        setError(data.error || 'Failed to submit profile');
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
        Start with Your LinkedIn Profile
      </h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="linkedinUrl" className="block text-sm font-medium text-gray-700 mb-2">
            Your LinkedIn URL
          </label>
          <input
            type="url"
            id="linkedinUrl"
            required
            value={formData.linkedinUrl}
            onChange={(e) => setFormData({ ...formData, linkedinUrl: e.target.value })}
            placeholder="https://www.linkedin.com/in/yourname"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="school" className="block text-sm font-medium text-gray-700 mb-2">
              University/School
            </label>
            <input
              type="text"
              id="school"
              required
              value={formData.school}
              onChange={(e) => setFormData({ ...formData, school: e.target.value })}
              placeholder="Carnegie Mellon University"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="major" className="block text-sm font-medium text-gray-700 mb-2">
              Major/Field of Study
            </label>
            <input
              type="text"
              id="major"
              required
              value={formData.major}
              onChange={(e) => setFormData({ ...formData, major: e.target.value })}
              placeholder="Computer Science"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="gradYear" className="block text-sm font-medium text-gray-700 mb-2">
              Graduation Year
            </label>
            <input
              type="number"
              id="gradYear"
              required
              min="1950"
              max="2030"
              value={formData.gradYear}
              onChange={(e) => setFormData({ ...formData, gradYear: e.target.value })}
              placeholder="2024"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
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
              Processing Profile...
            </>
          ) : (
            <>
              <Send className="w-5 h-5" />
              Submit Profile
            </>
          )}
        </button>

        <p className="text-sm text-gray-600 text-center">
          We'll analyze your LinkedIn profile to find similar career paths
        </p>
      </form>
    </div>
  );
}
