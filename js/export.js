/**
 * KeuanganKu - Export, Sharing & Backup Operations
 * Modul pembuatan PDF, CSV, backup/restore JSON, integrasi Web Share API,
 * Capacitor Filesystem, Share Plugin, dan Plugin Cetak PdfPrint Android
 */

/**
 * Deteksi apakah aplikasi berjalan di platform native Capacitor (Android)
 * @returns {boolean}
 */
function isNativePlatform() {
  return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
}

function getFilesystemPlugin() {
  return window.Capacitor?.Plugins?.Filesystem || null;
}

function getSharePlugin() {
  return window.Capacitor?.Plugins?.Share || null;
}

function getPdfPrintPlugin() {
  return window.Capacitor?.Plugins?.PdfPrint || null;
}

const SHARE_CACHE_DIR = 'keuanganku-share';
const PRINT_CACHE_DIR = 'keuanganku-print';
const TEMP_EXPORT_MAX_AGE = 24 * 60 * 60 * 1000;

async function pruneTemporaryExports(Filesystem = getFilesystemPlugin()) {
  if (!Filesystem) return;
  const cutoff = Date.now() - TEMP_EXPORT_MAX_AGE;
  await Promise.all([SHARE_CACHE_DIR, PRINT_CACHE_DIR].map(async directory => {
    let entries;
    try {
      ({ files: entries } = await Filesystem.readdir({ path: directory, directory: 'CACHE' }));
    } catch {
      return; // Direktori belum ada atau sementara tidak dapat dibaca.
    }
    await Promise.all(entries.map(async ({ name, type }) => {
      const stamp = /^(\d{13})_[0-9a-f-]{36}_[\w.-]+$/.exec(name);
      if (type !== 'file' || !stamp || Number(stamp[1]) >= cutoff) return;
      try {
        await Filesystem.deleteFile({ path: directory + '/' + name, directory: 'CACHE' });
      } catch (error) {
        console.warn('Gagal membersihkan ekspor sementara:', error);
      }
    }));
  }));
}

function temporaryExportPath(directory, filename) {
  return `${directory}/${Date.now()}_${crypto.randomUUID()}_${filename}`;
}

/**
 * Konversi string base64 menjadi Blob biner
 * @param {string} base64
 * @param {string} [mimeType]
 * @returns {Blob}
 */
function base64ToBlob(base64, mimeType = 'application/octet-stream') {
  const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
  const byteCharacters = atob(cleanBase64);
  const byteArrays = [];
  const sliceSize = 512;

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: mimeType });
}

/**
 * Unduh berkas di browser biasa melalui tautan anchor virtual
 * @param {Blob} blob
 * @param {string} filename
 */
