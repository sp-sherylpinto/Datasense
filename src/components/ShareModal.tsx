import React, { useState, useEffect } from 'react';
import { X, Lock, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

interface Share { id: string; shared_with: string; created_at: string; }

interface Props {
  datasetId: string;
  datasetName: string;
  currentUser: string;
  onClose: () => void;
}

export const ShareModal: React.FC<Props> = ({ datasetId, datasetName, currentUser, onClose }) => {
  const [email, setEmail] = useState('');
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const resp = await api.get(`/datasets/${datasetId}/shares`);
      setShares(resp.data);
    } catch {}
  };

  useEffect(() => { load(); }, [datasetId]);

  const grant = async () => {
    if (!email.trim()) return;
    setLoading(true); setError('');
    try {
      await api.post(`/datasets/${datasetId}/shares`, { shared_with: email.trim() });
      setEmail('');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to share');
    } finally { setLoading(false); }
  };

  const revoke = async (shareId: string) => {
    await api.delete(`/datasets/${datasetId}/shares/${shareId}`);
    await load();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-surf border border-border rounded-2xl w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-acc" />
            <h2 className="text-sm font-semibold text-tx">Share — {datasetName}</h2>
          </div>
          <button onClick={onClose}><X size={16} className="text-tx3" /></button>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="email"
            placeholder="colleague@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && grant()}
            className="flex-1 px-3 py-2 text-sm bg-sub border border-border rounded-lg text-tx"
          />
          <button
            onClick={grant}
            disabled={loading}
            className="px-3 py-2 text-sm bg-acc text-white rounded-lg disabled:opacity-50"
          >
            {loading ? '...' : 'Grant'}
          </button>
        </div>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        {shares.length > 0 && (
          <ul className="space-y-2">
            {shares.map(s => (
              <li key={s.id} className="flex items-center justify-between text-xs text-tx2 bg-sub rounded-lg px-3 py-2">
                <span>{s.shared_with}</span>
                <button onClick={() => revoke(s.id)}>
                  <Trash2 size={13} className="text-tx3 hover:text-red-500" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {shares.length === 0 && (
          <p className="text-xs text-tx3 text-center py-2">Not shared with anyone yet.</p>
        )}
      </div>
    </div>
  );
};
