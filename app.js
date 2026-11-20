/**
 * KeuanganKu - Aplikasi Catatan Keuangan Offline-First
 * Orchestrator Utama: State, Event Listeners, Manajemen Tema, dan Siklus Hidup Aplikasi
 */

// =============================================================================
// 1. State Aplikasi Terpusat
// =============================================================================
const state = {
  transactions: [],
  budgets: {},
  revision: 0,
  currentPeriod: 'monthly', // Default ke bulanan
  anchorDate: new Date(),   // Tanggal hari ini agar dashboard Beranda selalu menampilkan bulan berjalan
  activeTab: 'beranda',     // 'beranda', 'transaksi', 'anggaran', 'laporan'
  filters: {
    search: '',
    type: 'all',            // 'all', 'income', 'expense'
    category: 'all'
  },
  charts: {
    cashflow: null,
    category: null
  },
  editingId: null
};

// =============================================================================
// 2. Manajemen Tema (Dark / Light Mode)
// =============================================================================
function initTheme() {
  let saved;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (error) {
    console.error('Gagal membaca tema:', error);
  }
  if (saved === 'dark' || saved === 'light') {
    setTheme(saved);
  } else {
    // Default dark theme yang elegan dan modern
    setTheme('dark');
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    console.error('Gagal menyimpan tema:', error);
  }

  const metaTheme = document.getElementById('metaThemeColor');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#0b0f17' : '#ffffff');
  }

  // Update ikon tombol tema
  const icon = document.querySelector('#themeToggleBtn i');
  if (icon) {
    if (theme === 'dark') {
      icon.className = 'fa-solid fa-moon';
    } else {
      icon.className = 'fa-solid fa-sun';
    }
  }

  // Render ulang grafik dengan skema warna yang sesuai
  if (typeof renderCharts === 'function') {
    renderCharts();
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

// =============================================================================
// 3. Form Transaksi & Aksi Data
// =============================================================================
async function handleFormSubmit(e) {
  if (e) e.preventDefault();

  const typeRadio = document.querySelector('input[name="transactionType"]:checked');
  const type = typeRadio ? typeRadio.value : 'expense';
  const date = document.getElementById('formDate')?.value;
  const time = document.getElementById('formTime')?.value || '12:00';
  const rawAmount = document.getElementById('formAmount')?.value;
  const amount = parseFormattedNumber(rawAmount);
  const category = document.getElementById('formCategory')?.value;
  const title = (document.getElementById('formTitle')?.value || '').trim();
  const notes = (document.getElementById('formNotes')?.value || '').trim();

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    showToast('Masukkan nominal rupiah bulat lebih dari 0.', 'danger');
    return;
  }

  if (!title) {
    showToast('Keterangan transaksi wajib diisi', 'danger');
    return;
  }

  const editing = Boolean(state.editingId);
  const revision = editing ? state.editingRevision : state.revision;
  const previous = state.transactions.find(item => item.id === state.editingId);
  if (editing && !previous) {
    showToast('Transaksi ini sudah dihapus. Tutup formulir untuk melanjutkan.', 'danger');
    return;
  }

  const transaction = {
    id: previous?.id ?? ('tx-' + crypto.randomUUID()),
    type, date, time, amount, category, title, notes
  };
  const next = editing
    ? state.transactions.map(item => item.id === transaction.id ? transaction : item)
    : [transaction, ...state.transactions];

  if (!await persistTransactions(next, revision)) return;
  showToast(editing ? 'Transaksi berhasil diperbarui' : 'Transaksi baru berhasil dicatat', 'success');

  closeModal();
  refreshUI();
}

async function persistTransactions(items, revision = state.revision) {
  try {
    await saveTransactions(items, revision);
    return true;
  } catch (error) {
    console.error('Gagal menyimpan transaksi:', error);
    showToast('Gagal menyimpan transaksi: ' + error.message, 'danger');
    return false;
  }
}

async function confirmDelete(id) {
  const item = state.transactions.find(t => t.id === id);
  if (!item) return;

  const revision = state.revision;
  const conf = confirm(`Apakah Anda yakin ingin menghapus catatan "${item.title}" (${formatRupiah(item.amount)})?`);
  if (conf) {
    if (!await persistTransactions(state.transactions.filter(t => t.id !== id), revision)) return;
    showToast('Catatan transaksi telah dihapus', 'info');
    refreshUI();
  }
}

