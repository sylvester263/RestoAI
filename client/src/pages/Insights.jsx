import { useState } from 'react';
import { api } from '../lib/api';
import { Send, Sparkles, Loader2 } from 'lucide-react';

const SAMPLE_QUESTIONS = [
  "What was my best-selling item this week?",
  "How many orders did I get today?",
  "Which payment method is most popular?",
  "What's my average order value?",
  "Who are my top 5 customers?",
  "mujhe pichle hafte ki sales batao",
];

export default function Insights() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  async function handleAsk(q) {
    const query = q || question;
    if (!query.trim()) return;

    setLoading(true);
    setAnswer('');
    try {
      const res = await api.queryInsights(query);
      setAnswer(res.answer);
      setHistory((prev) => [{ question: query, answer: res.answer }, ...prev].slice(0, 10));
    } catch (err) {
      setAnswer(`Error: ${err.message}`);
    } finally {
      setLoading(false);
      setQuestion('');
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI Insights</h1>
        <p className="text-sm text-gray-500">Ask questions about your restaurant data in English or Urdu</p>
      </div>

      {/* Query input */}
      <div className="card mb-6">
        <div className="flex gap-3">
          <input
            className="input flex-1"
            placeholder="Ask anything about your sales, orders, customers..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          />
          <button onClick={() => handleAsk()} disabled={loading} className="btn-primary">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Ask
          </button>
        </div>

        {/* Quick suggestions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => handleAsk(q)}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Current answer */}
      {answer && (
        <div className="card mb-6 border-brand-200 bg-brand-50">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-brand-600" />
            <div>
              <p className="mb-1 text-xs font-medium text-brand-600">AI Answer</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{answer}</p>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-sm text-gray-500 py-8 justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
          Analyzing your data with Qwen AI...
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Recent Queries</h2>
          <div className="space-y-3">
            {history.map((h, i) => (
              <div key={i} className="card p-4">
                <p className="mb-1 text-sm font-medium text-gray-700">Q: {h.question}</p>
                <p className="text-sm text-gray-500">{h.answer}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
