import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { MessageCircle, X, Send, Sparkles, Loader2, Trash2 } from 'lucide-react';

// Quick-action prompts — these surface as clickable chips so the owner can
// get answers without typing a full question. Kept short for mobile.
const QUICK_PROMPTS = [
  "How were sales today?",
  "What's my best seller this week?",
  "Any ingredients running low?",
  "Average order value this month?",
  "Who are my top customers?",
  "Compare weekdays vs weekends",
];

// The opening message the AI shows when the chat is first opened with no
// history. Friendly, sets expectations, and suggests what the owner can ask.
const GREETING = {
  role: 'assistant',
  content: "Assalam-o-Alaikum! I'm your RestoAI assistant. Ask me anything about your sales, orders, customers, or menu — in English or Urdu.",
  isGreeting: true,
};

export default function OwnerChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to the latest message whenever the list changes.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // Build the conversation history array for the API call — just the
  // user/assistant turns, no greeting metadata.
  const getHistory = useCallback(() => {
    return messages
      .filter((m) => !m.isGreeting)
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = getHistory();
      const res = await api.queryInsights(trimmed, history);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.answer }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Sorry, I couldn't process that — ${err.message}. Please try rephrasing.` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function clearChat() {
    setMessages([]);
    setInput('');
  }

  // Global keyboard shortcut: Ctrl/Cmd+J to toggle the chat panel.
  useEffect(() => {
    function handleGlobalKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  return (
    <>
      {/* ── Floating toggle button ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-brand-700 active:scale-95"
          aria-label="Open AI assistant"
          title="AI Assistant (Ctrl+J)"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* ── Chat panel ── */}
      {open && (
        <div className="fixed bottom-4 right-4 z-50 flex h-[min(600px,calc(100vh-2rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-brand-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              <div>
                <p className="text-sm font-semibold">AI Assistant</p>
                <p className="text-[10px] opacity-80">Powered by Qwen · Ctrl+J to toggle</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                  title="Clear conversation"
                  aria-label="Clear conversation"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Close AI assistant"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Messages area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* Greeting (shown when no messages yet) */}
            {messages.length === 0 && (
              <>
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--text-primary)]">
                    {GREETING.content}
                  </div>
                </div>

                {/* Quick prompts */}
                <div className="pt-2">
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                    Try asking
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => sendMessage(prompt)}
                        className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:hover:border-brand-700 dark:hover:bg-brand-900/20"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Message bubbles */}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'rounded-tr-sm bg-brand-600 text-white'
                      : 'rounded-tl-sm bg-[var(--surface-3)] text-[var(--text-primary)]'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
                  <span className="text-xs">Thinking...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="border-t border-[var(--border)] px-3 py-2">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about sales, orders, customers..."
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                disabled={loading}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40 disabled:hover:bg-brand-600"
                aria-label="Send message"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