function downloadBlobInBrowser(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Memeriksa dan meminta izin penyimpanan (khususnya untuk Android lawas <= 9)
 */
async function ensureStoragePermissions(Filesystem) {
  try {
    if (typeof Filesystem.checkPermissions === 'function') {
      const status = await Filesystem.checkPermissions();
      if (status.publicStorage !== 'granted') {
        if (typeof Filesystem.requestPermissions === 'function') {
          await Filesystem.requestPermissions();
        }
      }
    }
  } catch (err) {
    console.warn('Pemeriksaan izin penyimpanan dilewati:', err);
  }
}

/**
 * Helper terpusat untuk menyimpan berkas
 * - Di Android native: Simpan ke Documents/KeuanganKu/ (Directory.Documents, recursive: true)
 *   Jika berhasil: tampilkan toast "Tersimpan di Dokumen/KeuanganKu/namafile"
 *   Jika gagal (izin/scoped storage): fallback tulis ke Directory.Cache lalu buka share sheet via Share.share({ files: [uri] })
 * - Di browser: fallback unduh standar
 */
async function saveFile(filename, data, mime, options = {}) {
  const isBase64 = !!options.base64;

  // 1. Fallback browser biasa
  if (!isNativePlatform()) {
    try {
      const blob = isBase64 ? base64ToBlob(data, mime) : new Blob([data], { type: mime });
      downloadBlobInBrowser(blob, filename);
      if (typeof showToast === 'function') showToast(`Berkas ${filename} berhasil diunduh!`, 'success');
      return { success: true, method: 'browser-download' };
    } catch (err) {
      console.error('Gagal mengunduh berkas di browser:', err);
      if (typeof showToast === 'function') showToast('Gagal mengunduh berkas: ' + err.message, 'danger');
      return { success: false, error: err };
    }
  }

  // 2. Native Capacitor
  const Filesystem = getFilesystemPlugin();
  const Share = getSharePlugin();

  if (!Filesystem) {
    console.warn('Plugin Filesystem tidak tersedia, fallback ke peramban');
    const blob = isBase64 ? base64ToBlob(data, mime) : new Blob([data], { type: mime });
    downloadBlobInBrowser(blob, filename);
    if (typeof showToast === 'function') showToast(`Berkas ${filename} berhasil diunduh!`, 'success');
    return { success: true, method: 'browser-fallback' };
  }

  let fileData = data;
  if (isBase64 && typeof data === 'string' && data.includes(',')) {
    fileData = data.split(',')[1];
  }

  await ensureStoragePermissions(Filesystem);
  const relativeDocPath = `KeuanganKu/${filename}`;

  try {
    const writeOptions = {
      path: relativeDocPath,
      data: fileData,
      directory: 'DOCUMENTS',
      recursive: true
    };
    if (!isBase64) {
      writeOptions.encoding = 'utf8';
    }

    await Filesystem.writeFile(writeOptions);

    if (typeof showToast === 'function') showToast(`Tersimpan di Dokumen/KeuanganKu/${filename}`, 'success');
    return { success: true, method: 'documents', path: relativeDocPath };
  } catch (err) {
    console.warn(`Gagal menyimpan ke Documents/KeuanganKu/${filename} (${err.message}). Menjalankan fallback ke Cache & Share Sheet.`);

    try {
      if (!Share || typeof Share.share !== 'function') throw err;
      await pruneTemporaryExports(Filesystem);
      const cachePath = temporaryExportPath(SHARE_CACHE_DIR, filename);
      const cacheWriteOptions = {
        path: cachePath,
        data: fileData,
        directory: 'CACHE',
        recursive: true
      };
      if (!isBase64) {
        cacheWriteOptions.encoding = 'utf8';
      }

      await Filesystem.writeFile(cacheWriteOptions);

      const cacheResult = await Filesystem.getUri({
        path: cachePath,
        directory: 'CACHE'
      });

      if (typeof showToast === 'function') showToast('Penyimpanan publik dibatasi sistem. Membuka lembar berbagi berkas...', 'info');
      await Share.share({
        title: options.title || filename,
        text: options.text || '',
        dialogTitle: options.dialogTitle || 'Simpan / Bagikan Berkas',
        files: [cacheResult.uri]
      });
      return { success: true, method: 'cache-share', uri: cacheResult.uri };
    } catch (fallbackErr) {
      console.error('Fallback penyimpanan gagal:', fallbackErr);
      if (typeof showToast === 'function') showToast('Gagal menyimpan berkas: ' + fallbackErr.message, 'danger');
      return { success: false, error: fallbackErr };
    }
  }
}

/**
 * Helper terpusat untuk membagikan berkas via Share Sheet
 */
async function shareFile(filename, data, mime, options = {}) {
  const isBase64 = !!options.base64;
  let fileData = data;
  if (isBase64 && typeof data === 'string' && data.includes(',')) {
    fileData = data.split(',')[1];
  }

  // 1. Browser biasa
  if (!isNativePlatform()) {
    try {
      const blob = isBase64 ? base64ToBlob(data, mime) : new Blob([data], { type: mime });
      const file = new File([blob], filename, { type: mime });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: options.title || 'KeuanganKu',
          text: options.text || ''
        });
        if (typeof showToast === 'function') showToast('Berkas berhasil dibagikan!', 'success');
        return { success: true, method: 'web-share' };
      } else if (navigator.share && options.text) {
        await navigator.share({
          title: options.title || 'KeuanganKu',
          text: options.text
        });
        if (typeof showToast === 'function') showToast('Ringkasan teks berhasil dibagikan!', 'success');
        return { success: true, method: 'web-share-text' };
      } else {
        downloadBlobInBrowser(blob, filename);
        if (typeof showToast === 'function') showToast(`Fitur berbagi tidak didukung peramban. Berkas diunduh sebagai ${filename}`, 'info');
        return { success: true, method: 'browser-download' };
      }
    } catch (err) {
      if (err.name === 'AbortError') return { cancelled: true };
      console.error('Gagal membagikan di browser:', err);
      if (typeof showToast === 'function') showToast('Gagal membagikan berkas: ' + err.message, 'danger');
      return { success: false, error: err };
    }
  }

  // 2. Native Capacitor
  const Filesystem = getFilesystemPlugin();
  const Share = getSharePlugin();

  if (!Filesystem || !Share) {
    if (typeof showToast === 'function') showToast('Plugin penyimpanan / berbagi tidak tersedia', 'danger');
    return { success: false, error: 'Plugins unavailable' };
  }

  try {
    await pruneTemporaryExports(Filesystem);
    const cachePath = temporaryExportPath(SHARE_CACHE_DIR, filename);
    const writeOptions = {
      path: cachePath,
      data: fileData,
      directory: 'CACHE',
      recursive: true
    };
    if (!isBase64) {
      writeOptions.encoding = 'utf8';
    }

    await Filesystem.writeFile(writeOptions);

    const uriResult = await Filesystem.getUri({
      path: cachePath,
      directory: 'CACHE'
    });

    await Share.share({
      title: options.title || 'KeuanganKu',
      text: options.text || '',
      dialogTitle: options.dialogTitle || 'Bagikan',
      files: [uriResult.uri]
    });

    return { success: true, method: 'native-share', uri: uriResult.uri };
  } catch (err) {
    if (err && (err.message?.includes('canceled') || err.message?.includes('cancelled') || err.name === 'AbortError')) {
      return { cancelled: true };
    }
    console.error('Gagal membagikan berkas di platform native:', err);
    if (typeof showToast === 'function') showToast('Gagal membagikan: ' + err.message, 'danger');
    return { success: false, error: err };
  }
}

