"use client";

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Plus, Search, Trash2, X, Repeat,
  CreditCard, Banknote, ArrowRightLeft, Download,
} from 'lucide-react';

// ─── Config ──────────────────────────────────────────────────────────────────
const API_URL = process.env.NEXT_PUBLIC_SHEETS_API_URL || '';

const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other'];
const CATEGORY_COLORS: Record<string, string> = {
  Food: '#f97316', Transport: '#3b82f6', Shopping: '#a855f7',
  Bills: '#ef4444', Entertainment: '#10b981', Other: '#64748b',
};

// ─── Types ────────────────────────────────────────────────────────────────────
type PaymentMethod = 'card' | 'cash';
type TxType = 'expense' | 'income' | 'transfer';
type View = 'dashboard' | 'wallets';

interface Transaction {
  id?: string;
  date: string;
  amount: number | string;
  category: string;
  description: string;
  paymentMethod?: PaymentMethod;
  type?: TxType;
}

interface Recurring {
  description: string;
  amount: number | string;
  category: string;
  dayOfMonth: number;
  startDate: string;
}

interface WalletState {
  cardBalance: number;
  cashBalance: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', maximumFractionDigits: 0 }).format(n);

const toAmt = (v: number | string) => (typeof v === 'string' ? parseFloat(v) : v) || 0;

// Generates a unique id even if two transactions are added in the same millisecond.
const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ── Timezone-safe date helpers ────────────────────────────────────────────────
// "2026-06-10" parsed with new Date() can land on Jun 9 depending on the
// browser's timezone offset — so we NEVER pass ISO strings to the Date
// constructor directly. Always go through these:
const parseLocalDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const localToday = (): Date => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

const toDateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const getMonthKey = (s: string): string => {
  const d = parseLocalDate(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const getMonthLabel = (monthKey: string): string => {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const getDayLabel = (s: string): string => {
  const date = parseLocalDate(s);
  const today = localToday();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const currentMonthKey = (): string => getMonthKey(toDateKey(localToday()));

// Applies a transaction's effect on wallet balances. One place, one source
// of truth — previously this math was duplicated across add/withdraw/income
// and had drifted slightly out of sync between the three.
const applyToWallet = (w: WalletState, tx: { type: TxType; amount: number; paymentMethod?: PaymentMethod }): WalletState => {
  if (tx.type === 'transfer') {
    // Card → Cash withdrawal
    return { cardBalance: w.cardBalance - tx.amount, cashBalance: w.cashBalance + tx.amount };
  }
  const sign = tx.type === 'income' ? 1 : -1;
  if (tx.paymentMethod === 'card') return { ...w, cardBalance: w.cardBalance + sign * tx.amount };
  if (tx.paymentMethod === 'cash') return { ...w, cashBalance: w.cashBalance + sign * tx.amount };
  return w;
};

// ─── Sub-components ───────────────────────────────────────────────────────────
const CategoryBadge = ({ cat }: { cat: string }) => (
  <span
    className="text-xs font-medium px-2 py-0.5 rounded-full"
    style={{
      background: (CATEGORY_COLORS[cat] || '#64748b') + '22',
      color: CATEGORY_COLORS[cat] || '#64748b',
      border: `1px solid ${(CATEGORY_COLORS[cat] || '#64748b')}44`,
    }}
  >
    {cat}
  </span>
);

const Toast = ({ message, type, onClose }: { message: string; type: 'error' | 'success'; onClose: () => void }) => (
  <div
    className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl text-sm font-medium"
    style={{
      background: type === 'error' ? '#ef444422' : '#10b98122',
      border: `1px solid ${type === 'error' ? '#ef4444' : '#10b981'}44`,
      color: type === 'error' ? '#ef4444' : '#10b981',
    }}
  >
    {message}
    <button onClick={onClose}><X size={14} /></button>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ExpenseTracker() {
  // ── Core state ──
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // ── Navigation ──
  const [view, setView] = useState<View>('dashboard');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  // ── Form state ──
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<TxType>('expense');
  const [date, setDate] = useState(toDateKey(localToday()));
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');

  // ── Wallet ──
  const [wallet, setWallet] = useState<WalletState>({ cardBalance: 0, cashBalance: 0 });
  const [editingWallet, setEditingWallet] = useState<'card' | 'cash' | null>(null);
  const [walletInput, setWalletInput] = useState('');

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Load wallet from localStorage ──
  // Runs once. We gate the *save* effect behind prefsLoaded so it can never
  // fire with default values before this has had a chance to populate state
  // (previously both effects ran on first render, and depending on timing
  // the save effect could stomp the just-loaded values with zeros).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cashflow_wallet');
      if (saved) setWallet(JSON.parse(saved));
    } catch {
      // ignore malformed/missing storage
    } finally {
      setPrefsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    localStorage.setItem('cashflow_wallet', JSON.stringify(wallet));
  }, [wallet, prefsLoaded]);

  useEffect(() => {
    if (API_URL) {
      fetchTransactions();
    } else {
      setIsLoading(false);
      showToast('API URL not configured. Set NEXT_PUBLIC_SHEETS_API_URL in .env.local', 'error');
    }
  }, []);

  const showToast = (message: string, type: 'error' | 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchTransactions = async () => {
    if (!API_URL) {
      setIsLoading(false);
      showToast('API URL not configured. Please set NEXT_PUBLIC_SHEETS_API_URL.', 'error');
      return;
    }
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      const sorted = (data.transactions || [])
        .map((t: Transaction, i: number) => ({ ...t, id: t.id ?? String(i) }))
        .sort((a: Transaction, b: Transaction) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime());
      setTransactions(sorted);
      setRecurring(data.recurring || []);
    } catch (e) {
      showToast('Failed to load transactions. Check your connection.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Recurring bills active as of today ──────────────────────────────────
  const recurringActive = useMemo(
    () => recurring.filter(b => parseLocalDate(b.startDate) <= localToday()),
    [recurring]
  );
  const recurringTotal = useMemo(
    () => recurringActive.reduce((s, b) => s + toAmt(b.amount), 0),
    [recurringActive]
  );

  // ─── Search filter ────────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      transactions.filter(
        t =>
          (t.description ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.category.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [transactions, searchQuery]
  );

  // ─── Grouped by calendar month ────────────────────────────────────────────
  const groupedByMonth = useMemo(() => {
    const groups: Record<string, { label: string; total: number; income: number; transactions: Transaction[] }> = {};
    filtered.forEach(t => {
      if (!t.date) return;
      const key = getMonthKey(t.date);
      if (!groups[key]) groups[key] = { label: getMonthLabel(key), total: 0, income: 0, transactions: [] };
      if (t.type === 'income') {
        groups[key].income += toAmt(t.amount);
      } else if (t.type !== 'transfer') {
        // Transfers (card -> cash withdrawals) move money between your own
        // wallets — they aren't spending, so they're excluded from totals
        // but still shown in the list for a full record.
        groups[key].total += toAmt(t.amount);
      }
      groups[key].transactions.push(t);
    });
    return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1)); // newest month first
  }, [filtered]);

  // ─── Current month summary (for dashboard header) ─────────────────────────
  const thisMonthKey = currentMonthKey();
  const thisMonthData = useMemo(
    () => groupedByMonth.find(([key]) => key === thisMonthKey)?.[1] ?? { total: 0, income: 0, transactions: [] as Transaction[] },
    [groupedByMonth, thisMonthKey]
  );
  const monthSpend = thisMonthData.total + recurringTotal;
  const netThisMonth = thisMonthData.income - monthSpend;

  // ─── Detail view: transactions grouped by day for a selected month ────────
  const selectedMonthData = useMemo(() => {
    if (!selectedMonth) return null;
    const entry = groupedByMonth.find(g => g[0] === selectedMonth);
    if (!entry) return null;
    const [, data] = entry;
    const byDay: Record<string, Transaction[]> = {};
    data.transactions.forEach(t => {
      const label = getDayLabel(t.date);
      if (!byDay[label]) byDay[label] = [];
      byDay[label].push(t);
    });
    return { ...data, byDay };
  }, [selectedMonth, groupedByMonth]);

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const resetForm = () => {
    setAmount('');
    setDescription('');
    setCategory(CATEGORIES[0]);
    setDate(toDateKey(localToday()));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      showToast('Enter a valid amount.', 'error');
      return;
    }
    if (!API_URL) {
      showToast('API URL is not configured.', 'error');
      return;
    }

    setIsSubmitting(true);
    const newTx: Transaction = {
      id: makeId(),
      date,
      amount: amt,
      // Transfers have no category/description of their own — fixed bug
      // where a stale category/description from a previous expense entry
      // could leak into a transfer record.
      category: formType === 'transfer' ? 'Other' : category,
      description: formType === 'transfer' ? 'Card → Cash withdrawal' : (description || 'No description'),
      paymentMethod: formType === 'transfer' ? undefined : paymentMethod,
      type: formType,
    };

    try {
      await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(newTx),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      });
      setTransactions(prev => [newTx, ...prev]);
      setWallet(w => applyToWallet(w, { type: formType, amount: amt, paymentMethod }));
      resetForm();
      setShowForm(false);
      showToast('Transaction saved!', 'success');
    } catch (e) {
      showToast('Failed to save. Try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!API_URL) {
      showToast('API URL is not configured.', 'error');
      return;
    }
    setDeletingId(id);
    try {
      await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ _delete: true, id }),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      });
      setTransactions(prev => prev.filter(t => t.id !== id));
      showToast('Deleted.', 'success');
    } catch (e) {
      showToast('Delete failed.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleQuickWithdraw = async (amt: number) => {
    if (!amt || amt <= 0) return;
    const tx: Transaction = {
      id: makeId(),
      date: toDateKey(localToday()),
      amount: amt,
      category: 'Other',
      description: 'Card → Cash withdrawal',
      type: 'transfer',
    };
    setWallet(w => applyToWallet(w, { type: 'transfer', amount: amt }));
    setTransactions(prev => [tx, ...prev]);
    if (API_URL) {
      try {
        await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify(tx),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        });
      } catch {
        showToast('Saved locally, but failed to sync withdrawal.', 'error');
        return;
      }
    }
    showToast(`Withdrew ${fmt(amt)} to cash`, 'success');
  };

  const exportCSV = () => {
    const rows = [['Date', 'Description', 'Category', 'Amount (LKR)', 'Payment', 'Type']];
    transactions.forEach(t => {
      rows.push([t.date, t.description, t.category, String(toAmt(t.amount)), t.paymentMethod || '', t.type || 'expense']);
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cashflow_export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  const navItems: { id: View; label: string; icon: any }[] = [
    { id: 'dashboard', label: 'Home', icon: ArrowRightLeft },
    { id: 'wallets', label: 'Wallets', icon: CreditCard },
  ];

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: '#060810', minHeight: '100vh' }} className="text-slate-200">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Top nav ── */}
      <div style={{ background: '#080b12', borderBottom: '1px solid #1a2030' }} className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {(view !== 'dashboard' || selectedMonth) && (
            <button
              onClick={() => {
                if (selectedMonth) setSelectedMonth(null);
                else setView('dashboard');
              }}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase leading-none mb-0.5">Cashflow</p>
            <p className="text-xs text-slate-600">{getMonthLabel(thisMonthKey)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-colors" title="Export CSV">
            <Download size={16} />
          </button>
          {view === 'dashboard' && !selectedMonth && (
            <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="flex items-center gap-2 rounded-xl px-3 py-1.5">
              <Search size={13} className="text-slate-500" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="bg-transparent text-sm text-slate-300 placeholder-slate-600 focus:outline-none w-28"
              />
            </div>
          )}
          <button
            onClick={() => setShowForm(v => !v)}
            style={{ background: showForm ? '#1a2030' : '#2563eb' }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-white transition-colors"
          >
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? 'Cancel' : 'Add'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 720 }} className="mx-auto px-4 pb-24">
        {/* ── Add form ── */}
        {showForm && (
          <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5 mt-4 mb-2">
            {/* Type tabs */}
            <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: '#060810' }}>
              {(['expense', 'income', 'transfer'] as TxType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFormType(t)}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
                  style={{
                    background: formType === t ? (t === 'income' ? '#10b981' : t === 'transfer' ? '#f59e0b' : '#ef4444') : 'transparent',
                    color: formType === t ? '#fff' : '#64748b',
                  }}
                >
                  {t === 'transfer' ? '⇄ Withdraw' : t === 'income' ? '↑ Income' : '↓ Expense'}
                </button>
              ))}
            </div>

            <form onSubmit={handleAdd} className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                style={{ background: '#060810', border: '1px solid #1a2030' }}
                className="rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
              />
              <input
                type="number"
                step="1"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Amount (LKR)"
                required
                style={{ background: '#060810', border: '1px solid #1a2030' }}
                className="rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
              />

              {formType !== 'transfer' && (
                <>
                  <input
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Description"
                    style={{ background: '#060810', border: '1px solid #1a2030' }}
                    className="col-span-2 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
                  />

                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    style={{ background: '#060810', border: '1px solid #1a2030', color: CATEGORY_COLORS[category] }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-blue-500/50"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c} style={{ color: CATEGORY_COLORS[c] }}>{c}</option>
                    ))}
                  </select>

                  {/* Payment method */}
                  <div className="flex gap-2">
                    {(['card', 'cash'] as PaymentMethod[]).map(pm => (
                      <button
                        key={pm}
                        type="button"
                        onClick={() => setPaymentMethod(pm)}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
                        style={{
                          background: paymentMethod === pm ? '#1e3a5f' : '#060810',
                          border: `1px solid ${paymentMethod === pm ? '#3b82f6' : '#1a2030'}`,
                          color: paymentMethod === pm ? '#60a5fa' : '#64748b',
                        }}
                      >
                        {pm === 'card' ? <CreditCard size={13} /> : <Banknote size={13} />}
                        {pm === 'card' ? 'Card' : 'Cash'}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {formType === 'transfer' && (
                <p className="col-span-2 text-xs text-slate-500 -mt-1">
                  Moves money from your card balance to your cash balance.
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                style={{ background: formType === 'income' ? '#10b981' : formType === 'transfer' ? '#f59e0b' : '#2563eb' }}
                className="col-span-2 rounded-xl py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isSubmitting ? 'Saving…' : formType === 'transfer' ? 'Record Withdrawal' : formType === 'income' ? 'Record Income' : 'Save Expense'}
              </button>
            </form>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-24 text-slate-500">Loading…</div>
        ) : (
          <>
            {/* ══ MONTH DETAIL VIEW ══ */}
            {view === 'dashboard' && selectedMonth && selectedMonthData && (
              <div className="mt-4">
                <p className="text-sm font-semibold text-slate-400 mb-4">{selectedMonthData.label}</p>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Spent</p>
                    <p className="text-xl font-bold text-white">{fmt(selectedMonthData.total)}</p>
                  </div>
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Income</p>
                    <p className="text-xl font-bold text-white">{fmt(selectedMonthData.income)}</p>
                  </div>
                </div>

                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl overflow-hidden">
                  {Object.entries(selectedMonthData.byDay).map(([dayLabel, txs]) => (
                    <div key={dayLabel}>
                      <div style={{ borderBottom: '1px solid #1a2030', background: '#080b12' }} className="flex justify-between px-5 py-2">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{dayLabel}</span>
                      </div>
                      {txs.map((t, i) => (
                        <div
                          key={t.id ?? i}
                          style={{ borderBottom: '1px solid #1a203020' }}
                          className="flex items-center gap-3 px-5 py-3 group hover:bg-white/[0.02] transition-colors"
                        >
                          <span style={{ background: CATEGORY_COLORS[t.category] || '#64748b', flexShrink: 0 }} className="w-2 h-2 rounded-full" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-200 truncate">{t.description}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <CategoryBadge cat={t.category} />
                              {t.paymentMethod && (
                                <span className="text-xs text-slate-600 flex items-center gap-0.5">
                                  {t.paymentMethod === 'card' ? <CreditCard size={10} /> : <Banknote size={10} />}
                                </span>
                              )}
                              {t.type === 'transfer' && <span className="text-xs text-amber-500">Withdrawal</span>}
                            </div>
                          </div>
                          <span
                            className="text-sm font-bold tabular-nums"
                            style={{ color: t.type === 'income' ? '#10b981' : t.type === 'transfer' ? '#f59e0b' : '#fff' }}
                          >
                            {t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄' : ''}{fmt(toAmt(t.amount))}
                          </span>
                          <button
                            onClick={() => t.id && handleDelete(t.id)}
                            disabled={deletingId === t.id}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400"
                          >
                            {deletingId === t.id ? <span className="text-xs">…</span> : <Trash2 size={13} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ DASHBOARD ══ */}
            {view === 'dashboard' && !selectedMonth && (
              <div className="mt-4 space-y-4">
                {/* ── Hero: this month's totals ── */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5">
                  <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase mb-1">This Month</p>
                  <p className="text-4xl font-black text-white tracking-tight">{fmt(monthSpend)}</p>
                  {thisMonthData.income > 0 && (
                    <p className="text-sm mt-1" style={{ color: netThisMonth >= 0 ? '#10b981' : '#ef4444' }}>
                      {netThisMonth >= 0 ? '↑' : '↓'} {fmt(Math.abs(netThisMonth))} net {netThisMonth >= 0 ? 'saved' : 'over'}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div>
                      <p className="text-xs text-slate-500">Income</p>
                      <p className="text-base font-bold text-emerald-400">{fmt(thisMonthData.income)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Recurring bills</p>
                      <p className="text-base font-bold text-slate-300">{fmt(recurringTotal)}</p>
                    </div>
                  </div>
                </div>

                {/* ── Recurring ── */}
                {recurringActive.length > 0 && (
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Repeat size={12} />Recurring
                      </p>
                      <span className="text-sm font-bold text-white">{fmt(recurringTotal)}/mo</span>
                    </div>
                    <div className="space-y-2.5">
                      {recurringActive.map((b, i) => (
                        <div key={i} className="flex justify-between items-center text-sm">
                          <div className="flex items-center gap-2">
                            <span style={{ background: CATEGORY_COLORS[b.category] || '#64748b' }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
                            <span className="text-slate-300">{b.description}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-600">Day {b.dayOfMonth}</span>
                            <span className="font-bold">{fmt(toAmt(b.amount))}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Month cards ── */}
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest pt-2">History</p>
                {groupedByMonth.length === 0 ? (
                  <p className="text-sm text-slate-600 text-center py-6">No transactions yet. Tap Add to log one.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {groupedByMonth.map(([key, data]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedMonth(key)}
                        style={{ background: '#0d1220', border: '1px solid #1a2030' }}
                        className="rounded-2xl p-4 text-left hover:border-blue-500/30 transition-colors group"
                      >
                        <p className="text-xs text-slate-500 mb-1 uppercase tracking-widest">{data.label}</p>
                        <p className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">{fmt(data.total)}</p>
                        <p className="text-xs text-slate-600 mt-0.5">{data.transactions.length} transactions</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══ WALLETS VIEW ══ */}
            {view === 'wallets' && (
              <div className="mt-4 space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Wallets</p>

                {/* Card wallet */}
                <div
                  style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0d1220 100%)', border: '1px solid #2563eb44' }}
                  className="rounded-2xl p-5"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-blue-400">
                      <CreditCard size={18} />
                      <span className="font-semibold">Card Balance</span>
                    </div>
                    <button
                      onClick={() => { setEditingWallet('card'); setWalletInput(String(wallet.cardBalance)); }}
                      className="text-xs text-blue-300 hover:text-white"
                    >
                      Edit
                    </button>
                  </div>
                  {editingWallet === 'card' ? (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={walletInput}
                        onChange={e => setWalletInput(e.target.value)}
                        autoFocus
                        style={{ background: '#060810', border: '1px solid #2563eb' }}
                        className="flex-1 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
                      />
                      <button
                        onClick={() => { setWallet(w => ({ ...w, cardBalance: parseFloat(walletInput) || 0 })); setEditingWallet(null); }}
                        className="px-4 py-2 bg-blue-600 rounded-xl text-sm font-bold text-white"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <p className="text-3xl font-black text-white">{fmt(wallet.cardBalance)}</p>
                  )}
                </div>

                {/* Cash wallet */}
                <div
                  style={{ background: 'linear-gradient(135deg, #1a3320 0%, #0d1220 100%)', border: '1px solid #10b98144' }}
                  className="rounded-2xl p-5"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-green-400">
                      <Banknote size={18} />
                      <span className="font-semibold">Cash Balance</span>
                    </div>
                    <button
                      onClick={() => { setEditingWallet('cash'); setWalletInput(String(wallet.cashBalance)); }}
                      className="text-xs text-green-300 hover:text-white"
                    >
                      Edit
                    </button>
                  </div>
                  {editingWallet === 'cash' ? (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={walletInput}
                        onChange={e => setWalletInput(e.target.value)}
                        autoFocus
                        style={{ background: '#060810', border: '1px solid #10b981' }}
                        className="flex-1 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
                      />
                      <button
                        onClick={() => { setWallet(w => ({ ...w, cashBalance: parseFloat(walletInput) || 0 })); setEditingWallet(null); }}
                        className="px-4 py-2 bg-green-600 rounded-xl text-sm font-bold text-white"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <p className="text-3xl font-black text-white">{fmt(wallet.cashBalance)}</p>
                  )}
                </div>

                {/* Withdraw shortcut */}
                <QuickWithdraw onWithdraw={handleQuickWithdraw} />
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bottom nav ── */}
      <div style={{ background: '#080b12', borderTop: '1px solid #1a2030' }} className="fixed bottom-0 left-0 right-0 z-40 flex justify-around px-2 py-2">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => { setView(item.id); setSelectedMonth(null); }}
            className="flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all"
            style={{ color: view === item.id ? '#3b82f6' : '#475569', background: view === item.id ? '#1e3a5f22' : 'transparent' }}
          >
            <item.icon size={20} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Quick withdraw is its own component so its input is controlled state
// rather than a raw DOM lookup by id (the original used
// document.getElementById, which breaks if this component is ever rendered
// more than once on a page, and doesn't clear reliably on submit).
function QuickWithdraw({ onWithdraw }: { onWithdraw: (amount: number) => void }) {
  const [value, setValue] = useState('');
  const submit = () => {
    const amt = parseFloat(value);
    if (!amt || amt <= 0) return;
    onWithdraw(amt);
    setValue('');
  };
  return (
    <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
      <p className="text-xs text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
        <ArrowRightLeft size={12} />Quick Withdraw (Card → Cash)
      </p>
      <div className="flex gap-2">
        <input
          type="number"
          placeholder="Amount (LKR)"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          style={{ background: '#060810', border: '1px solid #1a2030' }}
          className="flex-1 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none"
        />
        <button onClick={submit} className="px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: '#f59e0b' }}>
          Withdraw
        </button>
      </div>
    </div>
  );
}