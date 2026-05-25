import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Send, RefreshCw, User, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import type { FileMetadata } from '../lib/types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface Props {
  file: FileMetadata | null;
}

const SUGGESTIONS = [
  'What does this dataset contain?',
  'Which columns are best for analysis?',
  'How do I detect anomalies?',
  'What does Quality Profile check for?',
];

export const AIChatBot = ({ file }: Props) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [labelVisible, setLabelVisible] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hide "Ask AI" label after 4s
  useEffect(() => {
    const t = setTimeout(() => setLabelVisible(false), 4000);
    return () => clearTimeout(t);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Focus input when opened, set welcome message
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
      if (messages.length === 0) {
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          text: file
            ? `Hi! I can see **${file.name}** is loaded with ${file.row_count_approx?.toLocaleString()} rows and ${file.columns?.length} columns. What would you like to know?`
            : `Hi! I'm your audit data assistant. Upload a dataset and I can help you understand it, suggest analyses, or answer questions about the tool.`,
        }]);
      }
    }
  }, [open]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Use dataview-query endpoint for general data questions
      const columns = file?.columnMeta?.map(c => ({ name: c.name, type: c.inferred_type }))
        ?? file?.columns?.map(c => ({ name: c, type: 'text' }))
        ?? [];

      const sampleRows = file?.preview?.slice(0, 5) ?? [];

      // Build a context-rich prompt
      const contextPrompt = `${text.trim()}

${!file ? 'No dataset is currently loaded.' : ''}`;

      const res = await api.post('/ai/dataview-query', {
        prompt: contextPrompt,
        columns,
        sample_rows: sampleRows,
        table_name: (file as any)?.table_name ?? null,
        dataset_id: file?.dataset_id ?? null,
      });

      const reply = res.data?.answer
        || res.data?.reply
        || res.data?.text
        || res.data?.sql
        || 'I could not generate a response. Please try rephrasing.';

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: reply,
      }]);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: detail
          ? `Sorry, I ran into an issue: ${detail}`
          : 'Sorry, something went wrong. Please try again.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const clearChat = () => {
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      text: file
        ? `Hi! I can see **${file.name}** is loaded. What would you like to know?`
        : `Hi! I'm your audit data assistant. How can I help?`,
    }]);
  };

  // Simple **bold** renderer
  const renderText = (text: string) =>
    text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : <span key={i}>{part}</span>
    );

  return (
    <>
      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="fixed bottom-24 right-4 sm:right-6 z-50 w-[calc(100vw-32px)] sm:w-[380px] bg-surf border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: 'min(520px, calc(100vh - 120px))' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-sub/40 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-acc/10 flex items-center justify-center">
                  <Sparkles size={14} className="text-acc" />
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-tx">Audit Assistant</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse" />
                    <p className="text-[10px] text-tx3">Online</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={clearChat} className="p-1.5 rounded-md text-tx3 hover:text-tx hover:bg-sub transition-colors" title="Clear chat">
                  <RefreshCw size={13} />
                </button>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-md text-tx3 hover:text-tx hover:bg-sub transition-colors">
                  <ChevronDown size={15} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {messages.map(msg => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${msg.role === 'assistant' ? 'bg-acc/10' : 'bg-sub border border-border'}`}>
                    {msg.role === 'assistant'
                      ? <Sparkles size={11} className="text-acc" />
                      : <User size={11} className="text-tx3" />}
                  </div>
                  <div className={`max-w-[82%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user' ? 'bg-acc text-white rounded-tr-sm' : 'bg-sub text-tx rounded-tl-sm'
                  }`}>
                    {renderText(msg.text)}
                  </div>
                </motion.div>
              ))}

              {/* Typing indicator */}
              {loading && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-2"
                >
                  <div className="w-6 h-6 rounded-full bg-acc/10 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={11} className="text-acc" />
                  </div>
                  <div className="bg-sub px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
                    {[0, 150, 300].map(delay => (
                      <span key={delay} className="w-1.5 h-1.5 bg-tx3/50 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </div>
                </motion.div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Suggestions — only on first open */}
            {messages.length === 1 && !loading && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5 flex-shrink-0">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-[10px] px-2.5 py-1 rounded-full border border-border text-tx2 hover:border-acc hover:text-acc hover:bg-acc/5 transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="px-3 py-3 border-t border-border flex-shrink-0">
              <div className="flex items-center gap-2 bg-sub/50 rounded-xl border border-border focus-within:border-acc transition-colors px-3 py-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your data…"
                  disabled={loading}
                  className="flex-1 bg-transparent text-[12px] text-tx placeholder:text-tx3 focus:outline-none"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || loading}
                  className="p-1.5 rounded-lg bg-acc text-white disabled:opacity-30 hover:bg-acc/90 transition-colors flex-shrink-0"
                >
                  <Send size={12} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating button with "Ask AI" animated label */}
      <div className="fixed bottom-6 right-4 sm:right-6 z-50 flex items-center gap-3">
        {/* Label — fades in then out, reappears on hover */}
        <AnimatePresence>
          {(labelVisible || !open) && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: labelVisible ? 1 : 0 }}
              exit={{ opacity: 0, x: 10 }}
              whileHover={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="group-hover:opacity-100 pointer-events-none"
            >
              {!open && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.9, x: 8 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9, x: 8 }}
                  transition={{ duration: 0.25, delay: 0.1 }}
                  className="bg-tx text-bg text-[11px] font-medium px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap"
                >
                  Ask AI ✨
                </motion.span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          onClick={() => { setOpen(o => !o); setLabelVisible(false); }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.93 }}
          className="relative w-13 h-13 rounded-full bg-acc shadow-xl flex items-center justify-center text-white hover:bg-acc/90 transition-colors"
          style={{ width: 52, height: 52 }}
          title="Ask AI"
        >
          {/* Pulse ring when closed */}
          {!open && (
            <motion.div
              className="absolute inset-0 rounded-full bg-acc/30"
              animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}

          <AnimatePresence mode="wait">
            {open
              ? <motion.div key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <X size={20} />
                </motion.div>
              : <motion.div key="spark" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <Sparkles size={20} />
                </motion.div>
            }
          </AnimatePresence>
        </motion.button>
      </div>
    </>
  );
};