/**
 * Membuat dokumen PDF profesional dengan ringkasan metrik & tabel transaksi
 */
function generatePDFDocument() {
  const items = typeof getFilteredTransactions === 'function' ? getFilteredTransactions() : [];
  if (items.length === 0) {
    if (typeof showToast === 'function') showToast('Tidak ada transaksi untuk dicetak ke PDF', 'danger');
    return null;
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    if (typeof showToast === 'function') showToast('Pustaka pembuat PDF belum termuat di peramban', 'danger');
    return null;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  let incomeTotal = 0;
  let incomeCount = 0;
  let expenseTotal = 0;
  let expenseCount = 0;

  items.forEach(item => {
    const amt = Number(item.amount) || 0;
    if (item.type === 'income') {
      incomeTotal += amt;
      incomeCount++;
    } else {
      expenseTotal += amt;
      expenseCount++;
    }
  });

  const netBalance = incomeTotal - expenseTotal;
  const periodText = document.getElementById('periodLabel')?.textContent || 'Semua Riwayat Transaksi';
  const exportDate = new Date();
  const exportDateStr = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(exportDate);

  // --- 1. HEADER BANNER ---
  doc.setFillColor(30, 27, 75);
  doc.rect(0, 0, 210, 38, 'F');

  doc.setFillColor(99, 102, 241);
  doc.rect(0, 38, 210, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('KeuanganKu', 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(199, 210, 254);
  doc.text('Laporan Catatan Arus Kas, Pemasukan & Pengeluaran', 14, 23);
  doc.text(`Periode: ${periodText}`, 14, 29);

  doc.setFontSize(8);
  doc.setTextColor(224, 231, 255);
  doc.text(`Tanggal Cetak: ${exportDateStr}`, 196, 16, { align: 'right' });
  doc.text(`Total Catatan: ${items.length} Transaksi`, 196, 22, { align: 'right' });
  doc.text(`Status: ${netBalance >= 0 ? 'Surplus / Cashflow Positif' : 'Defisit Pengeluaran'}`, 196, 28, { align: 'right' });

  // --- 2. KPI SUMMARY BOXES ---
  const boxY = 46;
  const boxH = 22;
  const boxW = 57;

  // Box 1: Saldo Bersih
  if (netBalance >= 0) {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
  } else {
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(254, 202, 202);
  }
  doc.roundedRect(14, boxY, boxW, boxH, 2, 2, 'FD');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL SALDO BERSIH', 18, boxY + 7);
  doc.setFontSize(11.5);
  if (netBalance >= 0) {
    doc.setTextColor(5, 150, 105);
  } else {
    doc.setTextColor(220, 38, 38);
  }
  doc.text(formatRupiah(netBalance), 18, boxY + 16);

  // Box 2: Total Pemasukan
  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(187, 247, 208);
  doc.roundedRect(76, boxY, boxW, boxH, 2, 2, 'FD');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL PEMASUKAN', 80, boxY + 7);
  doc.setFontSize(11.5);
  doc.setTextColor(5, 150, 105);
  doc.text(formatRupiah(incomeTotal), 80, boxY + 15);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`${incomeCount} transaksi masuk`, 80, boxY + 19.5);

  // Box 3: Total Pengeluaran
  doc.setFillColor(254, 242, 242);
  doc.setDrawColor(254, 202, 202);
  doc.roundedRect(138, boxY, boxW, boxH, 2, 2, 'FD');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL PENGELUARAN', 142, boxY + 7);
  doc.setFontSize(11.5);
  doc.setTextColor(220, 38, 38);
  doc.text(formatRupiah(expenseTotal), 142, boxY + 15);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`${expenseCount} transaksi keluar`, 142, boxY + 19.5);

  // --- 3. TRANSACTIONS AUTOTABLE ---
  const tableData = items.map((item, idx) => {
    const cat = getCategoryInfo(item.type, item.category);
    const dateFormatted = formatDateIndo(item.date);
    const timeFormatted = item.time || '-';
    const isIncome = item.type === 'income';
    const prefix = isIncome ? '+ ' : '- ';
    const descWithNotes = item.notes ? `${item.title}\nCatatan: ${item.notes}` : item.title;

    return [
      idx + 1,
      `${dateFormatted}\n${timeFormatted}`,
      cat.name,
      descWithNotes,
      isIncome ? 'Pemasukan' : 'Pengeluaran',
      `${prefix}${formatRupiah(item.amount)}`
    ];
  });

  const autoTableConfig = {
    startY: 74,
    head: [['No', 'Tanggal & Waktu', 'Kategori', 'Keterangan', 'Tipe', 'Nominal (Rp)']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [79, 70, 229],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 3
    },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2.5,
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      overflow: 'linebreak'
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 32 },
      2: { cellWidth: 32 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 24, halign: 'center' },
      5: { cellWidth: 34, halign: 'right', fontStyle: 'bold' }
    },
    didParseCell: function(data) {
      if (data.section === 'head' && (data.column.index === 0 || data.column.index === 4)) {
        data.cell.styles.halign = 'center';
      }
      if (data.section === 'head' && data.column.index === 5) {
        data.cell.styles.halign = 'right';
      }
      if (data.section === 'body' && data.column.index === 5) {
        const typeCell = data.row.raw[4];
        if (typeCell === 'Pemasukan') {
          data.cell.styles.textColor = [5, 150, 105];
        } else {
          data.cell.styles.textColor = [220, 38, 38];
        }
      }
      if (data.section === 'body' && data.column.index === 4) {
        const typeCell = data.row.raw[4];
        if (typeCell === 'Pemasukan') {
          data.cell.styles.textColor = [5, 150, 105];
          data.cell.styles.fontStyle = 'bold';
        } else {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
    didDrawPage: function(data) {
      const totalPages = doc.internal.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);

      const footerY = doc.internal.pageSize.height - 8;
      doc.text(
        `KeuanganKu • Halaman ${data.pageNumber} dari ${totalPages}`,
        14,
        footerY
      );
      doc.text(
        `Laporan Resmi KeuanganKu • Arsip Mandiri`,
        doc.internal.pageSize.width - 14,
        footerY,
        { align: 'right' }
      );
    },
    margin: { top: 16, left: 14, right: 14, bottom: 14 }
  };

  if (typeof doc.autoTable === 'function') {
    doc.autoTable(autoTableConfig);
  } else if (window.jspdfAutoTable && typeof window.jspdfAutoTable.default === 'function') {
    window.jspdfAutoTable.default(doc, autoTableConfig);
  } else if (window.jspdfAutoTable && typeof window.jspdfAutoTable.applyPlugin === 'function') {
    window.jspdfAutoTable.applyPlugin(jsPDF);
    doc.autoTable(autoTableConfig);
  } else {
    console.error('Plugin autoTable tidak ditemukan.');
    if (typeof showToast === 'function') showToast('Gagal memuat plugin tabel PDF', 'danger');
    return null;
  }

  return doc;
}

/**
 * Unduh Laporan PDF ke Dokumen/KeuanganKu/ (atau peramban)
 */
async function exportToPDF() {
  try {
    const doc = generatePDFDocument();
    if (!doc) return;

    if (typeof showToast === 'function') showToast('Menyiapkan dokumen PDF...', 'info');
    const filename = `KeuanganKu_Laporan_${formatDateISO(new Date())}.pdf`;

    const dataUri = doc.output('datauristring');
    const base64Data = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;

    await saveFile(filename, base64Data, 'application/pdf', {
      base64: true,
      title: 'Laporan Keuangan KeuanganKu',
      dialogTitle: 'Simpan / Bagikan Laporan PDF'
    });

    if (typeof closeExportModal === 'function') closeExportModal();
  } catch (err) {
    console.error('Gagal membuat PDF:', err);
    if (typeof showToast === 'function') showToast('Gagal membuat PDF: ' + err.message, 'danger');
  }
}

/**
 * Bagikan Laporan PDF ke aplikasi lain (WhatsApp, Drive, dll)
 */
async function sharePDFReport() {
  const items = typeof getFilteredTransactions === 'function' ? getFilteredTransactions() : [];
  if (items.length === 0) {
    if (typeof showToast === 'function') showToast('Tidak ada data transaksi untuk dibagikan', 'danger');
    return;
  }

  try {
    if (typeof showToast === 'function') showToast('Menyiapkan berkas PDF...', 'info');
    const doc = generatePDFDocument();
    if (!doc) return;

    const filename = `KeuanganKu_Laporan_${formatDateISO(new Date())}.pdf`;
    const dataUri = doc.output('datauristring');
    const base64Data = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;

    await shareFile(filename, base64Data, 'application/pdf', {
      base64: true,
      title: 'Laporan Keuangan KeuanganKu',
      text: `Berikut adalah laporan keuangan KeuanganKu (${items.length} transaksi).`,
      dialogTitle: 'Bagikan'
    });

    if (typeof closeExportModal === 'function') closeExportModal();
  } catch (err) {
    console.error('Gagal membagikan PDF:', err);
    if (typeof showToast === 'function') showToast('Gagal membagikan PDF: ' + err.message, 'danger');
  }
}

/**
 * Buat string ringkasan teks untuk dibagikan
 * @returns {string}
 */
function generateTextSummary() {
  const items = typeof getFilteredTransactions === 'function' ? getFilteredTransactions() : [];
  let incomeTotal = 0;
  let expenseTotal = 0;
  items.forEach(i => {
    if (i.type === 'income') incomeTotal += (Number(i.amount) || 0);
    if (i.type === 'expense') expenseTotal += (Number(i.amount) || 0);
  });
  const net = incomeTotal - expenseTotal;
  const savingsRate = incomeTotal > 0 ? Math.round((net / incomeTotal) * 100) : 0;
  const periodLabel = document.getElementById('periodLabel')?.textContent || 'Periode Berjalan';

  let text = `📊 *RINGKASAN LAPORAN KEUANGANKU*\n`;
  text += `📅 *Periode:* ${periodLabel}\n`;
  text += `🕒 *Dibuat:* ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date())}\n\n`;
  text += `💰 *Total Saldo Bersih:* ${formatRupiah(net)} (${net >= 0 ? 'Surplus / Positif' : 'Defisit / Negatif'})\n`;
  text += `🟢 *Total Pemasukan:* ${formatRupiah(incomeTotal)}\n`;
  text += `🔴 *Total Pengeluaran:* ${formatRupiah(expenseTotal)}\n`;
  text += `📈 *Rasio Tabungan:* ${savingsRate}%\n\n`;
  text += `📝 *Catatan Transaksi Terakhir (${Math.min(10, items.length)} dari ${items.length}):*\n`;

  items.slice(0, 10).forEach((item, idx) => {
    const sign = item.type === 'income' ? '🟢 +' : '🔴 -';
    text += `${idx + 1}. ${formatDateIndo(item.date)} | ${item.title} (${sign}${formatRupiah(item.amount)})\n`;
  });

  if (items.length > 10) {
    text += `... dan ${items.length - 10} transaksi lainnya.\n`;
  }
  text += `\n_Dicatat & dikelola mandiri via Aplikasi KeuanganKu_\n`;
  return text;
}

/**
 * Bagikan Ringkasan Teks ke WhatsApp atau aplikasi chat lainnya
 */
async function shareTextSummary() {
  const items = typeof getFilteredTransactions === 'function' ? getFilteredTransactions() : [];
  if (items.length === 0) {
    if (typeof showToast === 'function') showToast('Tidak ada data transaksi untuk dibagikan', 'danger');
    return;
  }

  try {
    const summaryText = generateTextSummary();
    const filename = `KeuanganKu_Ringkasan_${formatDateISO(new Date())}.txt`;

    await shareFile(filename, summaryText, 'text/plain;charset=utf-8', {
      base64: false,
      title: 'Ringkasan KeuanganKu',
      text: summaryText,
      dialogTitle: 'Bagikan'
    });

    if (typeof closeExportModal === 'function') closeExportModal();
  } catch (err) {
    console.error('Gagal membagikan ringkasan teks:', err);
    if (typeof showToast === 'function') showToast('Gagal membagikan ringkasan: ' + err.message, 'danger');
  }
}

/**
 * Sanitasi nilai sel untuk mencegah CSV / Spreadsheet Formula Injection
 * @param {*} val
 * @returns {string}
 */
function sanitizeCSVCell(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val).replace(/"/g, '""');
  // Cegah eksekusi formula di Excel / Google Sheets jika diawali =, +, -, @, tab, carriage return
  const isFormula = /^[=+\-@\t\r]/.test(str);
  if (isFormula) {
    str = "'" + str;
  }
  return `"${str}"`;
}

/**
 * Format CSV: simpan lewat helper (utf8, tambahkan BOM \uFEFF agar terbuka benar di Excel)
 */
async function exportToCSV() {
  const txs = (typeof state !== 'undefined' && Array.isArray(state.transactions)) ? state.transactions : [];
  if (txs.length === 0) {
    if (typeof showToast === 'function') showToast('Tidak ada data untuk diekspor', 'danger');
    return;
  }

  try {
    const headers = ['ID', 'Tanggal', 'Waktu', 'Tipe', 'Kategori', 'Keterangan', 'Nominal (Rp)', 'Catatan'];
    const rows = txs.map(item => {
      const cat = getCategoryInfo(item.type, item.category);
      return [
        sanitizeCSVCell(item.id),
        sanitizeCSVCell(item.date),
        sanitizeCSVCell(item.time || ''),
        sanitizeCSVCell(item.type === 'income' ? 'Pemasukan' : 'Pengeluaran'),
        sanitizeCSVCell(cat.name),
        sanitizeCSVCell(item.title),
        Number.isFinite(Number(item.amount)) ? Number(item.amount) : 0,
        sanitizeCSVCell(item.notes)
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const filename = `KeuanganKu_${formatDateISO(new Date())}.csv`;

    await saveFile(filename, csvContent, 'text/csv;charset=utf-8;', {
      base64: false,
      title: 'Data Transaksi KeuanganKu',
      dialogTitle: 'Simpan / Bagikan Berkas CSV'
    });

    if (typeof closeExportModal === 'function') closeExportModal();
  } catch (err) {
    console.error('Gagal mengekspor CSV:', err);
    if (typeof showToast === 'function') showToast('Gagal mengekspor CSV: ' + err.message, 'danger');
  }
}

const BACKUP_MAX_BYTES = 10 * 1024 * 1024;
const BACKUP_MAX_FILE_BYTES = 14 * 1024 * 1024;
const BACKUP_MAX_TRANSACTIONS = 50000;
const BACKUP_PBKDF2_ITERATIONS = 600000;

function encodeBackupBytes(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function decodeBackupBytes(value) {
  if (typeof value !== 'string') throw new Error('Format cadangan terenkripsi tidak valid.');
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function deriveBackupKey(password, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('Enkripsi membutuhkan konteks yang aman.');
  const input = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: BACKUP_PBKDF2_ITERATIONS },
    input, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptBackup(plaintext, password) {
  if (!password || password.length < 12 || password.length > 256) {
    throw new Error('Kata sandi cadangan harus berisi 12 sampai 256 karakter.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return JSON.stringify({
    format: 'KeuanganKu-encrypted',
    version: 1,
    salt: encodeBackupBytes(salt),
    iv: encodeBackupBytes(iv),
    data: encodeBackupBytes(new Uint8Array(data))
  });
}

async function decryptBackup(envelope, password) {
  if (envelope.version !== 1) throw new Error('Versi cadangan terenkripsi tidak didukung.');
  if (!password || password.length > 256) throw new Error('Kata sandi cadangan tidak valid.');
  try {
    const salt = decodeBackupBytes(envelope.salt);
    const iv = decodeBackupBytes(envelope.iv);
    const data = decodeBackupBytes(envelope.data);
    if (salt.length !== 16 || iv.length !== 12 || data.length <= 16 || data.length > BACKUP_MAX_BYTES + 16) {
      throw new Error('Ukuran cadangan terenkripsi tidak valid.');
    }
    const key = await deriveBackupKey(password, salt);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw new Error('Kata sandi salah atau cadangan terenkripsi rusak.');
  }
}

function chooseBackupPassword(forExport) {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', forExport ? 'Lindungi cadangan' : 'Buka cadangan terenkripsi');
  dialog.innerHTML = `
    <form method="dialog">
      <p>${forExport ? 'Lindungi cadangan dengan kata sandi. Simpan kata sandi untuk pemulihan.' : 'Masukkan kata sandi cadangan.'}</p>
      <label>Kata sandi <input type="password" name="password" required maxlength="256"
        ${forExport ? 'minlength="12" autocomplete="new-password"' : 'autocomplete="current-password"'}></label>
      ${forExport ? '<label>Ulangi kata sandi <input type="password" name="repeat" required maxlength="256" autocomplete="new-password"></label>' : ''}
      <button type="submit" value="encrypted">${forExport ? 'Enkripsi' : 'Buka'}</button>
      ${forExport ? '<button type="submit" formnovalidate value="plaintext">Simpan tanpa enkripsi</button>' : ''}
      <button type="submit" formnovalidate value="cancel">Batal</button>
    </form>`;
  const form = dialog.querySelector('form');
  const password = form.elements.namedItem('password');
  const repeat = form.elements.namedItem('repeat');
  repeat?.addEventListener('input', () => repeat.setCustomValidity(''));
  password.addEventListener('input', () => repeat?.setCustomValidity(''));
  form.addEventListener('submit', event => {
    if (event.submitter?.value === 'encrypted' && repeat && repeat.value !== password.value) {
      event.preventDefault();
      repeat.setCustomValidity('Kata sandi tidak sama.');
      repeat.reportValidity();
    }
  });
  document.body.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'encrypted' ? password.value
        : dialog.returnValue === 'plaintext' ? '' : null;
      dialog.remove();
      resolve(result);
    }, { once: true });
    dialog.showModal();
  });
}

async function prepareBackupExport(snapshot) {
  if (snapshot.transactions.length > BACKUP_MAX_TRANSACTIONS) {
    throw new Error('Data melebihi batas 50.000 transaksi.');
  }
  const json = getBackupJSONPayload(snapshot);
  const plaintext = new TextEncoder().encode(json);
  if (plaintext.length > BACKUP_MAX_BYTES) {
    throw new Error('Data melebihi batas ukuran cadangan.');
  }
  const password = await chooseBackupPassword(true);
  if (password === null) return null;
  const data = password ? await encryptBackup(plaintext, password) : json;
  const suffix = password ? '_Terenkripsi' : '';
  return { data, filename: `KeuanganKu_Backup_${formatDateISO(new Date())}${suffix}.json` };
}

/**
 * Payload JSON data transaksi aplikasi
 * @returns {string}
 */
function getBackupJSONPayload({ transactions, budgets }) {
  return JSON.stringify({
    app: 'KeuanganKu',
    schemaVersion: 2,
    exportDate: new Date().toISOString(),
    totalTransactions: transactions.length,
    transactions,
    budgets
  }, null, 2);
}

/**
 * Cadangkan Data (.json): simpan lewat helper dan catat timestamp backup
 */
async function exportToJSON() {
  const { transactions, budgets } = state;
  if (transactions.length === 0 && Object.keys(budgets).length === 0) {
    if (typeof showToast === 'function') showToast('Tidak ada transaksi atau anggaran untuk dicadangkan', 'danger');
    return;
  }

  try {
    const backup = await prepareBackupExport({ transactions, budgets });
    if (!backup) return;

    const res = await saveFile(backup.filename, backup.data, 'application/json;charset=utf-8', {
      base64: false,
      title: 'Cadangan Data KeuanganKu',
      dialogTitle: 'Simpan Cadangan JSON'
    });

    if (res && res.success) {
      setLastBackupTimestamp(Date.now());
      if (typeof checkBackupReminder === 'function') checkBackupReminder();
    }

    if (typeof closeExportModal === 'function') closeExportModal();
  } catch (err) {
    console.error('Gagal mencadangkan data JSON:', err);
    if (typeof showToast === 'function') showToast('Gagal mencadangkan data: ' + err.message, 'danger');
  }
}

/**
 * Simpan ke Google Drive / bagikan cadangan data (.json)
 */
async function shareJSONBackup() {
  const { transactions, budgets } = state;
  if (transactions.length === 0 && Object.keys(budgets).length === 0) {
    if (typeof showToast === 'function') showToast('Tidak ada transaksi atau anggaran untuk dicadangkan', 'danger');
    return;
  }

  try {
    const backup = await prepareBackupExport({ transactions, budgets });
    if (!backup) return;

    const res = await shareFile(backup.filename, backup.data, 'application/json;charset=utf-8', {
      base64: false,
      title: 'Cadangan Data KeuanganKu',
      text: `Berkas cadangan KeuanganKu (${transactions.length} transaksi dan batas anggaran).`,
      dialogTitle: 'Simpan ke Google Drive / Bagikan'
    });

    if (res && !res.cancelled && res.success !== false) {
      setLastBackupTimestamp(Date.now());
      if (typeof checkBackupReminder === 'function') checkBackupReminder();
    }

    if (typeof closeExportModal === 'function') closeExportModal();
  } catch (err) {
    console.error('Gagal membagikan cadangan JSON:', err);
    if (typeof showToast === 'function') showToast('Gagal membagikan cadangan: ' + err.message, 'danger');
  }
}

/**
 * Pemicu dialog pemilihan berkas JSON untuk pemulihan data
 */
function importFromJSON() {
  const input = document.getElementById('importJsonInput');
  if (input) {
    input.value = '';
    input.click();
  }
}

/**
 * Membaca dan memulihkan transaksi dari berkas cadangan JSON dengan validasi schema ketat
 * dan pencegahan tabrakan ID secara aman
 */
function readBackupBudgets(backup) {
  if (!Object.hasOwn(backup, 'budgets')) return undefined;
  const budgets = backup.budgets;
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) {
    throw new Error('Format anggaran dalam cadangan tidak valid.');
  }
  const categories = new Set(CATEGORIES.expense.map(category => category.id));
  for (const [category, amount] of Object.entries(budgets)) {
    if (!categories.has(category) || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error('Kategori atau nominal anggaran dalam cadangan tidak valid.');
    }
  }
  return budgets;
}

function handleImportJsonFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > BACKUP_MAX_FILE_BYTES) {
    showToast('Berkas cadangan melebihi batas 14 MiB.', 'danger');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch (parseErr) {
        throw new Error('Berkas bukan format JSON yang valid.');
      }

      if (parsed?.format === 'KeuanganKu-encrypted') {
        const password = await chooseBackupPassword(false);
        if (password === null) return;
        parsed = await decryptBackup(parsed, password);
      } else if (file.size > BACKUP_MAX_BYTES) {
        throw new Error('Cadangan tanpa enkripsi melebihi batas 10 MiB.');
      }
      const rawTransactions = Array.isArray(parsed) ? parsed : parsed?.transactions;
      if (rawTransactions?.length > BACKUP_MAX_TRANSACTIONS) {
        throw new Error('Cadangan melebihi batas 50.000 transaksi.');
      }
      const validation = validateTransactionsImport(parsed);
      if (!validation.valid) throw new Error(validation.error);
      const backupBudgets = readBackupBudgets(parsed);
      const unique = mergeTransactionsSafely([], validation.items);
      if (unique.conflicts > 0) {
        throw new Error('Berkas berisi transaksi berbeda dengan ID yang sama.');
      }
      const incoming = unique.items;
      const { transactions, budgets, revision } = state;
      const hasBudgetBackup = backupBudgets !== undefined;
      if (!incoming.length && !hasBudgetBackup) throw new Error('Cadangan tidak berisi data.');

      const changes = {};
      let count = incoming.length;
      let overwrite = false;
      const skipped = validation.skipped ? ` (${validation.skipped} transaksi tidak valid dilewati)` : '';

      if (incoming.length && transactions.length) {
        const merge = confirm(
          `Gabungkan ${incoming.length} transaksi cadangan?${skipped}\n\n` +
          'Klik Batal untuk melihat opsi penggantian.'
        );
        if (merge) {
          const merged = mergeTransactionsSafely(transactions, incoming);
          const replace = merged.conflicts > 0 && confirm(
            `${merged.conflicts} transaksi memiliki ID yang sama dengan isi berbeda.\n\n` +
            'Klik OK untuk memakai versi cadangan, atau Batal untuk mempertahankan versi lokal.'
          );
          changes.transactions = replace ? mergeTransactionsSafely(transactions, incoming, true).items : merged.items;
          count = changes.transactions.length - transactions.length + (replace ? merged.conflicts : 0);
        } else {
          overwrite = confirm(
            `Ganti semua transaksi lokal dengan ${incoming.length} transaksi cadangan?${skipped}` +
            (hasBudgetBackup ? '\nBatas anggaran lokal juga akan diganti.' : '')
          );
          if (!overwrite) return;
        }
      }
      if (incoming.length && (!transactions.length || overwrite)) changes.transactions = incoming;
      if (hasBudgetBackup) {
        const next = overwrite ? backupBudgets : { ...budgets, ...backupBudgets };
        const conflicts = !overwrite && Object.keys(backupBudgets).some(key =>
          Object.hasOwn(budgets, key) && budgets[key] !== backupBudgets[key]);
        changes.budgets = conflicts && !confirm(
          'Cadangan berisi batas anggaran yang berbeda. Klik OK untuk memakai batas cadangan, atau Batal untuk mempertahankan batas lokal.'
        ) ? { ...backupBudgets, ...budgets } : next;
      }

      const budgetsChanged = hasBudgetBackup && (
        Object.keys(changes.budgets).length !== Object.keys(budgets).length ||
        Object.keys(changes.budgets).some(key => changes.budgets[key] !== budgets[key])
      );
      if (!count) delete changes.transactions;
      if (!budgetsChanged) delete changes.budgets;
      if (count || budgetsChanged) await saveLedger(changes, revision);

      refreshUI();
      closeExportModal();
      showToast(count || budgetsChanged
        ? `Pemulihan selesai. ${count} transaksi dipulihkan${budgetsChanged ? ' dan anggaran diperbarui' : ''}.${skipped}`
        : 'Tidak ada perubahan dari cadangan ini.', count || budgetsChanged ? 'success' : 'info');
    } catch (err) {
      console.error('Gagal mengimpor JSON:', err);
      if (typeof showToast === 'function') showToast('Gagal memulihkan data: ' + err.message, 'danger');
    } finally {
      event.target.value = '';
    }
  };
  reader.onerror = function() {
    if (typeof showToast === 'function') showToast('Gagal membaca berkas cadangan', 'danger');
    event.target.value = '';
  };
  reader.readAsText(file);
}

