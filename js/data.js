/**
 * KeuanganKu - Data & Storage Management
 * Modul master kategori, penyimpanan localStorage, sample data relatif, dan validasi schema data
 */

// =============================================================================
// Master Data Kategori
// =============================================================================
const CATEGORIES = {
  expense: [
    { id: 'food', name: 'Makanan & Minuman', icon: 'fa-utensils', color: '#f43f5e' },
    { id: 'transport', name: 'Transportasi', icon: 'fa-car-side', color: '#f97316' },
    { id: 'shopping', name: 'Belanja & Kebutuhan', icon: 'fa-bag-shopping', color: '#ec4899' },
    { id: 'bills', name: 'Tagihan & Utilitas', icon: 'fa-receipt', color: '#eab308' },
    { id: 'entertainment', name: 'Hiburan & Liburan', icon: 'fa-film', color: '#a855f7' },
    { id: 'health', name: 'Kesehatan & Medis', icon: 'fa-heart-pulse', color: '#06b6d4' },
    { id: 'education', name: 'Pendidikan & Kursus', icon: 'fa-graduation-cap', color: '#3b82f6' },
    { id: 'gift', name: 'Donasi & Sedekah', icon: 'fa-hand-holding-heart', color: '#14b8a6' },
    { id: 'other_expense', name: 'Lain-lain', icon: 'fa-ellipsis', color: '#64748b' }
  ],
  income: [
    { id: 'salary', name: 'Gaji Bulanan', icon: 'fa-money-bill-wave', color: '#10b981' },
    { id: 'freelance', name: 'Freelance & Side Job', icon: 'fa-laptop-code', color: '#059669' },
    { id: 'business', name: 'Usaha & Dagang', icon: 'fa-store', color: '#14b8a6' },
    { id: 'investment', name: 'Investasi & Dividen', icon: 'fa-chart-line', color: '#3b82f6' },
    { id: 'bonus', name: 'Bonus & THR', icon: 'fa-trophy', color: '#eab308' },
    { id: 'gift_income', name: 'Hadiah & Bantuan', icon: 'fa-gift', color: '#8b5cf6' },
    { id: 'other_income', name: 'Lain-lain', icon: 'fa-circle-dollar-to-slot', color: '#64748b' }
  ]
};

// =============================================================================
// Kunci LocalStorage
// =============================================================================
const STORAGE_KEY = 'keuanganku_transactions_v1';
const THEME_KEY = 'keuanganku_theme_v1';
const BUDGET_KEY = 'keuanganku_budgets_v1';
const BACKUP_KEY = 'keuanganku_last_backup_v1';
const BACKUP_DISMISS_KEY = 'keuanganku_backup_dismissed_until';

/**
 * Mencari metadata informasi kategori berdasarkan jenis transaksi dan ID kategori
 * @param {'expense'|'income'} type
 * @param {string} catId
 * @returns {{ id: string, name: string, icon: string, color: string }}
 */
function getCategoryInfo(type, catId) {
  const list = CATEGORIES[type] || [];
  const found = list.find(c => c.id === catId);
  if (found) return found;
  const fallback = [...CATEGORIES.expense, ...CATEGORIES.income].find(c => c.id === catId);
  return fallback || { id: catId, name: catId || 'Lain-lain', icon: 'fa-tag', color: '#64748b' };
}

/**
 * Membaca daftar transaksi dari localStorage
 * @returns {Array<Object>}
 */
function loadTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Gagal membaca transaksi dari localStorage:', e);
    return [];
  }
}

/**
 * Menyimpan daftar transaksi ke localStorage
 * @param {Array<Object>} txs
 */
function saveTransactions(transactions, revision = state.revision) {
  return saveLedger({ transactions }, revision);
}

/**
 * Membaca data batas anggaran bulanan dari localStorage
 * @returns {Record<string, number>}
 */
function loadBudgets() {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    console.error('Gagal membaca anggaran:', e);
    return {};
  }
}

/**
 * Menyimpan data batas anggaran bulanan ke localStorage
 * @param {Record<string, number>} budgets
 */
function saveBudgets(budgets, revision = state.revision) {
  return saveLedger({ budgets }, revision);
}

let databasePromise;