// =============================================================================
// 4. Setup Seluruh Event Listeners & Binding
// =============================================================================
function setupEventListeners() {
  // Navigasi Tab Bawah
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });

  // FAB Tambah Transaksi di Navigasi Bawah & Header
  document.getElementById('bottomFabAddBtn')?.addEventListener('click', openAddModal);
  document.getElementById('openAddModalBtn')?.addEventListener('click', openAddModal);
  document.getElementById('fabAddBtn')?.addEventListener('click', openAddModal);
  document.getElementById('emptyAddBtn')?.addEventListener('click', openAddModal);

  // Pintasan aksi dari card Beranda & Anggaran
  document.getElementById('viewDetailCashflowBtn')?.addEventListener('click', () => switchTab('transaksi'));
  document.getElementById('viewAllTxBtn')?.addEventListener('click', () => switchTab('transaksi'));
  document.getElementById('newBudgetBtn')?.addEventListener('click', () => {
    openAddModal();
    const expRadio = document.querySelector('input[name="transactionType"][value="expense"]');
    if (expRadio) {
      expRadio.checked = true;
      populateCategoryDropdown('expense');
    }
  });

  // Info Bubble Modals
  document.querySelectorAll('.info-bubble-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const metric = btn.getAttribute('data-info-type');
      if (metric) openInfoModal(metric);
    });
  });

  document.getElementById('closeInfoModalBtn')?.addEventListener('click', () => {
    document.getElementById('infoMetricModal')?.close();
  });

  // Notifikasi
  document.getElementById('notificationBtn')?.addEventListener('click', openNotificationModal);
  document.getElementById('closeNotificationModalBtn')?.addEventListener('click', () => {
    document.getElementById('notificationModal')?.close();
  });

  // Tombol Bagikan Ringkasan di Header
  document.getElementById('headerShareBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('quickShareModal');
    if (modal && typeof modal.showModal === 'function') modal.showModal();
  });

  document.getElementById('quickShareTextBtn')?.addEventListener('click', () => {
    document.getElementById('quickShareModal')?.close();
    shareTextSummary();
  });

  document.getElementById('quickSharePdfBtn')?.addEventListener('click', () => {
    document.getElementById('quickShareModal')?.close();
    sharePDFReport();
  });

  document.getElementById('closeQuickShareBtn')?.addEventListener('click', () => {
    document.getElementById('quickShareModal')?.close();
  });

  document.getElementById('dismissQuickShareBtn')?.addEventListener('click', () => {
    document.getElementById('quickShareModal')?.close();
  });

  // Tab Rentang Waktu (Semua, Harian, Mingguan, Bulanan)
  document.querySelectorAll('.period-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-tabs .tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      state.currentPeriod = btn.getAttribute('data-period');
      refreshUI();
    });
  });

  // Navigasi Tanggal Periode
  document.getElementById('prevPeriodBtn')?.addEventListener('click', () => {
    const anchor = state.anchorDate;
    if (state.currentPeriod === 'daily') {
      anchor.setDate(anchor.getDate() - 1);
    } else if (state.currentPeriod === 'weekly') {
      anchor.setDate(anchor.getDate() - 7);
    } else if (state.currentPeriod === 'monthly') {
      anchor.setDate(1);
      anchor.setMonth(anchor.getMonth() - 1);
    }
    refreshUI();
  });

  document.getElementById('nextPeriodBtn')?.addEventListener('click', () => {
    const anchor = state.anchorDate;
    if (state.currentPeriod === 'daily') {
      anchor.setDate(anchor.getDate() + 1);
    } else if (state.currentPeriod === 'weekly') {
      anchor.setDate(anchor.getDate() + 7);
    } else if (state.currentPeriod === 'monthly') {
      anchor.setDate(1);
      anchor.setMonth(anchor.getMonth() + 1);
    }
    refreshUI();
  });

  document.getElementById('resetPeriodBtn')?.addEventListener('click', () => {
    state.anchorDate = new Date();
    refreshUI();
  });

  // Date Pickers Change
  const dailyPicker = document.getElementById('datePickerDaily');
  dailyPicker?.addEventListener('change', e => {
    if (e.target.value) {
      state.anchorDate = new Date(e.target.value + 'T00:00:00');
      refreshUI();
    }
  });

  const monthlyPicker = document.getElementById('datePickerMonthly');
  monthlyPicker?.addEventListener('change', e => {
    if (e.target.value) {
      const [year, month] = e.target.value.split('-');
      state.anchorDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
      refreshUI();
    }
  });

  // Pencarian & Filter Kategori/Tipe
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  searchInput?.addEventListener('input', e => {
    state.filters.search = e.target.value;
    if (e.target.value) {
      clearSearchBtn?.classList.remove('hidden');
    } else {
      clearSearchBtn?.classList.add('hidden');
    }
    renderTransactionsTable();
  });

  clearSearchBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    state.filters.search = '';
    clearSearchBtn?.classList.add('hidden');
    renderTransactionsTable();
  });

  document.getElementById('typeFilter')?.addEventListener('change', e => {
    state.filters.type = e.target.value;
    renderTransactionsTable();
  });

  document.getElementById('categoryFilter')?.addEventListener('change', e => {
    state.filters.category = e.target.value;
    renderTransactionsTable();
  });

  // Delegated event listener untuk aksi transaksi (mencegah inline event handler XSS)
  const handleTxActionClick = (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (!id) return;
      if (action === 'edit' && typeof openEditModal === 'function') {
        openEditModal(id);
      } else if (action === 'delete' && typeof confirmDelete === 'function') {
        confirmDelete(id);
      }
      return;
    }

    const recentItem = e.target.closest('.recent-tx-item[data-action="edit"]');
    if (recentItem) {
      const id = recentItem.getAttribute('data-id');
      if (id && typeof openEditModal === 'function') {
        openEditModal(id);
      }
    }
  };

  document.getElementById('recentTransactionsList')?.addEventListener('click', handleTxActionClick);
  document.getElementById('transactionsTableBody')?.addEventListener('click', handleTxActionClick);
  document.getElementById('mobileTransactionsList')?.addEventListener('click', handleTxActionClick);

  // Modal Tambah/Edit Transaksi & Form
  document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('cancelModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('transactionForm')?.addEventListener('submit', handleFormSubmit);

  // Radio Tipe Transaksi dalam Modal
  document.querySelectorAll('input[name="transactionType"]').forEach(radio => {
    radio.addEventListener('change', e => {
      populateCategoryDropdown(e.target.value);
    });
  });

  // Formatter Otomatis Input Nominal
  const amountInput = document.getElementById('formAmount');
  const spelledOut = document.getElementById('amountSpelledOut');
  amountInput?.addEventListener('input', e => {
    const num = parseFormattedNumber(e.target.value);
    if (num > 0) {
      e.target.value = new Intl.NumberFormat('id-ID').format(num);
      if (spelledOut) spelledOut.textContent = formatRupiah(num);
    } else if (spelledOut) {
      spelledOut.textContent = Number.isNaN(num) ? 'Masukkan nominal rupiah bulat.' : '';
    }
  });

  // Modal Ekspor & Cadangan
  document.getElementById('exportBtn')?.addEventListener('click', openExportModal);
  document.getElementById('quickShareBtn')?.addEventListener('click', openExportModal);
  document.getElementById('closeExportModalBtn')?.addEventListener('click', closeExportModal);

  document.getElementById('exportPdfBtn')?.addEventListener('click', exportToPDF);
  document.getElementById('sharePdfBtn')?.addEventListener('click', sharePDFReport);
  document.getElementById('shareTextBtn')?.addEventListener('click', shareTextSummary);
  document.getElementById('shareWhatsappBtn')?.addEventListener('click', shareTextSummary);
  document.getElementById('exportJsonBtn')?.addEventListener('click', exportToJSON);
  document.getElementById('shareJsonBtn')?.addEventListener('click', shareJSONBackup);
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportToCSV);
  document.getElementById('printReportBtn')?.addEventListener('click', printReport);

  const importJsonBtn = document.getElementById('importJsonBtn');
  const importJsonInput = document.getElementById('importJsonInput');
  if (importJsonBtn && importJsonInput) {
    importJsonBtn.addEventListener('click', () => importJsonInput.click());
    importJsonInput.addEventListener('change', handleImportJsonFile);
  }

  // Tab Laporan Action Hub Buttons
  document.getElementById('hubExportPdfBtn')?.addEventListener('click', exportToPDF);
  document.getElementById('hubSharePdfBtn')?.addEventListener('click', sharePDFReport);
  document.getElementById('hubShareTextBtn')?.addEventListener('click', shareTextSummary);
  document.getElementById('hubShareWaBtn')?.addEventListener('click', shareTextSummary);
  document.getElementById('hubExportCsvBtn')?.addEventListener('click', exportToCSV);
  document.getElementById('hubExportJsonBtn')?.addEventListener('click', exportToJSON);
  document.getElementById('hubShareJsonBtn')?.addEventListener('click', shareJSONBackup);
  document.getElementById('hubImportJsonBtn')?.addEventListener('click', () => importJsonInput?.click());
  document.getElementById('hubPrintBtn')?.addEventListener('click', printReport);

  // Theme Toggle Button
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);

  // Data Demo & Sample
  document.getElementById('resetDemoDataBtn')?.addEventListener('click', loadSampleData);
  document.getElementById('emptySampleDataBtn')?.addEventListener('click', loadSampleData);

  // Hapus Seluruh Data
  document.getElementById('clearAllDataBtn')?.addEventListener('click', async () => {
    const revision = state.revision;
    const conf = confirm('Peringatan: Hapus semua catatan transaksi secara permanen? Tindakan ini tidak dapat dibatalkan.');
    if (conf) {
      if (!await persistTransactions([], revision)) return;
      showToast('Semua data transaksi telah dihapus', 'info');
      refreshUI();
    }
  });

  // Modal Atur Anggaran Bulanan
  document.getElementById('openBudgetModalBtn')?.addEventListener('click', openBudgetModal);
  document.getElementById('closeBudgetModalBtn')?.addEventListener('click', closeBudgetModal);
  document.getElementById('cancelBudgetBtn')?.addEventListener('click', closeBudgetModal);
  document.getElementById('budgetForm')?.addEventListener('submit', handleSaveBudgets);

  // Backup Reminder Banner Actions
  document.getElementById('bannerBackupNowBtn')?.addEventListener('click', exportToJSON);
  document.getElementById('bannerDismissBackupBtn')?.addEventListener('click', dismissBackupReminderBanner);

  // Close modals on clicking outside dialog card
  document.querySelectorAll('.app-modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.close();
      }
    });
  });

  // Android Capacitor Back Button
  setupAndroidBackButton();
}

