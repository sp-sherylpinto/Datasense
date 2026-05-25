import { AlertTriangle } from 'lucide-react';

interface Props {
  goToUpload: () => void;
  message?: string;
}

export const EmptyState = ({ goToUpload, message = 'Upload a file or load a saved dataset to run this analysis.' }: Props) => (
  <div className="flex flex-col items-center justify-center py-10 text-center space-y-4 bg-surf border border-border rounded-xl">
    <div className="p-4 bg-warn/10 rounded-full text-warn">
      <AlertTriangle size={28} />
    </div>
    <div>
      <div className="text-[14px] font-medium text-tx">No dataset loaded</div>
      <div className="text-[12px] text-tx2 mt-1">{message}</div>
    </div>
    <button onClick={goToUpload} className="btn btn-acc">
      Go to Data Source
    </button>
  </div>
);