function openLedger() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('keuanganku', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('ledger');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

async function readLedger() {
  const db = await openLedger();
  return new Promise((resolve, reject) => {
    const request = db.transaction('ledger').objectStore('ledger').get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function applyLedger(ledger) {
  if (!ledger || ledger.revision <= state.revision) return;
  state.revision = ledger.revision;
  state.transactions = ledger.transactions;
  state.budgets = ledger.budgets;
}

async function synchronizeLedger() {
  applyLedger(await readLedger());
}

async function saveLedger(changes, expectedRevision = state.revision) {
  const db = await openLedger();
  const result = await new Promise((resolve, reject) => {
    const transaction = db.transaction('ledger', 'readwrite');
    const store = transaction.objectStore('ledger');
    const request = store.get('current');
    let current;
    let next;

    request.onsuccess = () => {
      current = request.result;
      const revision = current?.revision ?? 0;
      if (revision !== expectedRevision) return;
      next = {
        transactions: current?.transactions ?? loadTransactions(),
        budgets: current?.budgets ?? loadBudgets(),
        ...changes,
        revision: revision + 1
      };
      store.put(next, 'current');
    };
    transaction.oncomplete = () => resolve({ current, next });
    transaction.onabort = () => reject(transaction.error || new Error('Penyimpanan dibatalkan.'));
  });

  if (!result.next) {
    applyLedger(result.current);
    refreshUI();
    throw new Error('Data berubah sejak tindakan ini dimulai. Periksa data terbaru dan buka ulang formulir bila perlu.');
  }
  applyLedger(result.next);
  if (state.ledgerChannel) state.ledgerChannel.postMessage('updated');
}

/**
 * Mendapatkan timestamp cadangan terakhir
 * @returns {number|null}
 */
function getLastBackupTimestamp() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch (e) {
    return null;
  }
}

/**
 * Menyimpan timestamp keberhasilan backup
 * @param {number} [timestamp]
 */
function setLastBackupTimestamp(timestamp = Date.now()) {
  try {
    localStorage.setItem(BACKUP_KEY, String(timestamp));
  } catch (e) {
    console.error('Gagal menyimpan timestamp backup:', e);
  }
}

/**
 * Cek apakah reminder backup sedang dalam masa dismiss
 * @returns {boolean}
 */
function isBackupDismissed() {
  try {
    const raw = localStorage.getItem(BACKUP_DISMISS_KEY);
    const until = parseInt(raw, 10);
    return Number.isFinite(until) && until > Date.now();
  } catch (e) {
    return false;
  }
}

/**
 * Dismiss pengingat backup selama rentang hari tertentu (default 7 hari)
 * @param {number} [days=7]
 */
function dismissBackupReminder(days = 7) {
  try {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(BACKUP_DISMISS_KEY, String(until));
  } catch (e) {
    console.error('Gagal menyimpan dismiss backup:', e);
  }
}

/**
 * Generate seed / sample demo data relatif ke bulan berjalan saat ini
 * Dashboard Beranda akan langsung terisi data realistis di bulan aktif
 * @param {Date} [baseDate]
 * @returns {Array<Object>}
 */
function generateSampleData(baseDate = new Date()) {
  const currentYear = baseDate.getFullYear();
  const currentMonth = baseDate.getMonth(); // 0-indexed

  // Helper untuk membuat tanggal berformat YYYY-MM-DD
  const makeDate = (year, monthIdx, day) => {
    const y = year;
    const m = String(monthIdx + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const curPrefix = `tx-${currentYear}${String(currentMonth + 1).padStart(2, '0')}`;

  // Bulan lalu
  const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const prevYear = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth();
  const prevPrefix = `tx-${prevYear}${String(prevMonth + 1).padStart(2, '0')}`;

  return [
    // --- BULAN BERJALAN: Total Pemasukan = Rp 10.850.000, Total Pengeluaran = Rp 1.545.000, Saldo = Rp 9.305.000 ---
    {
      id: `${curPrefix}-01`,
      type: 'income',
      title: 'Gaji Pokok Bulanan',
      amount: 8500000,
      category: 'salary',
      date: makeDate(currentYear, currentMonth, 1),
      time: '09:00',
      notes: 'Transfer payroll rekening utama kantor'
    },
    {
      id: `${curPrefix}-02`,
      type: 'expense',
      title: 'Tagihan Listrik PLN & Internet Fiber',
      amount: 680000,
      category: 'bills',
      date: makeDate(currentYear, currentMonth, 2),
      time: '08:30',
      notes: 'Pembayaran tagihan bulanan via m-banking'
    },
    {
      id: `${curPrefix}-03`,
      type: 'expense',
      title: 'Belanja Mingguan Supermarket',
      amount: 450000,
      category: 'shopping',
      date: makeDate(currentYear, currentMonth, 5),
      time: '11:00',
      notes: 'Kebutuhan dapur, sayur, dan bahan pangan'
    },
    {
      id: `${curPrefix}-04`,
      type: 'income',
      title: 'Proyek Desain Web Freelance',
      amount: 2000000,
      category: 'freelance',
      date: makeDate(currentYear, currentMonth, 10),
      time: '14:15',
      notes: 'Pelunasan invoice termin 2 klien Jakarta'
    },
    {
      id: `${curPrefix}-05`,
      type: 'expense',
      title: 'Makan Siang & Kopi Mingguan',
      amount: 175000,
      category: 'food',
      date: makeDate(currentYear, currentMonth, 12),
      time: '13:00',
      notes: 'Makan siang bareng tim kantor'
    },
    {
      id: `${curPrefix}-06`,
      type: 'expense',
      title: 'Bensin & Saldo E-Toll',
      amount: 140000,
      category: 'transport',
      date: makeDate(currentYear, currentMonth, 15),
      time: '07:45',
      notes: 'Isi Pertamax dan top-up Flazz e-toll'
    },
    {
      id: `${curPrefix}-07`,
      type: 'income',
      title: 'Dividen Reksadana Pasar Uang',
      amount: 350000,
      category: 'investment',
      date: makeDate(currentYear, currentMonth, 18),
      time: '10:00',
      notes: 'Bagi hasil kupon bulanan platform investasi'
    },
    {
      id: `${curPrefix}-08`,
      type: 'expense',
      title: 'Obat & Vitamin Daya Tahan',
      amount: 100000,
      category: 'health',
      date: makeDate(currentYear, currentMonth, 20),
      time: '19:20',
      notes: 'Beli suplemen vitamin C di apotek'
    },

    // --- BULAN SEBELUMNYA: Untuk perbandingan pertumbuhan tren ---
    {
      id: `${prevPrefix}-01`,
      type: 'income',
      title: 'Gaji Pokok Bulanan',
      amount: 8500000,
      category: 'salary',
      date: makeDate(prevYear, prevMonth, 1),
      time: '09:00',
      notes: 'Transfer payroll rekening utama kantor'
    },
    {
      id: `${prevPrefix}-02`,
      type: 'expense',
      title: 'Sewa Tempat Tinggal / Kos',
      amount: 1200000,
      category: 'bills',
      date: makeDate(prevYear, prevMonth, 3),
      time: '10:00',
      notes: 'Pembayaran sewa bulanan'
    },
    {
      id: `${prevPrefix}-03`,
      type: 'expense',
      title: 'Belanja Bulanan & Kebutuhan Rumah',
      amount: 750000,
      category: 'shopping',
      date: makeDate(prevYear, prevMonth, 8),
      time: '16:00',
      notes: 'Perlengkapan mandi, deterjen, sembako'
    },
    {
      id: `${prevPrefix}-04`,
      type: 'income',
      title: 'Bonus Kinerja Triwulan',
      amount: 3000000,
      category: 'bonus',
      date: makeDate(prevYear, prevMonth, 15),
      time: '11:30',
      notes: 'Apresiasi pencapaian target'
    },
    {
      id: `${prevPrefix}-05`,
      type: 'expense',
      title: 'Servis Berkala Kendaraan',
      amount: 480000,
      category: 'transport',
      date: makeDate(prevYear, prevMonth, 22),
      time: '13:45',
      notes: 'Ganti oli dan filter di bengkel resmi'
    }
  ];
}

/**
 * Validasi ketat schema data transaksi untuk import JSON
 * Wajib:
 * - array of object
 * - id: string non-kosong (karakter aman)
 * - type: 'income' | 'expense'
 * - title: string non-kosong
 * - amount: number finite >= 0
 * - category: string (whitelist atau fallback other_expense/other_income)
 * - date: string YYYY-MM-DD valid kalender
 * Opsional:
 * - time: string
 * - notes: string
 * @param {*} data
 * @returns {{ valid: boolean, items: Array<Object>, skipped: number, error?: string }}
 */
function validateTransactionsImport(data) {
  if (!data) {
    return { valid: false, items: [], skipped: 0, error: 'Berkas cadangan kosong atau tidak terbaca.' };
  }

  let itemsArray = null;
  if (Array.isArray(data)) {
    itemsArray = data;
  } else if (typeof data === 'object' && Array.isArray(data.transactions)) {
    itemsArray = data.transactions;
  } else {
    return { valid: false, items: [], skipped: 0, error: 'Format berkas harus berupa array transaksi JSON.' };
  }

  const validExpenseCategories = (CATEGORIES.expense || []).map(c => c.id);
  const validIncomeCategories = (CATEGORIES.income || []).map(c => c.id);
  const validItems = [];
  let skipped = 0;

  for (const item of itemsArray) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      skipped++;
      continue;
    }

    // 1. Wajib id (string alfanumerik aman, '-', atau '_', maks 64 karakter)
    if (typeof item.id !== 'string') {
      skipped++;
      continue;
    }
    const cleanId = item.id.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleanId)) {
      skipped++;
      continue;
    }

    // 2. Wajib type ('income' atau 'expense')
    if (item.type !== 'income' && item.type !== 'expense') {
      skipped++;
      continue;
    }

    // 3. Wajib title (string tidak kosong)
    if (typeof item.title !== 'string' || item.title.trim() === '') {
      skipped++;
      continue;
    }

    // 4. Wajib amount (angka terbatas >= 0)
    const amt = parseTransactionAmount(item.amount);
    if (item.amount == null || (typeof item.amount === 'string' && !item.amount.trim())
      || !Number.isSafeInteger(amt)) {
      skipped++;
      continue;
    }

    // 5. Wajib date (format YYYY-MM-DD valid kalender)
    const isValidDate = (function(dateStr) {
      if (typeof isValidISODate === 'function') return isValidISODate(dateStr);
      if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const parts = dateStr.split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return false;
      const d = new Date(year, month - 1, day);
      return d.getFullYear() === year && (d.getMonth() + 1) === month && d.getDate() === day;
    })(item.date);

    if (!isValidDate) {
      skipped++;
      continue;
    }

    // 6. Category (harus string, jika tidak cocok arahkan ke fallback)
    let category = typeof item.category === 'string' ? item.category.trim() : '';
    if (item.type === 'expense') {
      if (!validExpenseCategories.includes(category)) {
        category = 'other_expense';
      }
    } else {
      if (!validIncomeCategories.includes(category)) {
        category = 'other_income';
      }
    }

    // Opsional: time dan notes
    const time = typeof item.time === 'string' && item.time.trim() ? item.time.trim().slice(0, 10) : '12:00';
    const notes = typeof item.notes === 'string' ? item.notes.trim().slice(0, 500) : '';
    const title = item.title.trim().slice(0, 100);
    const id = cleanId;

    validItems.push({
      id,
      type: item.type,
      amount: amt,
      date: item.date,
      category,
      title,
      notes,
      time
    });
  }

  if (validItems.length === 0 && itemsArray.length > 0) {
    const extra = skipped > 0 ? ` (${skipped} data tidak valid dilewati)` : '';
    return {
      valid: false,
      items: [],
      skipped,
      error: `Tidak ada transaksi yang memenuhi kriteria validasi schema.${extra}`
    };
  }

  return {
    valid: true,
    items: validItems,
    skipped
  };
}

/**
 * Gabungkan transaksi berdasarkan ID. Konflik mempertahankan data lokal
 * kecuali pengguna memilih untuk menggantinya.
 */
function mergeTransactionsSafely(currentTxs, importedTxs, replaceConflicts = false) {
  const items = [...currentTxs];
  const indexById = new Map();
  items.forEach((item, index) => {
    if (!indexById.has(item.id)) indexById.set(item.id, index);
  });
  const fields = ['type', 'date', 'time', 'amount', 'category', 'title', 'notes'];
  let conflicts = 0;

  for (const item of importedTxs) {
    const index = indexById.get(item.id);
    if (index === undefined) {
      indexById.set(item.id, items.length);
      items.push(item);
      continue;
    }
    if (fields.every(field => items[index][field] === item[field])) continue;
    conflicts++;
    if (replaceConflicts) items[index] = item;
  }

  return { items, conflicts };
}

/**
 * Muat data contoh setelah pengguna memilih gabung atau konfirmasi penggantian.
 */
async function loadSampleData() {
  const revision = state.revision;
  const sample = generateSampleData();
  let items = sample;
  let message = 'Berhasil memuat data percontohan!';

  if (state.transactions.length > 0) {
    if (!confirm('Muat data percontohan? Anda akan memilih cara memuatnya.')) return;
    if (confirm('Gabungkan data contoh dengan transaksi yang ada? Klik Batal untuk melihat opsi penggantian.')) {
      items = mergeTransactionsSafely(state.transactions, sample).items;
      message = 'Data contoh telah digabungkan.';
    } else {
      if (!confirm('Ganti seluruh transaksi yang ada dengan data contoh? Klik Batal untuk membatalkan.')) return;
      message = 'Seluruh transaksi diganti dengan data contoh.';
    }
  } else if (!confirm('Muat data percontohan untuk melihat simulasi dashboard dan laporan?')) {
    return;
  }

  try {
    await saveTransactions(items, revision);
  } catch (error) {
    console.error('Gagal menyimpan data contoh:', error);
    showToast('Gagal menyimpan data contoh: ' + error.message, 'danger');
    return;
  }
  refreshUI();
  showToast(message, 'success');
}

/**
 * Menghitung rentang tanggal satu minggu kalender (Senin sampai Minggu)
 * @param {Date} date
 * @returns {{ start: Date, end: Date }}
 */
function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

/**
 * Filter transaksi berdasarkan periode aktif saat ini
 * @returns {Array<Object>}
 */
function getTransactionsInCurrentPeriod() {
  if (typeof state === 'undefined') return [];
  const anchor = state.anchorDate || new Date();
  const txs = Array.isArray(state.transactions) ? state.transactions : [];

  return txs.filter(item => {
    if (!item.date) return false;
    const itemDate = new Date(item.date + 'T00:00:00');

    if (state.currentPeriod === 'all') {
      return true;
    } else if (state.currentPeriod === 'daily') {
      return formatDateISO(itemDate) === formatDateISO(anchor);
    } else if (state.currentPeriod === 'weekly') {
      const { start, end } = getWeekRange(anchor);
      return itemDate >= start && itemDate <= end;
    } else if (state.currentPeriod === 'monthly') {
      return (
        itemDate.getFullYear() === anchor.getFullYear() &&
        itemDate.getMonth() === anchor.getMonth()
      );
    }
    return true;
  });
}

/**
 * Filter transaksi berdasarkan periode aktif, jenis transaksi, kategori, dan kata kunci pencarian
 * @returns {Array<Object>}
 */
function getFilteredTransactions() {
  if (typeof state === 'undefined') return [];
  const periodItems = getTransactionsInCurrentPeriod();

  return periodItems.filter(item => {
    if (state.filters.type !== 'all' && item.type !== state.filters.type) {
      return false;
    }

    if (state.filters.category !== 'all' && item.category !== state.filters.category) {
      return false;
    }

    if (state.filters.search) {
      const q = state.filters.search.toLowerCase();
      const titleMatch = (item.title || '').toLowerCase().includes(q);
      const notesMatch = (item.notes || '').toLowerCase().includes(q);
      const catInfo = getCategoryInfo(item.type, item.category);
      const catMatch = (catInfo.name || '').toLowerCase().includes(q);
      if (!titleMatch && !notesMatch && !catMatch) return false;
    }

    return true;
  }).sort((a, b) => {
    const dateComp = new Date(b.date + 'T' + (b.time || '00:00')) - new Date(a.date + 'T' + (a.time || '00:00'));
    return dateComp;
  });
}

// Ekspor untuk environment Node.js (pengujian unit test)
const parseTransactionAmount = typeof module !== 'undefined' && module.exports
  ? require('./format.js').parseFormattedNumber : parseFormattedNumber;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CATEGORIES,
    STORAGE_KEY,
    THEME_KEY,
    BUDGET_KEY,
    BACKUP_KEY,
    BACKUP_DISMISS_KEY,
    getCategoryInfo,
    loadTransactions,
    saveTransactions,
    loadBudgets,
    saveBudgets,
    getLastBackupTimestamp,
    setLastBackupTimestamp,
    isBackupDismissed,
    dismissBackupReminder,
    generateSampleData,
    validateTransactionsImport,
    mergeTransactionsSafely,
    loadSampleData,
    getWeekRange,
    getTransactionsInCurrentPeriod,
    getFilteredTransactions
  };
}

