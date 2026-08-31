import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { toast } from '../components/ui/toast';
import { Skeleton } from '../components/ui/Skeleton';
import {
  Headphones, AlertTriangle, MessageSquare, CheckCircle2, Clock,
  Send, ChevronLeft, Filter, User, Phone, ShoppingBag, Loader2,
  ArrowUpRight, XCircle, RefreshCw,
} from 'lucide-react';

const STATUS_CONFIG = {
  open:         { label: 'Open',         color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',   icon: Clock },
  escalated:    { label: 'Escalated',    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',       icon: AlertTriangle },
  ai_handled:   { label: 'AI Handled',   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: MessageSquare },
  resolved:     { label: 'Resolved',     color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle2 },
};

const CATEGORY_LABELS = {
  order_issue: 'Order Issue',
  complaint: 'Complaint',
  question: 'Question',
  feedback: 'Feedback',
  other: 'Other',
};

const SENDER_STYLES = {
  customer: { bg: 'bg-gray-100 dark:bg-gray-800', align: 'justify-start', label: 'Customer' },
  ai:       { bg: 'bg-brand-50 dark:bg-brand-900/20', align: 'justify-start', label: 'AI Agent' },
  staff:    { bg: 'bg-emerald-50 dark:bg-emerald-900/20', align: 'justify-end', label: 'Staff' },
};

export default function Support() {
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const data = await api.getSupportStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load support stats:', err);
    }
  }, []);

  useEffect(() => {
    loadStats().finally(() => setLoading(false));
  }, [loadStats]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Support Tickets</h1>
          <p className="text-sm text-[var(--text-secondary)]">Customer support conversations — reply, resolve, escalate.</p>
        </div>
        <button
          onClick={() => { loadStats(); if (selectedTicket) setSelectedTicket({ ...selectedTicket, _refresh: true }); }}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Object.entries(STATUS_CONFIG).map(([key, { label, icon: Icon }]) => (
            <button
              key={key}
              onClick={() => setStatusFilter(statusFilter === key ? '' : key)}
              className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${
                statusFilter === key
                  ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/20'
                  : 'border-[var(--border)] bg-white hover:border-gray-300 dark:bg-[var(--surface-2)] dark:hover:border-gray-600'
              }`}
            >
              <Icon className="h-5 w-5 text-[var(--text-tertiary)]" />
              <div>
                <div className="text-lg font-bold text-[var(--text-primary)]">
                  {stats[`${key === 'ai_handled' ? 'ai_handled' : key}_count`] || 0}
                </div>
                <div className="text-xs text-[var(--text-tertiary)]">{label}</div>
              </div>
            </button>
          ))}
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white p-3 dark:bg-[var(--surface-2)]">
            <Headphones className="h-5 w-5 text-[var(--text-tertiary)]" />
            <div>
              <div className="text-lg font-bold text-[var(--text-primary)]">{stats.total_count || 0}</div>
              <div className="text-xs text-[var(--text-tertiary)]">Total</div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      {selectedTicket ? (
        <TicketDetail
          ticket={selectedTicket}
          onBack={() => setSelectedTicket(null)}
          onRefresh={() => { loadStats(); }}
        />
      ) : (
        <TicketList
          statusFilter={statusFilter}
          onSelect={setSelectedTicket}
          loading={loading}
        />
      )}
    </div>
  );
}

// ── Ticket List ──────────────────────────────────────────────────────

function TicketList({ statusFilter, onSelect, loading }) {
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    loadTickets();
  }, [statusFilter]);

  async function loadTickets() {
    try {
      const data = await api.getSupportTickets(statusFilter || undefined);
      setTickets(data.tickets);
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
        <Headphones className="mb-3 h-10 w-10 text-[var(--text-tertiary)]" />
        <p className="text-sm font-medium text-[var(--text-secondary)]">No support tickets</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          {statusFilter ? `No ${STATUS_CONFIG[statusFilter]?.label || ''} tickets.` : 'Tickets appear here when customers reach out via WhatsApp.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tickets.map((ticket) => {
        const statusCfg = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
        const StatusIcon = statusCfg.icon;
        const timeAgo = getTimeAgo(ticket.created_at);

        return (
          <button
            key={ticket.id}
            onClick={() => onSelect(ticket)}
            className="flex w-full items-center gap-4 rounded-xl border border-[var(--border)] bg-white p-4 text-left transition-all hover:border-gray-300 hover:shadow-sm dark:bg-[var(--surface-2)] dark:hover:border-gray-600"
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${statusCfg.color}`}>
              <StatusIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                  {ticket.customer_name || ticket.customer_phone}
                </span>
                <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusCfg.color}`}>
                  {statusCfg.label}
                </span>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  {CATEGORY_LABELS[ticket.category] || ticket.category}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-[var(--text-tertiary)]">
                {ticket.ai_classification || 'No classification yet'}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-[var(--text-tertiary)]">{timeAgo}</div>
              <div className="mt-1 flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
                <Phone className="h-3 w-3" /> {ticket.customer_phone}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Ticket Detail ────────────────────────────────────────────────────

function TicketDetail({ ticket: initialTicket, onBack, onRefresh }) {
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [order, setOrder] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTicketDetail();
  }, [initialTicket?.id]);

  async function loadTicketDetail() {
    if (!initialTicket?.id) return;
    try {
      const data = await api.getSupportTicket(initialTicket.id);
      setTicket(data.ticket);
      setMessages(data.messages);
      setOrder(data.order);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReply() {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await api.replyToSupportTicket(ticket.id, replyText.trim());
      toast.success('Reply sent via WhatsApp');
      setReplyText('');
      await loadTicketDetail();
      onRefresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(newStatus) {
    try {
      await api.updateSupportTicketStatus(ticket.id, newStatus);
      toast.success(`Ticket ${newStatus}`);
      await loadTicketDetail();
      onRefresh();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!ticket) return null;

  const statusCfg = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
  const StatusIcon = statusCfg.icon;

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onBack} className="rounded-lg p-2 text-[var(--text-tertiary)] hover:bg-[var(--surface-2)]">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {ticket.customer_name || 'Unknown Customer'}
            </h2>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${statusCfg.color}`}>
              <StatusIcon className="h-3 w-3" /> {statusCfg.label}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {CATEGORY_LABELS[ticket.category] || ticket.category}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-4 text-xs text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {ticket.customer_phone}</span>
            <span>Created {new Date(ticket.created_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {ticket.status !== 'resolved' && (
            <button
              onClick={() => handleStatusChange('resolved')}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
            </button>
          )}
          {ticket.status === 'resolved' && (
            <button
              onClick={() => handleStatusChange('open')}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reopen
            </button>
          )}
          {ticket.status === 'open' && (
            <button
              onClick={() => handleStatusChange('escalated')}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> Escalate
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Conversation thread */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-[var(--border)] bg-white dark:bg-[var(--surface-2)]">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Conversation</h3>
            </div>
            <div className="max-h-[500px] space-y-3 overflow-y-auto p-4">
              {messages.map((msg) => {
                const style = SENDER_STYLES[msg.sender] || SENDER_STYLES.customer;
                return (
                  <div key={msg.id} className={`flex ${style.align}`}>
                    <div className={`max-w-[80%] rounded-xl px-4 py-3 ${style.bg}`}>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
                          {style.label}
                        </span>
                        <span className="text-[10px] text-[var(--text-tertiary)]">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{msg.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reply form */}
            <div className="border-t border-[var(--border)] p-4">
              <div className="flex gap-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type a reply to send via WhatsApp..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleReply();
                    }
                  }}
                />
                <button
                  onClick={handleReply}
                  disabled={!replyText.trim() || sending}
                  className="flex items-center gap-2 self-end rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </button>
              </div>
              <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">Ctrl+Enter to send</p>
            </div>
          </div>
        </div>

        {/* Sidebar: ticket info */}
        <div className="space-y-4">
          {/* Classification */}
          <div className="rounded-xl border border-[var(--border)] bg-white p-4 dark:bg-[var(--surface-2)]">
            <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--text-tertiary)]">AI Classification</h3>
            <p className="text-sm text-[var(--text-primary)]">
              {ticket.ai_classification || 'Not yet classified'}
            </p>
            {ticket.ai_suggested_resolution && (
              <>
                <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-[var(--text-tertiary)]">Suggested Resolution</h3>
                <p className="text-sm text-[var(--text-secondary)]">{ticket.ai_suggested_resolution}</p>
              </>
            )}
          </div>

          {/* Linked order */}
          {order && (
            <div className="rounded-xl border border-[var(--border)] bg-white p-4 dark:bg-[var(--surface-2)]">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--text-tertiary)]">
                <ShoppingBag className="h-3.5 w-3.5" /> Linked Order
              </h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Order</span>
                  <span className="font-medium text-[var(--text-primary)]">#{order.order_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Status</span>
                  <span className="font-medium capitalize text-[var(--text-primary)]">{order.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Total</span>
                  <span className="font-medium text-[var(--text-primary)]">Rs. {parseFloat(order.total).toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Date</span>
                  <span className="text-[var(--text-primary)]">{new Date(order.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Ticket metadata */}
          <div className="rounded-xl border border-[var(--border)] bg-white p-4 dark:bg-[var(--surface-2)]">
            <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--text-tertiary)]">Details</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Pending Confirmation</span>
                <span className={ticket.pending_confirmation ? 'text-amber-600' : 'text-[var(--text-tertiary)]'}>
                  {ticket.pending_confirmation ? 'Yes' : 'No'}
                </span>
              </div>
              {ticket.resolved_by && (
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Resolved At</span>
                  <span className="text-[var(--text-primary)]">{new Date(ticket.resolved_at).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Utility ──────────────────────────────────────────────────────────

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
