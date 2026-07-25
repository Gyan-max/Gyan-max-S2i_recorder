import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, CheckCircle, Award, RefreshCw, Sparkles, Layers, ShieldCheck, Mic } from 'lucide-react';
import { API_BASE } from '../config';
import { getUploadQueue, dequeueUpload } from '../db';

interface ProgressPageProps {
  currentSpeaker: any;
  deviceId: string;
}

export default function ProgressPage({ currentSpeaker, deviceId }: ProgressPageProps) {
  const navigate = useNavigate();
  const [progressData, setProgressData] = useState<any>(null);
  const [selectedDomain, setSelectedDomain] = useState('BNK');
  const [loading, setLoading] = useState(false);
  const [queueCount, setQueueCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    if (currentSpeaker) {
      fetchProgress();
      checkOfflineQueue();
    }
  }, [selectedDomain, currentSpeaker]);

  // Automatically sync offline queue when network connectivity is restored
  useEffect(() => {
    const handleOnline = async () => {
      const queue = await getUploadQueue();
      if (queue.length > 0) {
        console.log(`[AutoSync] Network restored – syncing ${queue.length} pending recording(s)…`);
        syncOfflineQueue();
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const checkOfflineQueue = async () => {
    try {
      const queue = await getUploadQueue();
      setQueueCount(queue.length);
    } catch (e) {
      console.error(e);
    }
  };

  const syncOfflineQueue = async () => {
    setIsSyncing(true);
    try {
      const queue = await getUploadQueue();
      for (const item of queue) {
        try {
          const formData = new FormData();
          formData.append('file', item.blob, 'audio_record');
          const res = await fetch(`${API_BASE}/clips/upload?clip_id=${item.clipId}`, {
            method: 'POST',
            headers: { 'X-Device-ID': item.deviceId },
            body: formData
          });
          if (res.ok) {
            await dequeueUpload(item.clipId);
          }
        } catch (e) {
          console.error(e);
        }
      }
      await checkOfflineQueue();
      fetchProgress();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing(false);
    }
  };

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

  const handleRecordPromptClick = (exampleNo: number) => {
    navigate(`/?domain=${selectedDomain}&example=${exampleNo}`);
  };

  // Calculate statistics across intents
  const calculateStats = () => {
    if (!progressData?.intents) return { recorded: 0, total: 0, percentage: 0 };
    let recorded = 0;
    let total = 0;

    progressData.intents.forEach((intent: any) => {
      intent.scenarios?.forEach((scenario: any) => {
        scenario.examples?.forEach((ex: any) => {
          total++;
          if (ex.status === 'recorded' || ex.status === 'confirmed') recorded++;
        });
      });
    });

    const percentage = total > 0 ? Math.round((recorded / total) * 100) : 0;
    return { recorded, total, percentage };
  };

  const stats = calculateStats();

  if (!currentSpeaker) {
    return (
      <div className="page-container">
        <div className="content-wrapper">
          <div className="card card-center glass-card">
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
            <span className="eyebrow"><Sparkles size={14} style={{ display: 'inline', marginRight: 4 }} /> Contribution Analytics</span>
            <h1>Recording Progress</h1>
            <p>Track your recordings and unlock contributor badges across domains</p>
          </div>
          {queueCount > 0 && (
            <div className="offline-sync-card glass-card">
              <span className="sync-badge">{queueCount} pending offline</span>
              <button 
                className="btn btn-secondary btn-sm"
                onClick={syncOfflineQueue}
                disabled={isSyncing}
              >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
          )}
        </div>

        {/* Global Stats Summary & Achievements */}
        <div className="progress-summary-bar glass-card card">
          <div className="summary-metric">
            <span className="metric-label">Completed Prompts</span>
            <span className="metric-value">{stats.recorded} <span className="metric-total">/ {stats.total}</span></span>
          </div>

          <div className="summary-progress-wrapper">
            <div className="summary-progress-header">
              <span>Overall Progress</span>
              <span className="progress-percent">{stats.percentage}%</span>
            </div>
            <div className="progress-bar-container">
              <div 
                className="progress-bar-fill complete" 
                style={{ width: `${stats.percentage}%` }}
              />
            </div>
          </div>

          <div className="achievements-pills">
            <div className={`badge-pill ${stats.recorded >= 1 ? 'unlocked' : ''}`}>
              <Award size={14} /> <span>First Recording</span>
            </div>
            <div className={`badge-pill ${stats.recorded >= 5 ? 'unlocked' : ''}`}>
              <ShieldCheck size={14} /> <span>Voice Scholar</span>
            </div>
            <div className={`badge-pill ${stats.percentage === 100 && stats.total > 0 ? 'unlocked' : ''}`}>
              <Layers size={14} /> <span>Domain Master</span>
            </div>
          </div>
        </div>

        {/* Domain Selector */}
        <div className="card glass-card">
          <div className="domain-selector">
            {[
              { id: 'BNK', label: '🏦 Banking' },
              { id: 'EDU', label: '🎓 Education' },
              { id: 'TRV', label: '✈️ Travel' },
              { id: 'VAS', label: '🎙️ Assistant' }
            ].map(dom => (
              <button
                key={dom.id}
                className={`domain-btn ${selectedDomain === dom.id ? 'active' : ''}`}
                onClick={() => setSelectedDomain(dom.id)}
              >
                {dom.label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="card card-center glass-card">
            <RefreshCw size={24} className="animate-spin icon-accent" />
            <p style={{ marginTop: 8 }}>Loading progress analytics...</p>
          </div>
        )}

        {!loading && progressData && (
          <div className="progress-grid">
            {progressData.intents && progressData.intents.map((intent: any) => (
              <div key={intent.intent} className="card glass-card intent-progress-card">
                <div className="intent-header">
                  <div>
                    <h3>{intent.intent.replace(/^[A-Z]+\./, '').replace(/_/g, ' ')}</h3>
                    <p className="intent-sub">{intent.intent}</p>
                  </div>
                  <span className="intent-badge">
                    Intent {intent.intent_no} of {intent.total_intents}
                  </span>
                </div>

                {intent.scenarios && intent.scenarios.map((scenario: any) => (
                  <div key={scenario.scenario_no} className="scenario-section">
                    <div className="scenario-title-bar">
                      <h4>Scenario {scenario.scenario_no} of {scenario.total_scenarios}</h4>
                    </div>
                    
                    <div className="examples-grid">
                      {scenario.examples && scenario.examples.map((example: any) => {
                        const isDone = example.status === 'recorded' || example.status === 'confirmed';
                        return (
                          <div 
                            key={example.example_no} 
                            className={`example-item ${isDone ? 'completed' : ''} clickable-prompt`}
                            onClick={() => handleRecordPromptClick(example.example_no)}
                            title={isDone ? "Click to re-record this prompt" : "Click to record this prompt now"}
                            style={{ cursor: 'pointer' }}
                          >
                            {isDone ? (
                              <CheckCircle size={18} className="icon-success" />
                            ) : (
                              <Mic size={18} className="icon-accent" />
                            )}
                            <span className="example-title">Prompt {example.example_no}</span>
                            <span className={`status-badge ${example.status}`}>
                              {example.status}
                            </span>
                          </div>
                        );
                      })}
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
