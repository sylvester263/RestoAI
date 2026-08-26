import { useState, useRef, useEffect } from 'react';
import { publicApi } from '../../lib/api';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';

export default function AIAssistantWidget({ tenantSlug }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'bot', text: "Hi! Ask me for a recommendation — e.g. \"something spicy under Rs. 500\"." },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    try {
      const res = await publicApi.getRecommendation(tenantSlug, text);
      setMessages((m) => [...m, { role: 'bot', text: res.reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'bot', text: `Sorry, I couldn't process that: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700"
        aria-label="Open AI assistant"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-24 right-4 z-40 flex h-[28rem] w-80 max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-gray-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Sparkles className="h-4 w-4 text-brand-600" /> Menu Assistant
        </span>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-800'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-gray-100 p-3">
        <input
          className="input flex-1"
          placeholder="Ask about the menu..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button onClick={handleSend} disabled={loading} className="btn-primary shrink-0 px-3">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
