import { useState, useEffect } from 'react';
import { BarChart3, CheckCircle, Circle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface ProgressPageProps {
  currentSpeaker: any;
  deviceId: string;
}

export default function ProgressPage({ currentSpeaker, deviceId }: ProgressPageProps) {
  const [progressData, setProgressData] = useState<any>(null);
  const [selectedDomain, setSelectedDomain] = useState('BNK');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentSpeaker) {
      fetchProgress();
    }
  }, [selectedDomain, currentSpeaker]);

  const fetchProgress = async () => {
    if (!currentSpeaker) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/session/progress?domain=${selectedDomain}&batch_no=0`, {
        headers: {
          'Authorization': `Bearer ${currentSpeaker.token}`,
          'X-Device-ID': deviceId
        }
      });
      if (res.ok) {
        setProgressData(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (!currentSpeaker) {
    return (
      <div className="page-container">
        <div className="content-wrapper">
          <div className="card card-center">
            <BarChart3 size={48} className="icon-muted" />
            <h2>No Active Speaker</h2>
            <p>Please register or select a speaker profile to view progress.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="content-wrapper">
        <div className="page-header">
          <div>
            <h1>Recording Progress</h1>
            <p>Track your contribution across domains and intents</p>
          </div>
        </div>

        {/* Domain Selector */}
        <div className="card">
          <div className="domain-selector">
            {['BNK', 'EDU', 'TRV', 'VAS'].map(dom => (
              <button
                key={dom}
                className={`domain-btn ${selectedDomain === dom ? 'active' : ''}`}
                onClick={() => setSelectedDomain(dom)}
              >
                {dom === 'BNK' ? '🏦 Banking' : 
                 dom === 'EDU' ? '🎓 Education' : 
                 dom === 'TRV' ? '✈️ Travel' : '🎙️ Assistant'}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="card card-center">
            <p>Loading progress...</p>
          </div>
        )}

        {!loading && progressData && (
          <div className="progress-grid">
            {progressData.intents && progressData.intents.map((intent: any) => (
              <div key={intent.intent} className="card">
                <div className="intent-header">
                  <h3>{intent.intent}</h3>
                  <span className="intent-badge">
                    Intent {intent.intent_no} / {intent.total_intents}
                  </span>
                </div>

                {intent.scenarios && intent.scenarios.map((scenario: any) => (
                  <div key={scenario.scenario_no} className="scenario-section">
                    <h4>Scenario {scenario.scenario_no} of {scenario.total_scenarios}</h4>
                    
                    <div className="examples-grid">
                      {scenario.examples && scenario.examples.map((example: any) => (
                        <div key={example.example_no} className="example-item">
                          {example.status === 'recorded' ? (
                            <CheckCircle size={20} className="icon-success" />
                          ) : (
                            <Circle size={20} className="icon-muted" />
                          )}
                          <span>Example {example.example_no}</span>
                          <span className={`status-badge ${example.status}`}>
                            {example.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