let isBackButtonInitialized = false;

/**
 * Pengendali Tombol Kembali Android Capacitor
 */
function setupAndroidBackButton() {
  if (!isNativePlatform() || isBackButtonInitialized) return;

  const App = window.Capacitor?.Plugins?.App;
  if (!App || typeof App.addListener !== 'function') return;

  isBackButtonInitialized = true;
  App.addListener('backButton', () => {
    const modals = [
      document.getElementById('transactionModal'),
      document.getElementById('budgetModal'),
      document.getElementById('exportModal'),
      document.getElementById('quickShareModal'),
      document.getElementById('infoMetricModal'),
      document.getElementById('notificationModal'),
      document.getElementById('iosInstallModal')
    ];

    for (const m of modals) {
      if (m && m.open) {
        m.close();
        return;
      }
    }

    App.exitApp();
  });
}

/**
 * Menyembunyikan elemen instalasi PWA saat berjalan di native Android
 */
function hidePwaInstallElements() {
  const installAppBtn = document.getElementById('installAppBtn');
  const pwaInstallBanner = document.getElementById('pwaInstallBanner');
  const iosInstallModal = document.getElementById('iosInstallModal');

  if (installAppBtn) installAppBtn.classList.add('hidden');
  if (pwaInstallBanner) pwaInstallBanner.classList.add('hidden');
  if (iosInstallModal) {
    if (iosInstallModal.open) iosInstallModal.close();
    iosInstallModal.classList.add('hidden');
  }
}

