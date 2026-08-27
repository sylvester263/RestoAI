import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Send, Sparkles, Loader2, TrendingUp } from 'lucide-react';

const INSIGHT_STYLES = {
  feature_candidate: { label: 'Feature this', className: 'bg-green-100 text-green-700' },
  pricing_review: { label: 'Pricing review', className: 'bg-amber-100 text-amber-700' },
  low_velocity: { label: 'Low velocity', className: 'bg-gray-100 text-gray-600' },
  low_margin: { label: 'Low margin', className: 'bg-red-100 text-red-700' },
};

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
  const [menuInsights, setMenuInsights] = useState([]);

  useEffect(() => {
    api.getMenuInsights('new').then((res) => setMenuInsights(res.insights)).catch(() => {});
  }, []);

  async function handleInsightStatus(id, status) {
    try {
      await api.updateMenuInsightStatus(id, status);
      setMenuInsights((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      alert(err.message);
    }
  }

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

      {/* Menu/pricing insights (impl-20) — deterministic classification, AI-phrased text */}
      {menuInsights.length > 0 && (
        <div className="card mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <TrendingUp className="h-4 w-4" /> Menu Insights
          </h2>
          <div className="space-y-2">
            {menuInsights.map((insight) => {
              const style = INSIGHT_STYLES[insight.insight_type] || { label: insight.insight_type, className: 'bg-gray-100 text-gray-600' };
              const data = insight.supporting_data || {};
              return (
                <div key={insight.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900">{insight.menu_item_name}</span>
                    <span className={`badge ${style.className}`}>{style.label}</span>
                  </div>
                  <p className="mb-2 text-gray-700">{insight.recommendation}</p>
                  <p className="mb-2 text-xs text-gray-400">
                    {data.units_sold} sold in {data.period_days} days
                    {data.margin_pct !== null && data.margin_pct !== undefined && ` · ${data.margin_pct}% margin`}
                  </p>
                  <div className="flex gap-3 text-xs">
                    <button onClick={() => handleInsightStatus(insight.id, 'acted_on')} className="font-medium text-brand-600 hover:underline">Mark acted on</button>
                    <button onClick={() => handleInsightStatus(insight.id, 'dismissed')} className="font-medium text-gray-500 hover:underline">Dismiss</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
