"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LineChart, Line, PieChart, Pie, Cell, BarChart, Bar,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, CartesianGrid
} from 'recharts';
import {
  ArrowLeft, Plus, Search, Trash2, X, Repeat, TrendingUp, TrendingDown,
  CreditCard, Banknote, ArrowRightLeft, Download, Zap, Calendar,
  Smile, Meh, Frown, Users, ChevronRight, AlertCircle, CheckCircle,
  Flame, Target, BarChart2, Clock, SplitSquareHorizontal
} from 'lucide-react';

// ─── Config ──────────────────────────────────────────────────────────────────
const API_URL = process.env.NEXT_PUBLIC_SHEETS_API_URL || '';
const SALARY_DAY = 10;
const IMPULSE_THRESHOLD = 5000; // LKR

const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other'];
const CATEGORY_COLORS: Record<string, string> = {
  Food: '#f97316', Transport: '#3b82f6', Shopping: '#a855f7',
  Bills: '#ef4444', Entertainment: '#10b981', Other: '#64748b',
};

const MOOD_OPTIONS = [
  { value: 'worth-it', icon: Smile, label: 'Worth it', color: '#10b981' },
  { value: 'neutral', icon: Meh, label: 'Neutral', color: '#f59e0b' },
  { value: 'regret', icon: Frown, label: 'Regret', color: '#ef4444' },
];

// ─── Types ────────────────────────────────────────────────────────────────────
type PaymentMethod = 'card' | 'cash';
type TxType = 'expense' | 'income' | 'transfer';
type MoodType = 'worth-it' | 'neutral' | 'regret' | '';
type View = 'dashboard' | 'detail' | 'wallets' | 'splits' | 'trends' | 'calendar';

interface Transaction {
  id?: string;
  date: string;
  amount: number | string;
  category: string;
  description: string;
  paymentMethod?: PaymentMethod;
  type?: TxType;
  mood?: MoodType;
  myShare?: number | string;
  note?: string;
  merchant?: string;
}

interface Recurring {
  description: string;
  amount: number | string;
  category: string;
  dayOfMonth: number;
  startDate: string;
}

interface SplitEntry {
  id: string;
  description: string;
  total: number;
  myShare: number;
  paidBy: string;
  participants: string[];
  date: string;
  settled: boolean;
}

interface WalletState {
  cardBalance: number;
  cashBalance: number;
  cardStartingBalance: number;
}

interface CategoryBudget {
  [cat: string]: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', maximumFractionDigits: 0 }).format(n);

const toAmt = (v: number | string) => (typeof v === 'string' ? parseFloat(v) : v) || 0;

const getSalaryCycleStart = (date: Date = new Date()) => {
  const d = new Date(date);
  if (d.getDate() >= SALARY_DAY) {
    return new Date(d.getFullYear(), d.getMonth(), SALARY_DAY);
  }
  return new Date(d.getFullYear(), d.getMonth() - 1, SALARY_DAY);
};

const getSalaryCycleEnd = (start: Date) => {
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setDate(SALARY_DAY - 1);
  return end;
};

const getCycleLabel = (start: Date) => {
  const end = getSalaryCycleEnd(start);
  return `${start.toLocaleDateString('en-LK', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-LK', { month: 'short', day: 'numeric', year: 'numeric' })}`;
};

const isInCycle = (dateStr: string, cycleStart: Date) => {
  const d = new Date(dateStr);
  const end = getSalaryCycleEnd(cycleStart);
  return d >= cycleStart && d <= end;
};

const getDayLabel = (d: string) => {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const getMonthYear = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// ─── Sub-components ───────────────────────────────────────────────────────────
const CategoryBadge = ({ cat }: { cat: string }) => (
  <span className="text-xs font-medium px-2 py-0.5 rounded-full"
    style={{ background: (CATEGORY_COLORS[cat] || '#64748b') + '22', color: CATEGORY_COLORS[cat] || '#64748b', border: `1px solid ${(CATEGORY_COLORS[cat] || '#64748b')}44` }}>
    {cat}
  </span>
);

const Toast = ({ message, type, onClose }: { message: string; type: 'error' | 'success'; onClose: () => void }) => (
  <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl text-sm font-medium"
    style={{ background: type === 'error' ? '#ef444422' : '#10b98122', border: `1px solid ${type === 'error' ? '#ef4444' : '#10b981'}44`, color: type === 'error' ? '#ef4444' : '#10b981' }}>
    {type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
    {message}
    <button onClick={onClose}><X size={14} /></button>
  </div>
);

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0f1117] border border-white/10 rounded-xl px-3 py-2 text-sm shadow-xl">
      <span className="text-white font-semibold">{payload[0].name}</span>
      <span className="text-slate-400 ml-2">{fmt(payload[0].value)}</span>
    </div>
  );
};