// =============================================================================
// 5. PWA & Status Jaringan
// =============================================================================
let deferredInstallPrompt = null;

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true ||
         document.referrer.includes('android-app://');
}

function setupNetworkStatusListeners() {
  const offlineIndicator = document.getElementById('offlineIndicator');
  
  function updateNetworkStatus() {
    if (navigator.onLine) {
      if (offlineIndicator) offlineIndicator.classList.add('hidden');
    } else {
      if (offlineIndicator) offlineIndicator.classList.remove('hidden');
      showToast('Koneksi terputus. Mode offline aktif (data aman di perangkat).', 'info');
    }
  }

  window.addEventListener('online', () => {
    updateNetworkStatus();
    showToast('Koneksi internet terhubung kembali.', 'success');
  });
  
  window.addEventListener('offline', () => {
    updateNetworkStatus();
  });

  if (!navigator.onLine && offlineIndicator) {
    offlineIndicator.classList.remove('hidden');
  }
}

function setupPWAInstallation() {
  if (isNativePlatform()) {
    hidePwaInstallElements();
    void pruneTemporaryExports();
    return;
  }

  const installAppBtn = document.getElementById('installAppBtn');
  const pwaInstallBanner = document.getElementById('pwaInstallBanner');
  const bannerInstallBtn = document.getElementById('bannerInstallBtn');
  const bannerDismissBtn = document.getElementById('bannerDismissBtn');
  const iosInstallModal = document.getElementById('iosInstallModal');
  const closeIosInstallModalBtn = document.getElementById('closeIosInstallModalBtn');
  const dismissIosModalBtn = document.getElementById('dismissIosModalBtn');

  if (isStandalone()) {
    return;
  }

  const isBannerDismissed = sessionStorage.getItem('keuanganku_install_banner_dismissed') === 'true';

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;

    if (installAppBtn) installAppBtn.classList.remove('hidden');

    if (pwaInstallBanner && !isBannerDismissed) {
      pwaInstallBanner.classList.remove('hidden');
    }
  });

  if (isIOS() && !isStandalone()) {
    if (installAppBtn) installAppBtn.classList.remove('hidden');
    if (pwaInstallBanner && !isBannerDismissed) {
      pwaInstallBanner.classList.remove('hidden');
    }
  }

  async function handleInstallAction() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choiceResult = await deferredInstallPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        showToast('Memasang KeuanganKu ke layar utama...', 'success');
        if (installAppBtn) installAppBtn.classList.add('hidden');
        if (pwaInstallBanner) pwaInstallBanner.classList.add('hidden');
      }
      deferredInstallPrompt = null;
    } else if (isIOS()) {
      if (iosInstallModal) {
        iosInstallModal.showModal();
      }
    } else {
      showToast('Untuk memasang di perangkat: buka menu browser lalu pilih "Install KeuanganKu".', 'info');
    }
  }

  if (installAppBtn) installAppBtn.addEventListener('click', handleInstallAction);
  if (bannerInstallBtn) bannerInstallBtn.addEventListener('click', handleInstallAction);

  if (bannerDismissBtn) {
    bannerDismissBtn.addEventListener('click', () => {
      if (pwaInstallBanner) pwaInstallBanner.classList.add('hidden');
      sessionStorage.setItem('keuanganku_install_banner_dismissed', 'true');
    });
  }

  if (closeIosInstallModalBtn) {
    closeIosInstallModalBtn.addEventListener('click', () => {
      if (iosInstallModal) iosInstallModal.close();
    });
  }

  if (dismissIosModalBtn) {
    dismissIosModalBtn.addEventListener('click', () => {
      if (iosInstallModal) iosInstallModal.close();
    });
  }

  window.addEventListener('appinstalled', () => {
    showToast('Aplikasi KeuanganKu berhasil terpasang di perangkat Anda!', 'success');
    if (installAppBtn) installAppBtn.classList.add('hidden');
    if (pwaInstallBanner) pwaInstallBanner.classList.add('hidden');
    deferredInstallPrompt = null;
  });
}