/**
 * Cetak Dokumen Laporan:
 * - Pada native Android: hasilkan PDF ke Directory.Cache, ambil path filenya,
 *   lalu panggil Capacitor.Plugins.PdfPrint.print({ path }).
 * - Jika bukan native: fallback window.print().
 */
async function printReport() {
  if (typeof closeExportModal === 'function') closeExportModal();

  // 1. Fallback untuk browser biasa (non-native)
  if (!isNativePlatform()) {
    setTimeout(() => {
      window.print();
    }, 200);
    return;
  }

  // 2. Native Android via Plugin PdfPrint
  try {
    const PdfPrint = getPdfPrintPlugin();
    const Filesystem = getFilesystemPlugin();

    if (!PdfPrint || typeof PdfPrint.print !== 'function') {
      console.warn('Plugin PdfPrint tidak ditemukan pada window.Capacitor.Plugins. Menjalankan fallback window.print()');
      window.print();
      return;
    }

    if (!Filesystem) {
      console.warn('Plugin Filesystem tidak tersedia untuk menyiapkan PDF cetak');
      window.print();
      return;
    }

    if (typeof showToast === 'function') showToast('Menyiapkan dokumen cetak...', 'info');
    const doc = generatePDFDocument();
    if (!doc) return;

    await pruneTemporaryExports(Filesystem);
    const cachePath = temporaryExportPath(PRINT_CACHE_DIR, 'KeuanganKu_Cetak.pdf');
    const dataUri = doc.output('datauristring');
    const base64Data = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;

    await Filesystem.writeFile({
      path: cachePath,
      data: base64Data,
      directory: 'CACHE',
      recursive: true
    });

    await PdfPrint.print({ filename: cachePath.split('/').pop() });
  } catch (err) {
    console.error('Gagal mencetak laporan via PdfPrint:', err);
    if (typeof showToast === 'function') showToast('Gagal memproses cetak: ' + err.message, 'danger');
  }
}


// Ekspor untuk pengujian Node.js jika CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeCSVCell,
    getBackupJSONPayload,
    readBackupBudgets,
    encryptBackup,
    decryptBackup
  };
}

