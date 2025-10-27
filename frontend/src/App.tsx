import { useState } from 'react';
import { Linkedin, GraduationCap, Target, Search } from 'lucide-react';
import LinkedInForm from './components/LinkedInForm';
import GoalsForm from './components/GoalsForm';
import Results from './components/Results';

interface Step {
  id: number;
  name: string;
  icon: any;
}

const steps: Step[] = [
  { id: 1, name: 'Add LinkedIn Profile', icon: Linkedin },
  { id: 2, name: 'Define Career Goals', icon: Target },
  { id: 3, name: 'Explore Similar Paths', icon: Search },
];

function App() {
  const [currentStep, setCurrentStep] = useState(1);
  const [websetId, setWebsetId] = useState<string | null>(null);
  const [linkedinUrl, setLinkedinUrl] = useState<string>('');

  const handleStep1Complete = (newWebsetId: string, newLinkedinUrl: string) => {
    setWebsetId(newWebsetId);
    setLinkedinUrl(newLinkedinUrl);
    setCurrentStep(2);
  };

  const handleStep2Complete = () => {
    setCurrentStep(3);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-3 flex items-center justify-center gap-3">
            <GraduationCap className="w-10 h-10 text-blue-600" />
            Career Path Explorer
          </h1>
          <p className="text-lg text-gray-600">
            Discover career paths similar to yours and achieve your goals
          </p>
        </header>

        {/* Step Indicator */}
        <div className="mb-12">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              const isCompleted = currentStep > step.id;
              
              return (
                <div key={step.id} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-lg'
                          : isCompleted
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className={`mt-2 text-sm font-medium ${
                      isActive ? 'text-blue-600' : 'text-gray-600'
                    }`}>
                      {step.name}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`h-1 flex-1 mx-4 ${
                      isCompleted ? 'bg-green-500' : 'bg-gray-200'
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-lg shadow-xl p-8">
          {currentStep === 1 && <LinkedInForm onComplete={handleStep1Complete} />}
          {currentStep === 2 && websetId && (
            <GoalsForm
              onComplete={handleStep2Complete}
              linkedinUrl={linkedinUrl}
            />
          )}
          {currentStep === 3 && websetId && (
            <Results websetId={websetId} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;