// =============================================================================
// 6. Inisialisasi Saat DOM Siap (App Bootstrap)
// =============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  state.transactions = loadTransactions();
  state.budgets = loadBudgets();

  async function refreshStoredData() {
    const revision = state.revision;
    try {
      await synchronizeLedger();
      if (state.revision !== revision) refreshUI();
    } catch (error) {
      console.error('Gagal membaca penyimpanan:', error);
    }
  }

  if (typeof BroadcastChannel === 'function') {
    state.ledgerChannel = new BroadcastChannel('keuanganku-ledger');
    state.ledgerChannel.onmessage = refreshStoredData;
  }
  window.addEventListener('focus', refreshStoredData);
  try {
    await synchronizeLedger();
  } catch (error) {
    console.error('Gagal membuka penyimpanan:', error);
    showToast('Penyimpanan tidak tersedia. Perubahan tidak dapat disimpan.', 'danger');
  }
  populateCategoryDropdown('expense');
  populateFilterCategoryDropdown();
  setupEventListeners();
  refreshUI();
  checkBackupReminder();

  setupNetworkStatusListeners();

  if (isNativePlatform()) {
    hidePwaInstallElements();
  } else {
    setupPWAInstallation();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(error => {
        console.error('Gagal mengaktifkan cache offline:', error);
      });
    }
  }
});

