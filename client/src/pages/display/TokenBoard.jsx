import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { displayApi } from '../../lib/api';
import usePolling from '../../hooks/usePolling';
import useEvents from '../../hooks/useEvents';
import { CheckCircle2 } from 'lucide-react';

export default function TokenBoard() {
  const { branchId } = useParams();
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await displayApi.getTokenBoard(branchId);
      setTokens(res.tokens);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  usePolling(load, 3000, { enabled: !!branchId });
  // SSE real-time push for token board updates
  useEvents(`token-board:${branchId}`, load, 5000, { enabled: !!branchId });

  return (
    <div className="min-h-screen bg-gray-950 p-10 text-white">
      <h1 className="mb-10 text-center text-5xl font-bold tracking-wide">Ready for Pickup</h1>

      {loading ? (
        <p className="text-center text-2xl text-gray-500">Loading...</p>
      ) : tokens.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-gray-600">
          <CheckCircle2 className="h-20 w-20" />
          <p className="text-3xl">No orders ready right now</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6 md:grid-cols-4 lg:grid-cols-5">
          {tokens.map((t) => (
            <div key={t.token_number} className="flex flex-col items-center justify-center rounded-2xl bg-brand-600 py-10 shadow-lg">
              <span className="text-7xl font-black">#{t.token_number}</span>
              <span className="mt-2 text-lg text-brand-100">{t.waiting_minutes}m</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