const VelocityArrow = ({ current, previous }: { current: number; previous: number }) => {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct > 0;
  return (
    <span className="flex items-center gap-0.5 text-xs font-semibold" style={{ color: up ? '#ef4444' : '#10b981' }}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {Math.abs(pct)}%
    </span>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ExpenseTracker() {
  // ── Core state ──
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [splits, setSplits] = useState<SplitEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  // ── Navigation ──
  const [view, setView] = useState<View>('dashboard');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  // ── Form state ──
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<TxType>('expense');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [mood, setMood] = useState<MoodType>('');
  const [myShare, setMyShare] = useState('');
  const [note, setNote] = useState('');
  const [isSplit, setIsSplit] = useState(false);

  // ── Wallet ──
  const [wallet, setWallet] = useState<WalletState>({ cardBalance: 0, cashBalance: 0, cardStartingBalance: 0 });
  const [editingWallet, setEditingWallet] = useState<'card' | 'cash' | null>(null);
  const [walletInput, setWalletInput] = useState('');

  // ── Budget ──
  const [monthlyBudget, setMonthlyBudget] = useState(50000);
  const [categoryBudgets, setCategoryBudgets] = useState<CategoryBudget>({});
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('50000');
  const [editingCatBudget, setEditingCatBudget] = useState<string | null>(null);

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Merchant autocomplete ──
  const [merchantSuggestions, setMerchantSuggestions] = useState<string[]>([]);
  const descRef = useRef<HTMLInputElement>(null);

  // ── Split form ──
  const [splitForm, setSplitForm] = useState({ description: '', total: '', participants: '', paidBy: '' });

  // ── Load from localStorage ──
  useEffect(() => {
    const saved = localStorage.getItem('cashflow_prefs');
    if (saved) {
      const p = JSON.parse(saved);
      if (p.monthlyBudget) setMonthlyBudget(p.monthlyBudget);
      if (p.categoryBudgets) setCategoryBudgets(p.categoryBudgets);
      if (p.wallet) setWallet(p.wallet);
      if (p.splits) setSplits(p.splits);
    }
  }, []);

  // ── Persist to localStorage ──
  useEffect(() => {
    localStorage.setItem('cashflow_prefs', JSON.stringify({ monthlyBudget, categoryBudgets, wallet, splits }));
  }, [monthlyBudget, categoryBudgets, wallet, splits]);

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
    console.warn('API_URL not configured. Set NEXT_PUBLIC_SHEETS_API_URL in .env.local');
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
      .sort((a: Transaction, b: Transaction) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setTransactions(sorted);
    setRecurring(data.recurring || []);
  } catch (e) {
    showToast('Failed to load transactions. Check your connection.', 'error');
  } finally {
    setIsLoading(false);
  }
};

  // ─── Merchant memory ──────────────────────────────────────────────────────
  const merchantMap = useMemo(() => {
    const map: Record<string, { category: string; amount: number; count: number }> = {};
    transactions.forEach(t => {
      const key = t.description?.toLowerCase().trim();
      if (!key) return;
      if (!map[key]) map[key] = { category: t.category, amount: toAmt(t.amount), count: 0 };
      map[key].count++;
    });
    return map;
  }, [transactions]);

  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    if (val.length < 2) { setMerchantSuggestions([]); return; }
    const matches = Object.keys(merchantMap).filter(k => k.includes(val.toLowerCase())).slice(0, 4);
    setMerchantSuggestions(matches);
    const exact = merchantMap[val.toLowerCase()];
    if (exact) { setCategory(exact.category); }
  };

  const applyMerchant = (merchant: string) => {
    setDescription(merchant);
    const data = merchantMap[merchant];
    if (data) { setCategory(data.category); setAmount(String(data.amount)); }
    setMerchantSuggestions([]);
  };

  // ─── Cycle data ────────────────────────────────────────────────────────────
  const cycleStart = useMemo(() => getSalaryCycleStart(), []);
  const cycleLabel = useMemo(() => getCycleLabel(cycleStart), [cycleStart]);

  const cycleTransactions = useMemo(() =>
    transactions.filter(t => t.type !== 'income' && t.type !== 'transfer' && isInCycle(t.date, cycleStart)),
    [transactions, cycleStart]
  );

  const cycleIncome = useMemo(() =>
    transactions.filter(t => t.type === 'income' && isInCycle(t.date, cycleStart))
      .reduce((s, t) => s + toAmt(t.amount), 0),
    [transactions, cycleStart]
  );

  const recurringActive = useMemo(() =>
    recurring.filter(b => new Date(b.startDate) <= new Date()),
    [recurring]
  );

  const recurringTotal = useMemo(() =>
    recurringActive.reduce((s, b) => s + toAmt(b.amount), 0),
    [recurringActive]
  );

  const cycleSpend = useMemo(() =>
    cycleTransactions.reduce((s, t) => s + toAmt(t.amount), 0) + recurringTotal,
    [cycleTransactions, recurringTotal]
  );

  const netSavings = cycleIncome - cycleSpend;

  // ─── Daily pace projector ─────────────────────────────────────────────────
  const paceData = useMemo(() => {
    const today = new Date();
    const daysElapsed = Math.max(1, Math.floor((today.getTime() - cycleStart.getTime()) / 86400000));
    const cycleEnd = getSalaryCycleEnd(cycleStart);
    const totalDays = Math.floor((cycleEnd.getTime() - cycleStart.getTime()) / 86400000);
    const dailyRate = cycleSpend / daysElapsed;
    const projected = dailyRate * totalDays;
    const daysLeft = totalDays - daysElapsed;
    const remainingBudget = monthlyBudget - cycleSpend;
    const safeDaily = remainingBudget / Math.max(daysLeft, 1);
    return { dailyRate, projected, daysLeft, safeDaily, daysElapsed, totalDays };
  }, [cycleSpend, cycleStart, monthlyBudget]);

  // ─── Subscription detector ────────────────────────────────────────────────
  const suspectedSubscriptions = useMemo(() => {
    const freq: Record<string, { amounts: number[]; dates: string[]; category: string }> = {};
    transactions.filter(t => t.type === 'expense' || !t.type).forEach(t => {
      const key = t.description?.toLowerCase().trim();
      if (!key) return;
      if (!freq[key]) freq[key] = { amounts: [], dates: [], category: t.category };
      freq[key].amounts.push(toAmt(t.amount));
      freq[key].dates.push(t.date);
    });
    return Object.entries(freq)
      .filter(([, v]) => v.dates.length >= 2)
      .filter(([, v]) => {
        const avg = v.amounts.reduce((a, b) => a + b, 0) / v.amounts.length;
        return v.amounts.every(a => Math.abs(a - avg) / avg < 0.1);
      })
      .filter(([key]) => !recurringActive.some(r => r.description.toLowerCase() === key))
      .map(([desc, v]) => ({ desc, amount: v.amounts[v.amounts.length - 1], category: v.category }));
  }, [transactions, recurringActive]);

  // ─── No-spend streak ──────────────────────────────────────────────────────
  const noSpendStreak = useMemo(() => {
    const spendDays = new Set(
      transactions.filter(t => t.type === 'expense' || !t.type).map(t => t.date)
    );
    let streak = 0;
    const d = new Date();
    d.setDate(d.getDate() - 1);
    while (!spendDays.has(d.toISOString().split('T')[0])) {
      streak++;
      d.setDate(d.getDate() - 1);
      if (streak > 365) break;
    }
    return streak;
  }, [transactions]);

  // ─── Impulse purchases ────────────────────────────────────────────────────
  const impulseTotal = useMemo(() =>
    cycleTransactions
      .filter(t => toAmt(t.amount) >= IMPULSE_THRESHOLD)
      .reduce((s, t) => s + toAmt(t.amount), 0),
    [cycleTransactions]
  );

  // ─── Category velocity ────────────────────────────────────────────────────
  const prevCycleStart = useMemo(() => {
    const d = new Date(cycleStart);
    d.setMonth(d.getMonth() - 1);
    return d;
  }, [cycleStart]);

  const catVelocity = useMemo(() => {
    const curr: Record<string, number> = {};
    const prev: Record<string, number> = {};
    transactions.filter(t => t.type === 'expense' || !t.type).forEach(t => {
      if (isInCycle(t.date, cycleStart)) curr[t.category] = (curr[t.category] || 0) + toAmt(t.amount);
      if (isInCycle(t.date, prevCycleStart)) prev[t.category] = (prev[t.category] || 0) + toAmt(t.amount);
    });
    return { curr, prev };
  }, [transactions, cycleStart, prevCycleStart]);

  // ─── Biggest spend day pattern ────────────────────────────────────────────
  const biggestSpendDay = useMemo(() => {
    const byDay: Record<number, number> = {};
    transactions.filter(t => t.type === 'expense' || !t.type).forEach(t => {
      const day = new Date(t.date).getDate();
      byDay[day] = (byDay[day] || 0) + toAmt(t.amount);
    });
    const sorted = Object.entries(byDay).sort((a, b) => b[1] - a[1]);
    return sorted[0] ? { day: parseInt(sorted[0][0]), total: sorted[0][1] } : null;
  }, [transactions]);

  // ─── Mood breakdown ───────────────────────────────────────────────────────
  const moodBreakdown = useMemo(() => {
    const totals: Record<string, number> = { 'worth-it': 0, neutral: 0, regret: 0 };
    cycleTransactions.forEach(t => { if (t.mood) totals[t.mood] = (totals[t.mood] || 0) + toAmt(t.amount); });
    return totals;
  }, [cycleTransactions]);

  // ─── 6-month trend ────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const months: { label: string; spend: number; income: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = getMonthYear(d.toISOString());
      const monthTx = transactions.filter(t => getMonthYear(t.date) === key);
      months.push({
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        spend: monthTx.filter(t => t.type === 'expense' || !t.type).reduce((s, t) => s + toAmt(t.amount), 0),
        income: monthTx.filter(t => t.type === 'income').reduce((s, t) => s + toAmt(t.amount), 0),
      });
    }
    return months;
  }, [transactions]);

  // ─── Week over week ───────────────────────────────────────────────────────
  const weekData = useMemo(() => {
    const thisWeekStart = new Date(); thisWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekStart = new Date(); lastWeekStart.setDate(lastWeekStart.getDate() - 14);
    const thisWeek = transactions.filter(t => {
      const d = new Date(t.date);
      return (t.type === 'expense' || !t.type) && d >= thisWeekStart;
    }).reduce((s, t) => s + toAmt(t.amount), 0);
    const lastWeek = transactions.filter(t => {
      const d = new Date(t.date);
      return (t.type === 'expense' || !t.type) && d >= lastWeekStart && d < thisWeekStart;
    }).reduce((s, t) => s + toAmt(t.amount), 0);
    return { thisWeek, lastWeek };
  }, [transactions]);

  // ─── Monthly grouped ─────────────────────────────────────────────────────
  const filtered = useMemo(() =>
    transactions.filter(t =>
      (t.description ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.category.toLowerCase().includes(searchQuery.toLowerCase())
    ), [transactions, searchQuery]);

  const groupedByMonth = useMemo(() => {
    const groups: Record<string, { total: number; transactions: Transaction[] }> = {};
    filtered.filter(t => t.type === 'expense' || !t.type).forEach(t => {
      if (!t.date) return;
      const key = getMonthYear(t.date);
      if (!groups[key]) groups[key] = { total: 0, transactions: [] };
      groups[key].total += toAmt(t.amount);
      groups[key].transactions.push(t);
    });
    return Object.entries(groups).sort(
      (a, b) => new Date(b[1].transactions[0].date).getTime() - new Date(a[1].transactions[0].date).getTime()
    );
  }, [filtered]);

  // ─── Detail view data ──────────────────────────────────────────────────────
  const currentMonthData = useMemo(() => {
    if (!selectedMonth) return null;
    const entry = groupedByMonth.find(g => g[0] === selectedMonth);
    if (!entry) return null;
    const [, data] = entry;
    const catTotals: Record<string, number> = {};
    data.transactions.forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + toAmt(t.amount); });
    const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
    const byDay: Record<string, Transaction[]> = {};
    const txToShow = activeCat ? data.transactions.filter(t => t.category === activeCat) : data.transactions;
    txToShow.forEach(t => {
      const label = getDayLabel(t.date);
      if (!byDay[label]) byDay[label] = [];
      byDay[label].push(t);
    });
    return { ...data, chartData: Object.entries(catTotals).map(([name, value]) => ({ name, value })), topCat, catTotals, byDay };
  }, [selectedMonth, groupedByMonth, activeCat]);

  // ─── Budget ───────────────────────────────────────────────────────────────
  const budgetPct = Math.min((cycleSpend / monthlyBudget) * 100, 100);
  const budgetColor = budgetPct > 90 ? '#ef4444' : budgetPct > 65 ? '#f97316' : '#10b981';

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return;
    
    if (!API_URL) {
      showToast('API URL is not configured.', 'error');
      return;
    }
    
    setIsSubmitting(true);
    const effectiveShare = isSplit && myShare ? parseFloat(myShare) : parseFloat(amount);
    const newTx: Transaction = {
      id: Date.now().toString(),
      date, amount: effectiveShare, category,
      description: description || 'No description',
      paymentMethod: formType === 'transfer' ? undefined : paymentMethod,
      type: formType, mood: mood || undefined,
      myShare: isSplit ? effectiveShare : undefined,
      note: note || undefined,
    };
    try {
      await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(newTx),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      });
      setTransactions(prev => [newTx, ...prev]);

      // Update wallet
      if (formType === 'transfer') {
        const amt = parseFloat(amount);
        setWallet(w => ({ ...w, cardBalance: w.cardBalance - amt, cashBalance: w.cashBalance + amt }));
      } else if (formType === 'expense') {
        const amt = effectiveShare;
        setWallet(w => ({
          ...w,
          cardBalance: paymentMethod === 'card' ? w.cardBalance - amt : w.cardBalance,
          cashBalance: paymentMethod === 'cash' ? w.cashBalance - amt : w.cashBalance,
        }));
      } else if (formType === 'income') {
        const amt = parseFloat(amount);
        setWallet(w => ({
          ...w,
          cardBalance: paymentMethod === 'card' ? w.cardBalance + amt : w.cardBalance,
          cashBalance: paymentMethod === 'cash' ? w.cashBalance + amt : w.cashBalance,
        }));
      }

      setAmount(''); setDescription(''); setNote(''); setMyShare(''); setMood(''); setIsSplit(false);
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

  const exportCSV = () => {
    const rows = [['Date', 'Description', 'Category', 'Amount (LKR)', 'Payment', 'Type', 'Mood', 'Note']];
    transactions.forEach(t => {
      rows.push([t.date, t.description, t.category, String(toAmt(t.amount)), t.paymentMethod || '', t.type || 'expense', t.mood || '', t.note || '']);
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'cashflow_export.csv'; a.click();
  };

  const addSplit = () => {
    if (!splitForm.description || !splitForm.total) return;
    const total = parseFloat(splitForm.total);
    const participants = splitForm.participants.split(',').map(s => s.trim()).filter(Boolean);
    const myShareAmt = participants.length > 0 ? total / (participants.length + 1) : total;
    const newSplit: SplitEntry = {
      id: Date.now().toString(),
      description: splitForm.description,
      total, myShare: myShareAmt,
      paidBy: splitForm.paidBy || 'Me',
      participants,
      date: new Date().toISOString().split('T')[0],
      settled: false,
    };
    setSplits(prev => [newSplit, ...prev]);
    setSplitForm({ description: '', total: '', participants: '', paidBy: '' });
    showToast('Split added!', 'success');
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  const navItems: { id: View; label: string; icon: any }[] = [
    { id: 'dashboard', label: 'Home', icon: BarChart2 },
    { id: 'wallets', label: 'Wallets', icon: CreditCard },
    { id: 'trends', label: 'Trends', icon: TrendingUp },
    { id: 'calendar', label: 'Bills', icon: Calendar },
    { id: 'splits', label: 'Splits', icon: Users },
  ];

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: '#060810', minHeight: '100vh' }} className="text-slate-200">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Top nav ── */}
      <div style={{ background: '#080b12', borderBottom: '1px solid #1a2030' }} className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {(view !== 'dashboard' || selectedMonth) && (
            <button onClick={() => { if (selectedMonth) { setSelectedMonth(null); setActiveCat(null); } else setView('dashboard'); }}
              className="text-slate-400 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </button>
          )}
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase leading-none mb-0.5">Cashflow</p>
            <p className="text-xs text-slate-600">{cycleLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-colors" title="Export CSV">
            <Download size={16} />
          </button>
          {view === 'dashboard' && !selectedMonth && (
            <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="flex items-center gap-2 rounded-xl px-3 py-1.5">
              <Search size={13} className="text-slate-500" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="bg-transparent text-sm text-slate-300 placeholder-slate-600 focus:outline-none w-28" />
            </div>
          )}
          <button onClick={() => setShowForm(v => !v)}
            style={{ background: showForm ? '#1a2030' : '#2563eb' }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-white transition-colors">
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? 'Cancel' : 'Add'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 960 }} className="mx-auto px-4 pb-24">

        {/* ── Add form ── */}
        {showForm && (
          <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5 mt-4 mb-2">
            {/* Type tabs */}
            <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: '#060810' }}>
              {(['expense', 'income', 'transfer'] as TxType[]).map(t => (
                <button key={t} onClick={() => setFormType(t)}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
                  style={{ background: formType === t ? t === 'income' ? '#10b981' : t === 'transfer' ? '#f59e0b' : '#ef4444' : 'transparent', color: formType === t ? '#fff' : '#64748b' }}>
                  {t === 'transfer' ? '⇄ Withdraw' : t === 'income' ? '↑ Income' : '↓ Expense'}
                </button>
              ))}
            </div>

            <form onSubmit={handleAdd} className="grid grid-cols-2 gap-3">
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ background: '#060810', border: '1px solid #1a2030' }}
                className="rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50" />
              <input type="number" step="1" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="Amount (LKR)" required
                style={{ background: '#060810', border: '1px solid #1a2030' }}
                className="rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />

              {formType !== 'transfer' && (
                <>
                  <div className="relative col-span-2">
                    <input ref={descRef} type="text" value={description} onChange={e => handleDescriptionChange(e.target.value)}
                      placeholder="Description"
                      style={{ background: '#060810', border: '1px solid #1a2030' }}
                      className="w-full rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                    {merchantSuggestions.length > 0 && (
                      <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="absolute top-full left-0 right-0 rounded-xl mt-1 z-10 overflow-hidden">
                        {merchantSuggestions.map(m => (
                          <button key={m} type="button" onClick={() => applyMerchant(m)}
                            className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 flex items-center justify-between">
                            <span className="capitalize">{m}</span>
                            <span className="text-xs text-slate-500">{merchantMap[m]?.category}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <select value={category} onChange={e => setCategory(e.target.value)}
                    style={{ background: '#060810', border: '1px solid #1a2030', color: CATEGORY_COLORS[category] }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-blue-500/50">
                    {CATEGORIES.map(c => <option key={c} value={c} style={{ color: CATEGORY_COLORS[c] }}>{c}</option>)}
                  </select>

                  {/* Payment method */}
                  <div className="flex gap-2">
                    {(['card', 'cash'] as PaymentMethod[]).map(pm => (
                      <button key={pm} type="button" onClick={() => setPaymentMethod(pm)}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
                        style={{ background: paymentMethod === pm ? '#1e3a5f' : '#060810', border: `1px solid ${paymentMethod === pm ? '#3b82f6' : '#1a2030'}`, color: paymentMethod === pm ? '#60a5fa' : '#64748b' }}>
                        {pm === 'card' ? <CreditCard size={13} /> : <Banknote size={13} />}
                        {pm === 'card' ? 'Card' : 'Cash'}
                      </button>
                    ))}
                  </div>

                  {/* Split toggle */}
                  {formType === 'expense' && (
                    <div className="col-span-2 flex items-center justify-between py-1">
                      <label className="text-xs text-slate-400 flex items-center gap-1.5">
                        <SplitSquareHorizontal size={13} /> Split transaction
                      </label>
                      <button type="button" onClick={() => setIsSplit(v => !v)}
                        className="w-9 h-5 rounded-full transition-all flex items-center px-0.5"
                        style={{ background: isSplit ? '#2563eb' : '#1a2030' }}>
                        <div className="w-4 h-4 rounded-full bg-white transition-all" style={{ transform: isSplit ? 'translateX(16px)' : 'none' }} />
                      </button>
                    </div>
                  )}

                  {isSplit && (
                    <input type="number" value={myShare} onChange={e => setMyShare(e.target.value)}
                      placeholder="My share (LKR)"
                      style={{ background: '#060810', border: '1px solid #1a2030' }}
                      className="col-span-2 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none" />
                  )}

                  {/* Mood */}
                  {formType === 'expense' && (
                    <div className="col-span-2 flex gap-2">
                      {MOOD_OPTIONS.map(m => (
                        <button key={m.value} type="button" onClick={() => setMood(prev => prev === m.value ? '' : m.value as MoodType)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium transition-all"
                          style={{ background: mood === m.value ? m.color + '22' : '#060810', border: `1px solid ${mood === m.value ? m.color + '66' : '#1a2030'}`, color: mood === m.value ? m.color : '#64748b' }}>
                          <m.icon size={13} /> {m.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <textarea value={note} onChange={e => setNote(e.target.value)}
                    placeholder="Note (optional)"
                    rows={1}
                    style={{ background: '#060810', border: '1px solid #1a2030' }}
                    className="col-span-2 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none resize-none" />
                </>
              )}

              <button type="submit" disabled={isSubmitting}
                style={{ background: formType === 'income' ? '#10b981' : formType === 'transfer' ? '#f59e0b' : '#2563eb' }}
                className="col-span-2 rounded-xl py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                {isSubmitting ? 'Saving…' : formType === 'transfer' ? 'Record Withdrawal' : formType === 'income' ? 'Record Income' : 'Save Expense'}
              </button>
            </form>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-24 text-slate-500">Loading…</div>
        ) : (
          <>
            {/* ══ DETAIL VIEW ══ */}
            {view === 'dashboard' && selectedMonth && currentMonthData && (
              <div className="mt-4">
                <p className="text-sm font-semibold text-slate-400 mb-4">{selectedMonth}</p>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Spent</p>
                    <p className="text-xl font-bold text-white">{fmt(currentMonthData.total)}</p>
                  </div>
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Top</p>
                    <p className="text-base font-bold" style={{ color: CATEGORY_COLORS[currentMonthData.topCat?.[0]] }}>{currentMonthData.topCat?.[0]}</p>
                    <p className="text-xs text-slate-400">{fmt(currentMonthData.topCat?.[1] ?? 0)}</p>
                  </div>
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Avg</p>
                    <p className="text-xl font-bold text-white">{fmt(currentMonthData.total / currentMonthData.transactions.length)}</p>
                  </div>
                </div>

                {/* Pie + categories */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5 mb-4 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie 
  data={currentMonthData.chartData} 
  cx="50%" 
  cy="50%" 
  innerRadius={55} 
  outerRadius={85} 
  paddingAngle={3} 
  dataKey="value"
onClick={(d) => {
  if (d?.name) {
    const catName = d.name;
    setActiveCat(prev => prev === catName ? null : catName);
  }
}}>
  {currentMonthData.chartData.map((entry) => (
    <Cell 
      key={entry.name} 
      fill={CATEGORY_COLORS[entry.name] || '#64748b'}
      opacity={activeCat && activeCat !== entry.name ? 0.25 : 1} 
      style={{ cursor: 'pointer' }} 
    />
  ))}
</Pie>
                        <RechartsTooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {currentMonthData.chartData
                      .sort((a, b) => b.value - a.value)
                      .map(({ name, value }) => {
                        const pct = Math.round((value / currentMonthData.total) * 100);
                        const budget = categoryBudgets[name];
                        return (
                          <button 
                            key={name} 
                            onClick={() => setActiveCat(prev => prev === name ? null : name)}
                            className="rounded-xl px-3 py-2 text-left transition-all"
                            style={{ 
                              background: activeCat === name ? CATEGORY_COLORS[name] + '18' : 'transparent', 
                              opacity: activeCat && activeCat !== name ? 0.4 : 1, 
                              border: `1px solid ${activeCat === name ? CATEGORY_COLORS[name] + '44' : 'transparent'}` 
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span 
                                style={{ background: CATEGORY_COLORS[name], flexShrink: 0 }} 
                                className="w-2 h-2 rounded-full" 
                              />
                              <span className="text-sm text-slate-300 flex-1">{name}</span>
                              <VelocityArrow current={catVelocity.curr[name] || 0} previous={catVelocity.prev[name] || 0} />
                              <span className="text-xs text-slate-500">{pct}%</span>
                              <span className="text-sm font-bold text-white">{fmt(value)}</span>
                            </div>
                            {budget && (
                              <div style={{ background: '#1a2030', borderRadius: 999, height: 3, marginTop: 6 }}>
                                <div 
                                  style={{ 
                                    width: `${Math.min((value / budget) * 100, 100)}%`, 
                                    background: value > budget ? '#ef4444' : CATEGORY_COLORS[name], 
                                    height: '100%', 
                                    borderRadius: 999 
                                  }} 
                                />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    {activeCat && (
                      <button 
                        onClick={() => setActiveCat(null)} 
                        className="text-xs text-blue-400 px-3 mt-1"
                      >
                        Clear ×
                      </button>
                    )}
                  </div>
                </div>

                {/* Transaction list */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl overflow-hidden">
                  {Object.entries(currentMonthData.byDay).map(([dayLabel, txs]) => (
                    <div key={dayLabel}>
                      <div style={{ borderBottom: '1px solid #1a2030', background: '#080b12' }} className="flex justify-between px-5 py-2">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{dayLabel}</span>
                        <span className="text-xs text-slate-500">{fmt(txs.reduce((s, t) => s + toAmt(t.amount), 0))}</span>
                      </div>
                      {txs.map((t, i) => (
                        <div key={t.id ?? i} style={{ borderBottom: '1px solid #1a203020' }}
                          className="flex items-center gap-3 px-5 py-3 group hover:bg-white/[0.02] transition-colors">
                          <span style={{ background: CATEGORY_COLORS[t.category], flexShrink: 0 }} className="w-2 h-2 rounded-full" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm text-slate-200 truncate">{t.description}</p>
                              {toAmt(t.amount) >= IMPULSE_THRESHOLD && <Zap size={11} className="text-yellow-400 flex-shrink-0" />}
                              {t.mood && (() => { const m = MOOD_OPTIONS.find(x => x.value === t.mood); return m ? <m.icon size={11} style={{ color: m.color, flexShrink: 0 }} /> : null; })()}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <CategoryBadge cat={t.category} />
                              {t.paymentMethod && (
                                <span className="text-xs text-slate-600 flex items-center gap-0.5">
                                  {t.paymentMethod === 'card' ? <CreditCard size={10} /> : <Banknote size={10} />}
                                </span>
                              )}
                              {t.note && <span className="text-xs text-slate-600 truncate max-w-[120px]">{t.note}</span>}
                            </div>
                          </div>
                          <span className="text-sm font-bold text-white tabular-nums">{fmt(toAmt(t.amount))}</span>
                          <button onClick={() => t.id && handleDelete(t.id)} disabled={deletingId === t.id}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400">
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

                {/* ── Hero: cycle spend + budget bar ── */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5">
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase mb-1">This Cycle</p>
                      <p className="text-4xl font-black text-white tracking-tight">{fmt(cycleSpend)}</p>
                      {cycleIncome > 0 && (
                        <p className="text-sm mt-1" style={{ color: netSavings >= 0 ? '#10b981' : '#ef4444' }}>
                          {netSavings >= 0 ? '↑' : '↓'} {fmt(Math.abs(netSavings))} net {netSavings >= 0 ? 'saved' : 'over'}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      {editingBudget ? (
                        <div className="flex items-center gap-2">
                          <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(budgetInput); if (!isNaN(v) && v > 0) setMonthlyBudget(v); setEditingBudget(false); } if (e.key === 'Escape') setEditingBudget(false); }}
                            autoFocus style={{ background: '#060810', border: '1px solid #1a2030', width: 100 }}
                            className="rounded-lg px-2 py-1 text-sm text-slate-200 focus:outline-none" />
                          <button onClick={() => { const v = parseFloat(budgetInput); if (!isNaN(v) && v > 0) setMonthlyBudget(v); setEditingBudget(false); }}
                            className="text-xs text-blue-400 font-semibold">Save</button>
                        </div>
                      ) : (
                        <button onClick={() => { setBudgetInput(String(monthlyBudget)); setEditingBudget(true); }}>
                          <p className="text-xs text-slate-500">Budget</p>
                          <p className="text-sm font-bold text-slate-400 hover:text-white transition-colors">{fmt(monthlyBudget)}</p>
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ background: '#1a2030', borderRadius: 999, height: 5, overflow: 'hidden', marginTop: 16 }}>
                    <div style={{ width: `${budgetPct}%`, background: budgetColor, height: '100%', borderRadius: 999, transition: 'width 0.8s ease' }} />
                  </div>
                  <div className="flex justify-between mt-2">
                    <p className="text-xs text-slate-600">{fmt(Math.max(monthlyBudget - cycleSpend, 0))} left · {Math.round(budgetPct)}% used</p>
                    <p className="text-xs text-slate-600">{paceData.daysLeft}d left</p>
                  </div>
                </div>

                {/* ── Pace + streak row ── */}
                <div className="grid grid-cols-2 gap-3">
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Daily Rate</p>
                    <p className="text-xl font-bold text-white">{fmt(paceData.dailyRate)}</p>
                    <p className="text-xs mt-1" style={{ color: paceData.projected > monthlyBudget ? '#ef4444' : '#10b981' }}>
                      Projected {fmt(paceData.projected)}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">Safe: {fmt(paceData.safeDaily)}/day</p>
                  </div>
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">No-Spend Streak</p>
                    <p className="text-xl font-bold text-white flex items-center gap-1.5">
                      <Flame size={18} className={noSpendStreak > 0 ? 'text-orange-400' : 'text-slate-600'} />
                      {noSpendStreak} {noSpendStreak === 1 ? 'day' : 'days'}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {noSpendStreak === 0 ? 'Spent today' : noSpendStreak >= 3 ? 'On a roll! 🔥' : 'Keep going'}
                    </p>
                  </div>
                </div>

                {/* ── Week comparison ── */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-3">Week vs Last Week</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">This Week</p>
                      <p className="text-xl font-bold text-white">{fmt(weekData.thisWeek)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Last Week</p>
                      <p className="text-xl font-bold text-slate-400">{fmt(weekData.lastWeek)}</p>
                    </div>
                  </div>
                  {weekData.lastWeek > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <VelocityArrow current={weekData.thisWeek} previous={weekData.lastWeek} />
                      <span className="text-xs text-slate-600">
                        {weekData.thisWeek > weekData.lastWeek ? `${fmt(weekData.thisWeek - weekData.lastWeek)} more` : `${fmt(weekData.lastWeek - weekData.thisWeek)} less`} than last week
                      </span>
                    </div>
                  )}
                </div>

                {/* ── Impulse + mood ── */}
                <div className="grid grid-cols-2 gap-3">
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1"><Zap size={11} /> Impulse</p>
                    <p className="text-xl font-bold text-white">{fmt(impulseTotal)}</p>
                    <p className="text-xs text-slate-600 mt-1">above {fmt(IMPULSE_THRESHOLD)} this cycle</p>
                  </div>
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">Mood Split</p>
                    {Object.entries(moodBreakdown).filter(([, v]) => v > 0).map(([k, v]) => {
                      const m = MOOD_OPTIONS.find(x => x.value === k);
                      return m ? (
                        <div key={k} className="flex items-center justify-between text-xs mb-1">
                          <span style={{ color: m.color }} className="flex items-center gap-1"><m.icon size={11} />{m.label}</span>
                          <span className="text-slate-400">{fmt(v)}</span>
                        </div>
                      ) : null;
                    })}
                    {Object.values(moodBreakdown).every(v => v === 0) && <p className="text-xs text-slate-600">Tag your transactions</p>}
                  </div>
                </div>

                {/* ── Subscription detector ── */}
                {suspectedSubscriptions.length > 0 && (
                  <div style={{ background: '#1a0f0000', border: '1px solid #f59e0b44' }} className="rounded-2xl p-4">
                    <p className="text-xs font-semibold text-yellow-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                      <AlertCircle size={12} /> Possible Unlogged Subscriptions
                    </p>
                    <div className="space-y-2">
                      {suspectedSubscriptions.slice(0, 3).map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-slate-300 capitalize">{s.desc}</span>
                          <span className="text-yellow-400 font-semibold">{fmt(s.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Biggest spend day ── */}
                {biggestSpendDay && (
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1"><Clock size={11} /> Biggest Spend Day</p>
                      <p className="text-sm text-slate-300">The <span className="text-white font-bold">{biggestSpendDay.day}{['th','st','nd','rd'][(biggestSpendDay.day % 10 < 4 && biggestSpendDay.day % 100 !== 11 && biggestSpendDay.day % 100 !== 12 && biggestSpendDay.day % 100 !== 13) ? biggestSpendDay.day % 10 : 0] || 'th'}</span> of the month</p>
                    </div>
                    <p className="text-lg font-bold text-white">{fmt(biggestSpendDay.total)}</p>
                  </div>
                )}

                {/* ── Month cards ── */}
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest pt-2">History</p>
                <div className="grid grid-cols-2 gap-3">
                  {groupedByMonth.map(([month, data]) => (
                    <button key={month} onClick={() => setSelectedMonth(month)}
                      style={{ background: '#0d1220', border: '1px solid #1a2030' }}
                      className="rounded-2xl p-4 text-left hover:border-blue-500/30 transition-colors group">
                      <p className="text-xs text-slate-500 mb-1 uppercase tracking-widest">{month}</p>
                      <p className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">{fmt(data.total)}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{data.transactions.length} transactions</p>
                    </button>
                  ))}
                </div>

                {/* ── Recurring ── */}
                {recurringActive.length > 0 && (
                  <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Repeat size={12} />Recurring</p>
                      <span className="text-sm font-bold text-white">{fmt(recurringTotal)}/mo</span>
                    </div>
                    <div className="space-y-2.5">
                      {recurringActive.map((b, i) => (
                        <div key={i} className="flex justify-between items-center text-sm">
                          <div className="flex items-center gap-2">
                            <span style={{ background: CATEGORY_COLORS[b.category] }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
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
              </div>
            )}

            {/* ══ WALLETS VIEW ══ */}
            {view === 'wallets' && (
              <div className="mt-4 space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Wallets</p>

                {/* Card wallet */}
                <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0d1220 100%)', border: '1px solid #2563eb44' }} className="rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-blue-400">
                      <CreditCard size={18} />
                      <span className="font-semibold">Card Balance</span>
                    </div>
                    <button onClick={() => { setEditingWallet('card'); setWalletInput(String(wallet.cardBalance)); }}
                      className="text-xs text-blue-300 hover:text-white">Edit</button>
                  </div>
                  {editingWallet === 'card' ? (
                    <div className="flex gap-2">
                      <input type="number" value={walletInput} onChange={e => setWalletInput(e.target.value)}
                        autoFocus style={{ background: '#060810', border: '1px solid #2563eb' }}
                        className="flex-1 rounded-xl px-3 py-2 text-sm text-white focus:outline-none" />
                      <button onClick={() => { setWallet(w => ({ ...w, cardBalance: parseFloat(walletInput) || 0 })); setEditingWallet(null); }}
                        className="px-4 py-2 bg-blue-600 rounded-xl text-sm font-bold text-white">Save</button>
                    </div>
                  ) : (
                    <p className="text-3xl font-black text-white">{fmt(wallet.cardBalance)}</p>
                  )}
                </div>

                {/* Cash wallet */}
                <div style={{ background: 'linear-gradient(135deg, #1a3320 0%, #0d1220 100%)', border: '1px solid #10b98144' }} className="rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-green-400">
                      <Banknote size={18} />
                      <span className="font-semibold">Cash Balance</span>
                    </div>
                    <button onClick={() => { setEditingWallet('cash'); setWalletInput(String(wallet.cashBalance)); }}
                      className="text-xs text-green-300 hover:text-white">Edit</button>
                  </div>
                  {editingWallet === 'cash' ? (
                    <div className="flex gap-2">
                      <input type="number" value={walletInput} onChange={e => setWalletInput(e.target.value)}
                        autoFocus style={{ background: '#060810', border: '1px solid #10b981' }}
                        className="flex-1 rounded-xl px-3 py-2 text-sm text-white focus:outline-none" />
                      <button onClick={() => { setWallet(w => ({ ...w, cashBalance: parseFloat(walletInput) || 0 })); setEditingWallet(null); }}
                        className="px-4 py-2 bg-green-600 rounded-xl text-sm font-bold text-white">Save</button>
                    </div>
                  ) : (
                    <p className="text-3xl font-black text-white">{fmt(wallet.cashBalance)}</p>
                  )}
                </div>

                {/* Withdraw shortcut */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5"><ArrowRightLeft size={12} />Quick Withdraw (Card → Cash)</p>
                  <div className="flex gap-2">
                    <input type="number" placeholder="Amount (LKR)" id="withdraw-amt"
                      style={{ background: '#060810', border: '1px solid #1a2030' }}
                      className="flex-1 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none" />
                    <button onClick={() => {
                      const amt = parseFloat((document.getElementById('withdraw-amt') as HTMLInputElement)?.value || '0');
                      if (!amt) return;
                      setWallet(w => ({ ...w, cardBalance: w.cardBalance - amt, cashBalance: w.cashBalance + amt }));
                      const tx: Transaction = { id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amount: amt, category: 'Other', description: 'Cash Withdrawal', type: 'transfer' };
                      setTransactions(prev => [tx, ...prev]);
                      showToast(`Withdrawn ${fmt(amt)} to cash`, 'success');
                      (document.getElementById('withdraw-amt') as HTMLInputElement).value = '';
                    }} className="px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: '#f59e0b' }}>
                      Withdraw
                    </button>
                  </div>
                </div>

                {/* Category budgets */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Target size={12} />Category Budgets</p>
                  <div className="space-y-3">
                    {CATEGORIES.map(cat => {
                      const budget = categoryBudgets[cat] || 0;
                      const spent = catVelocity.curr[cat] || 0;
                      const pct = budget ? Math.min((spent / budget) * 100, 100) : 0;
                      return (
                        <div key={cat}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-slate-300">{cat}</span>
                            {editingCatBudget === cat ? (
                              <div className="flex items-center gap-2">
                                <input type="number" defaultValue={budget || ''} id={`cat-budget-${cat}`}
                                  style={{ background: '#060810', border: '1px solid #1a2030', width: 90 }}
                                  className="rounded-lg px-2 py-1 text-xs text-white focus:outline-none" />
                                <button onClick={() => {
                                  const v = parseFloat((document.getElementById(`cat-budget-${cat}`) as HTMLInputElement)?.value || '0');
                                  setCategoryBudgets(prev => ({ ...prev, [cat]: v }));
                                  setEditingCatBudget(null);
                                }} className="text-xs text-blue-400">Save</button>
                              </div>
                            ) : (
                              <button onClick={() => setEditingCatBudget(cat)} className="text-xs text-slate-500 hover:text-white">
                                {budget ? fmt(budget) : 'Set budget'}
                              </button>
                            )}
                          </div>
                          {budget > 0 && (
                            <div style={{ background: '#1a2030', borderRadius: 999, height: 4 }}>
                              <div style={{ width: `${pct}%`, background: spent > budget ? '#ef4444' : CATEGORY_COLORS[cat], height: '100%', borderRadius: 999, transition: 'width 0.6s' }} />
                            </div>
                          )}
                          {budget > 0 && <p className="text-xs text-slate-600 mt-0.5">{fmt(spent)} / {fmt(budget)}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ══ TRENDS VIEW ══ */}
            {view === 'trends' && (
              <div className="mt-4 space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Trends</p>

                {/* 6-month chart */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-4">6-Month Overview</p>
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a2030" />
                        <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                        <RechartsTooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="spend" stroke="#ef4444" strokeWidth={2} dot={{ fill: '#ef4444', r: 3 }} name="Spend" />
                        <Line type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} name="Income" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex gap-4 mt-2 justify-center">
                    <span className="text-xs text-slate-500 flex items-center gap-1"><span className="w-3 h-0.5 bg-red-400 inline-block" /> Spend</span>
                    <span className="text-xs text-slate-500 flex items-center gap-1"><span className="w-3 h-0.5 bg-green-400 inline-block" /> Income</span>
                  </div>
                </div>

                {/* Category bar chart */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-4">This Cycle by Category</p>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={CATEGORIES.map(c => ({ name: c, amount: catVelocity.curr[c] || 0 }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a2030" />
                        <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                        <RechartsTooltip content={<CustomTooltip />} />
                        <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                          {CATEGORIES.map(c => <Cell key={c} fill={CATEGORY_COLORS[c]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Category velocity detail */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-3">vs Last Cycle</p>
                  <div className="space-y-3">
                    {CATEGORIES.filter(c => catVelocity.curr[c] || catVelocity.prev[c]).map(cat => (
                      <div key={cat} className="flex items-center gap-3">
                        <span style={{ background: CATEGORY_COLORS[cat] }} className="w-2 h-2 rounded-full flex-shrink-0" />
                        <span className="text-sm text-slate-300 flex-1">{cat}</span>
                        <VelocityArrow current={catVelocity.curr[cat] || 0} previous={catVelocity.prev[cat] || 0} />
                        <span className="text-sm font-bold text-white">{fmt(catVelocity.curr[cat] || 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ══ CALENDAR / BILLS VIEW ══ */}
            {view === 'calendar' && (
              <div className="mt-4 space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Bill Calendar</p>

                {/* Visual calendar strip */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-4">Days of the Month</p>
                  <div className="grid grid-cols-10 gap-1.5">
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
                      const bills = recurringActive.filter(b => b.dayOfMonth === day);
                      const isSalary = day === SALARY_DAY;
                      return (
                        <div key={day} className="aspect-square rounded-lg flex items-center justify-center relative text-xs font-medium"
                          style={{
                            background: bills.length > 0 ? '#ef444422' : isSalary ? '#10b98122' : '#1a2030',
                            border: `1px solid ${bills.length > 0 ? '#ef444466' : isSalary ? '#10b98166' : 'transparent'}`,
                            color: bills.length > 0 ? '#ef4444' : isSalary ? '#10b981' : '#64748b'
                          }}>
                          {day}
                          {bills.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-400" />}
                          {isSalary && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-green-400" />}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-4 mt-3">
                    <span className="text-xs text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Bill due</span>
                    <span className="text-xs text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Salary (day {SALARY_DAY})</span>
                  </div>
                </div>

                {/* Bills list */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-3">All Recurring Bills</p>
                  {recurringActive.length === 0 ? (
                    <p className="text-sm text-slate-600 text-center py-4">No recurring bills in your sheet yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {[...recurringActive].sort((a, b) => a.dayOfMonth - b.dayOfMonth).map((b, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{ background: '#ef444422', color: '#ef4444', border: '1px solid #ef444444' }}>
                            {b.dayOfMonth}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm text-slate-200">{b.description}</p>
                            <CategoryBadge cat={b.category} />
                          </div>
                          <p className="text-sm font-bold text-white">{fmt(toAmt(b.amount))}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ══ SPLITS VIEW ══ */}
            {view === 'splits' && (
              <div className="mt-4 space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Bill Splits</p>

                {/* Add split */}
                <div style={{ background: '#0d1220', border: '1px solid #1a2030' }} className="rounded-2xl p-4 space-y-3">
                  <p className="text-xs text-slate-500 uppercase tracking-widest">New Split</p>
                  <input value={splitForm.description} onChange={e => setSplitForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="What for? (e.g. dinner at Nihonbashi)"
                    style={{ background: '#060810', border: '1px solid #1a2030' }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none" />
                  <input type="number" value={splitForm.total} onChange={e => setSplitForm(p => ({ ...p, total: e.target.value }))}
                    placeholder="Total amount (LKR)"
                    style={{ background: '#060810', border: '1px solid #1a2030' }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none" />
                  <input value={splitForm.participants} onChange={e => setSplitForm(p => ({ ...p, participants: e.target.value }))}
                    placeholder="Friends (comma separated, e.g. Ashan, Danu)"
                    style={{ background: '#060810', border: '1px solid #1a2030' }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none" />
                  <input value={splitForm.paidBy} onChange={e => setSplitForm(p => ({ ...p, paidBy: e.target.value }))}
                    placeholder="Paid by (default: Me)"
                    style={{ background: '#060810', border: '1px solid #1a2030' }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none" />
                  <button onClick={addSplit} style={{ background: '#2563eb' }}
                    className="w-full rounded-xl py-2.5 text-sm font-bold text-white">Add Split</button>
                </div>

                {/* Splits list */}
                {splits.length === 0 ? (
                  <p className="text-sm text-slate-600 text-center py-6">No splits yet. Add one above.</p>
                ) : (
                  splits.map(s => (
                    <div key={s.id} style={{ background: '#0d1220', border: `1px solid ${s.settled ? '#10b98133' : '#1a2030'}` }} className="rounded-2xl p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-sm font-semibold text-white">{s.description}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{s.date} · Paid by {s.paidBy}</p>
                        </div>
                        <button onClick={() => setSplits(prev => prev.map(x => x.id === s.id ? { ...x, settled: !x.settled } : x))}
                          className="text-xs px-2 py-1 rounded-lg font-medium transition-all"
                          style={{ background: s.settled ? '#10b98122' : '#1a2030', color: s.settled ? '#10b981' : '#64748b', border: `1px solid ${s.settled ? '#10b98144' : '#1a2030'}` }}>
                          {s.settled ? '✓ Settled' : 'Mark settled'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div style={{ background: '#060810' }} className="rounded-xl p-2 text-center">
                          <p className="text-xs text-slate-500">Total</p>
                          <p className="text-sm font-bold text-white">{fmt(s.total)}</p>
                        </div>
                        <div style={{ background: '#060810' }} className="rounded-xl p-2 text-center">
                          <p className="text-xs text-slate-500">My Share</p>
                          <p className="text-sm font-bold text-blue-400">{fmt(s.myShare)}</p>
                        </div>
                      </div>
                      {s.participants.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {s.participants.map((p, i) => (
                            <span key={i} className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: '#1a2030', color: '#94a3b8', border: '1px solid #2a3040' }}>
                              {p} owes {fmt((s.total - s.myShare) / s.participants.length)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bottom nav ── */}
      <div style={{ background: '#080b12', borderTop: '1px solid #1a2030' }} className="fixed bottom-0 left-0 right-0 z-40 flex justify-around px-2 py-2 safe-area-pb">
        {navItems.map(item => (
          <button key={item.id} onClick={() => { setView(item.id); setSelectedMonth(null); setActiveCat(null); }}
            className="flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all"
            style={{ color: view === item.id ? '#3b82f6' : '#475569', background: view === item.id ? '#1e3a5f22' : 'transparent' }}>
            <item.icon size={20} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}