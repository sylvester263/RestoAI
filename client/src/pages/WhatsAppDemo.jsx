import { useState } from 'react';
import { api } from '../lib/api';
import { MessageCircle, Send, Loader2, Smartphone, Bot } from 'lucide-react';

export default function WhatsAppDemo() {
  const [phone, setPhone] = useState('+923001111111');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    if (!message.trim()) return;
    setLoading(true);

    // Add user message to chat
    const userMsg = { role: 'customer', text: message };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await api.simulateWhatsApp(phone, message);
      const botMsg = { role: 'bot', text: res.reply, parsed: res.parsed };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'bot', text: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
      setMessage('');
    }
  }

  const sampleMessages = [
    'Mujhe 1 chicken karahi aur 2 naan chahiye',
    'I want mutton karahi and lassi for delivery to DHA Phase 5',
    'kia menu hai?',
    '1 chicken biryani, 1 garlic naan, aur 1 mint raita. JazzCash se pay karunga',
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp Order Demo</h1>
        <p className="text-sm text-gray-500">Simulate WhatsApp ordering without needing the real API</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Chat window */}
        <div className="lg:col-span-2">
          <div className="card flex h-[600px] flex-col p-0 overflow-hidden">
            {/* Chat header */}
            <div className="flex items-center gap-3 border-b border-gray-200 bg-green-600 px-4 py-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                <MessageCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">RestoAI Order Bot</p>
                <p className="text-xs text-green-100">Powered by Qwen AI</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto bg-[#ECE5DD] p-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <MessageCircle className="mb-3 h-12 w-12" />
                  <p className="text-sm">Send a message to start the ordering demo</p>
                  <p className="text-xs mt-1">Try English, Urdu, or Roman Urdu</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-4 py-2 shadow-sm ${
                    msg.role === 'customer'
                      ? 'bg-[#DCF8C6] text-gray-800'
                      : 'bg-white text-gray-800'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                    {msg.parsed && msg.parsed.confidence != null && (
                      <p className="mt-1 text-xs text-gray-400">
                        Confidence: {Math.round(msg.parsed.confidence * 100)}% | Intent: {msg.parsed.intent}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-white px-4 py-2 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="flex gap-2 border-t border-gray-200 bg-white p-3">
              <input
                className="input flex-1"
                placeholder="Type your order message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              />
              <button onClick={handleSend} disabled={loading} className="btn-primary">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {/* Phone config */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Smartphone className="h-4 w-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900">Simulated Phone</h3>
            </div>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>

          {/* Quick messages */}
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Try these messages</h3>
            <div className="space-y-2">
              {sampleMessages.map((msg, i) => (
                <button
                  key={i}
                  onClick={() => { setMessage(msg); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-600 hover:bg-brand-50 hover:border-brand-300 transition-colors"
                >
                  {msg}
                </button>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div className="card bg-gray-50">
            <div className="flex items-center gap-2 mb-3">
              <Bot className="h-4 w-4 text-brand-600" />
              <h3 className="text-sm font-semibold text-gray-900">How it works</h3>
            </div>
            <ol className="space-y-2 text-xs text-gray-600">
              <li>1. Your message is sent to the Qwen AI order parser</li>
              <li>2. AI extracts items, quantities, address, payment method</li>
              <li>3. Items are matched against your restaurant's menu</li>
              <li>4. A draft order is created with pricing</li>
              <li>5. Reply "confirm" to finalize the order</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
