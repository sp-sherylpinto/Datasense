import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, Send, Loader2 } from 'lucide-react';
import { MarkdownLite } from './MarkdownLite';
import { FeedbackWidget } from './FeedbackWidget';
import { streamAi } from '../lib/sse';

interface Props {
  jobId: string;
}

interface ChatTurn {
  role: 'assistant' | 'user';
  content: string;
  usageId?: string | null;
}

export const AiInsightPanel: React.FC<Props> = ({ jobId }) => {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [followup, setFollowup] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, streaming]);

  const runInitialExplain = async () => {
    setOpen(true);
    if (turns.length > 0 || streaming) return;
    setStreaming(true);
    setTurns([{ role: 'assistant', content: '' }]);
    try {
      const gen = streamAi(`/ai/explain/${jobId}`, {});
      let final = await consumeStream(gen, text =>
        setTurns([{ role: 'assistant', content: text }])
      );
      setTurns([{ role: 'assistant', content: final.text, usageId: final.usageId }]);
    } catch (e: any) {
      setTurns([{ role: 'assistant', content: `_AI service unavailable: ${e?.message || e}_` }]);
    } finally {
      setStreaming(false);
    }
  };

  const sendFollowup = async () => {
    const msg = followup.trim();
    if (!msg || streaming) return;
    setFollowup('');
    const userTurn: ChatTurn = { role: 'user', content: msg };
    const placeholder: ChatTurn = { role: 'assistant', content: '' };
    setTurns(prev => [...prev, userTurn, placeholder]);
    setStreaming(true);
    try {
      const history = turns.map(t => ({ role: t.role, content: t.content }));
      const gen = streamAi(`/ai/chat/${jobId}`, { history, message: msg });
      const final = await consumeStream(gen, text =>
        setTurns(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: text };
          return next;
        })
      );
      setTurns(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: final.text, usageId: final.usageId };
        return next;
      });
    } catch (e: any) {
      setTurns(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: `_AI service unavailable: ${e?.message || e}_` };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="mt-4 border border-border rounded-xl overflow-hidden bg-surf">
      <button
        onClick={open ? () => setOpen(false) : runInitialExplain}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-sub/30 transition-colors text-sm font-medium text-tx"
      >
        <Sparkles size={14} className="text-acc" />
        Key Insights & Audit Recommendations
        {turns.length > 0 && !open && (
          <span className="text-[10px] font-mono text-tx3 ml-1">
            ({turns.length} messages)
          </span>
        )}
        {open ? <ChevronUp size={14} className="ml-auto text-tx3" /> : <ChevronDown size={14} className="ml-auto text-tx3" />}
      </button>

      {open && (
        <div className="border-t border-border">
          <div ref={scrollerRef} className="px-4 py-3 max-h-[480px] overflow-y-auto space-y-4">
            {turns.map((turn, i) => {
              if (turn.role === 'user') {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="bg-acc/10 text-tx text-[12px] rounded-xl rounded-tr-sm px-3 py-2 max-w-[85%] whitespace-pre-wrap">
                      {turn.content}
                    </div>
                  </div>
                );
              }
              const isStreaming = streaming && i === turns.length - 1;
              return (
                <div key={i} className="space-y-2">
                  {isStreaming && !turn.content ? (
                    <div className="text-tx3 animate-pulse text-[12px]">Thinking...</div>
                  ) : (
                    <MarkdownLite text={turn.content} />
                  )}
                  {!isStreaming && turn.content && turn.usageId !== undefined && (
                    <FeedbackWidget usageId={turn.usageId ?? null} />
                  )}
                </div>
              );
            })}
          </div>

          {turns.length > 0 && (
            <div className="border-t border-border bg-sub/20 px-3 py-2 flex items-center gap-2">
              <input
                type="text"
                value={followup}
                onChange={e => setFollowup(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendFollowup(); }}
                disabled={streaming}
                placeholder="Ask a follow-up question..."
                className="flex-1 bg-surf border border-border rounded-lg px-3 py-1.5 text-[12px] text-tx placeholder-tx3 outline-none focus:border-acc disabled:opacity-50"
              />
              <button
                onClick={sendFollowup}
                disabled={streaming || !followup.trim()}
                className="btn btn-acc text-[11px] py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
              >
                {streaming ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Helper to consume stream */
async function consumeStream(
  gen: AsyncGenerator<string, { text: string; usageId: string | null }, void>,
  onProgress: (text: string) => void,
): Promise<{ text: string; usageId: string | null }> {
  let last: { text: string; usageId: string | null } = { text: '', usageId: null };
  while (true) {
    const step = await gen.next();
    if (step.done) {
      last = step.value;
      break;
    }
    onProgress(step.value as string);
  }
  return last;
}