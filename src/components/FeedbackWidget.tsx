import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Loader2, Check, X } from 'lucide-react';
import { api } from '../lib/api';

interface Props {
  /** ai_usage_log id returned from the AI endpoint. */
  usageId: string | null;
}

/**
 * Inline 👍/👎 widget shown under each AI response. Records to `ai_feedback`
 * joined to the originating `ai_usage_log` row. Optional follow-up textbox
 * appears after a click so users can leave a comment without a modal.
 */
export const FeedbackWidget = ({ usageId }: Props) => {
  const [submitted, setSubmitted] = useState<{ rating: 1 | -1; id: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const [commentSent, setCommentSent] = useState(false);

  if (!usageId) return null;

  const submit = async (rating: 1 | -1) => {
    if (submitting || submitted) return;
    setSubmitting(true);
    try {
      const res = await api.post('/ai/feedback', { usage_id: usageId, rating });
      setSubmitted({ rating, id: res.data.id });
      setShowComment(true);
    } catch {
      // silent — feedback widget should never block the user
    } finally {
      setSubmitting(false);
    }
  };

  const sendComment = async () => {
    if (!comment.trim() || !submitted) return;
    try {
      // Re-record with the comment attached. If the original feedback row
      // exists we'll just insert another (the rating stays the same).
      await api.post('/ai/feedback', {
        usage_id: usageId,
        rating: submitted.rating,
        comment: comment.trim(),
      });
      setCommentSent(true);
      setShowComment(false);
    } catch {}
  };

  return (
    <div className="flex items-center gap-2 text-[11px] mt-3 pt-2 border-t border-border/60">
      <span className="text-tx3 font-mono uppercase tracking-wider mr-1">Helpful?</span>
      <button
        onClick={() => submit(1)}
        disabled={submitting || !!submitted}
        title="Helpful"
        className={`p-1 rounded transition-colors ${
          submitted?.rating === 1
            ? 'text-ok bg-ok/10'
            : submitted
            ? 'text-tx3/40 cursor-default'
            : 'text-tx3 hover:text-ok hover:bg-ok/5'
        }`}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        onClick={() => submit(-1)}
        disabled={submitting || !!submitted}
        title="Not helpful"
        className={`p-1 rounded transition-colors ${
          submitted?.rating === -1
            ? 'text-err bg-err/10'
            : submitted
            ? 'text-tx3/40 cursor-default'
            : 'text-tx3 hover:text-err hover:bg-err/5'
        }`}
      >
        <ThumbsDown size={12} />
      </button>
      {submitting && <Loader2 size={11} className="animate-spin text-tx3" />}
      {submitted && !showComment && !commentSent && (
        <button
          onClick={() => setShowComment(true)}
          className="text-tx3 hover:text-acc text-[10px] font-mono uppercase tracking-wider"
        >
          + add comment
        </button>
      )}
      {commentSent && (
        <span className="text-ok text-[10px] font-mono flex items-center gap-1">
          <Check size={10} /> thanks
        </span>
      )}
      {showComment && submitted && !commentSent && (
        <div className="flex items-center gap-1 flex-1">
          <input
            type="text"
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendComment(); }}
            placeholder={submitted.rating === 1 ? 'What worked?' : "What's wrong?"}
            autoFocus
            className="flex-1 bg-sub border border-border rounded px-2 py-0.5 text-[11px] text-tx outline-none focus:border-acc"
          />
          <button
            onClick={sendComment}
            disabled={!comment.trim()}
            className="text-acc hover:text-acc/70 disabled:opacity-40 px-1"
            title="Send"
          >
            <Check size={11} />
          </button>
          <button
            onClick={() => { setShowComment(false); setCommentSent(true); }}
            className="text-tx3 hover:text-tx px-1"
            title="Skip"
          >
            <X size={11} />
          </button>
        </div>
      )}
    </div>
  );
};
