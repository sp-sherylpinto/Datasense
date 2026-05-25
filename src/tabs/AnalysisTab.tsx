import { useMemo, useState } from 'react';
import {
  BarChart3,
  AlertTriangle,
  Activity,
  Layers,
  Network,
} from 'lucide-react';

import type { FileMetadata, JobStatus } from '../lib/types';

import { BenfordTab } from './analysis/BenfordTab';
import { AnomaliesTab } from './analysis/AnomaliesTab';
import { TemporalTab } from './analysis/TemporalTab';
import { ClustersTab } from './analysis/ClustersTab';
import { NetworkTab } from './analysis/NetworkTab';

type AnalysisKey = 'benford' | 'outliers' | 'timeseries' | 'clustering' | 'network';

interface Props {
  file: FileMetadata;
  startJob: (taskName: string, params?: any) => void;
  jobs: Record<string, JobStatus>;
}

const ANALYSIS_OPTIONS = [
  { id: 'benford', label: 'Benford', icon: BarChart3 },
  { id: 'outliers', label: 'Anomalies', icon: AlertTriangle },
  { id: 'timeseries', label: 'Temporal', icon: Activity },
  { id: 'clustering', label: 'Clusters', icon: Layers },
  { id: 'network', label: 'Network', icon: Network },
] as const;

export function AnalysisTab({ file, startJob, jobs }: Props) {
  const [activeAnalysis, setActiveAnalysis] = useState<AnalysisKey>('benford');

  const activeOption = useMemo(
    () => ANALYSIS_OPTIONS.find((o) => o.id === activeAnalysis)!,
    [activeAnalysis]
  );

  const renderAnalysis = () => {
    switch (activeAnalysis) {
      case 'benford':
        return <BenfordTab file={file} startJob={startJob} jobs={jobs} />;
      case 'outliers':
        return <AnomaliesTab file={file} startJob={startJob} jobs={jobs} />;
      case 'timeseries':
        return <TemporalTab file={file} startJob={startJob} jobs={jobs} />;
      case 'clustering':
        return <ClustersTab file={file} startJob={startJob} jobs={jobs} />;
      case 'network':
        return <NetworkTab file={file} startJob={startJob} jobs={jobs} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Clean Top Navigation */}
      <div className="bg-panel border border-border rounded-2xl p-2 flex items-center gap-1 overflow-x-auto">
        {ANALYSIS_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = activeAnalysis === option.id;

          return (
            <button
              key={option.id}
              onClick={() => setActiveAnalysis(option.id)}
              className={`flex items-center gap-2.5 px-6 py-3 rounded-xl whitespace-nowrap transition-all font-medium text-sm
                ${isActive 
                  ? 'bg-acc text-white shadow-sm' 
                  : 'hover:bg-sub text-muted hover:text-fg'
                }`}
            >
              <Icon size={18} />
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Minimal Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-fg">
          {activeOption.label} Analysis
        </h1>
      </div>

      {/* Main Content */}
      <div className="bg-panel border border-border rounded-3xl p-6 shadow-sm">
        {renderAnalysis()}
      </div>
    </div>
  );
}