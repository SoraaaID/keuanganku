/**
 * KeuanganKu - Unit Tests (Node.js Built-in assert)
 * Menguji formatter, validasi kalender, proteksi XSS, dan validasi schema import JSON
 */

const assert = require('node:assert');
const {
  formatRupiah,
  parseFormattedNumber,
  formatDateIndo,
  formatDateISO,
  formatMonthISO,
  isValidISODate,
  escapeHtml
} = require('../js/format.js');

const {
  CATEGORIES,
  validateTransactionsImport,
  mergeTransactionsSafely,
  generateSampleData
} = require('../js/data.js');

const { sanitizeCSVCell } = require('../js/export.js');

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('\n--- Menjalankan Pengujian Unit KeuanganKu ---\n');

// =============================================================================
// 1. Pengujian Formatter & Parsers
// =============================================================================
console.log('1. Pengujian Formatter (format.js):');

test('formatRupiah memformat nominal angka bulat ke mata uang IDR', () => {
  const result = formatRupiah(1500000);
  assert.ok(result.includes('1.500.000'), `Expected formatted Rupiah containing 1.500.000, got ${result}`);
});

test('formatRupiah menangani 0, negatif, dan fallback nilai non-angka', () => {
  assert.ok(formatRupiah(0).includes('0'));
  assert.ok(formatRupiah(-50000).includes('50.000'));
  assert.ok(formatRupiah(NaN).includes('0'));
  assert.ok(formatRupiah(null).includes('0'));
});

test('parseFormattedNumber mengekstrak angka murni dari string berformat', () => {
  assert.strictEqual(parseFormattedNumber('Rp 2.500.000'), 2500000);
  assert.strictEqual(parseFormattedNumber('100.000'), 100000);
  assert.strictEqual(parseFormattedNumber(''), 0);
  assert.strictEqual(parseFormattedNumber(null), 0);
  assert.strictEqual(parseFormattedNumber(50000), 50000);
});

test('formatDateISO menghasilkan format YYYY-MM-DD dari objek Date', () => {
  const d = new Date(2026, 8, 25); // Bulan ke-9 (September)
  assert.strictEqual(formatDateISO(d), '2026-09-25');
});

test('formatMonthISO menghasilkan format YYYY-MM dari objek Date', () => {
  const d = new Date(2026, 8, 25);
  assert.strictEqual(formatMonthISO(d), '2026-09');
});

// =============================================================================
// 2. Pengujian Validasi Kalender Riil (isValidISODate)
// =============================================================================
console.log('\n2. Pengujian Validasi Kalender (isValidISODate):');

test('isValidISODate menerima tanggal ISO yang sah', () => {
  assert.strictEqual(isValidISODate('2026-09-25'), true);
  assert.strictEqual(isValidISODate('2024-02-29'), true); // Tahun kabisat 2024
  assert.strictEqual(isValidISODate('2025-12-31'), true);
});

test('isValidISODate menolak tanggal tidak valid riil pada kalender', () => {
  assert.strictEqual(isValidISODate('2025-02-29'), false); // 2025 bukan tahun kabisat
  assert.strictEqual(isValidISODate('2026-04-31'), false); // April hanya 30 hari
  assert.strictEqual(isValidISODate('2026-02-30'), false);
  assert.strictEqual(isValidISODate('2026-13-01'), false); // Bulan 13 tidak ada
  assert.strictEqual(isValidISODate('2026-00-10'), false);
  assert.strictEqual(isValidISODate('2026-05-00'), false);
  assert.strictEqual(isValidISODate('2026-05-32'), false);
});

test('isValidISODate menolak format teks bukan YYYY-MM-DD', () => {
  assert.strictEqual(isValidISODate('25-09-2026'), false);
  assert.strictEqual(isValidISODate('2026/09/25'), false);
  assert.strictEqual(isValidISODate('2026-9-25'), false);
  assert.strictEqual(isValidISODate(''), false);
  assert.strictEqual(isValidISODate(null), false);
  assert.strictEqual(isValidISODate(undefined), false);
  assert.strictEqual(isValidISODate(12345), false);
});

// =============================================================================
// 3. Pengujian Sanitasi XSS (escapeHtml)
// =============================================================================
console.log('\n3. Pengujian Sanitasi XSS (escapeHtml):');

test('escapeHtml mengamankan karakter berbahaya XSS', () => {
  const malicious = '<script>alert("XSS")</script>';
  const clean = escapeHtml(malicious);
  assert.strictEqual(clean, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
});

test('escapeHtml mengonversi tanda kutip satu, ampersand, dan simbol tag', () => {
  const str = `Beli kopi 'Starbucks' & teh > air < es`;
  const clean = escapeHtml(str);
  assert.strictEqual(clean, 'Beli kopi &#039;Starbucks&#039; &amp; teh &gt; air &lt; es');
});

test('escapeHtml aman saat menerima null, undefined, atau angka', () => {
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(12345), '12345');
});

// =============================================================================
// 4. Pengujian Validasi Schema Impor JSON (validateTransactionsImport)
// =============================================================================
console.log('\n4. Pengujian Validasi Impor JSON (validateTransactionsImport):');

test('validateTransactionsImport menerima dataset valid dan mengembalikan items bersih', () => {
  const validData = [
    {
      id: 'tx-101',
      type: 'expense',
      title: 'Makan Siang',
      amount: 45000,
      category: 'food',
      date: '2026-09-25',
      time: '12:30',
      notes: 'Nasi padang'
    },
    {
      id: 'tx-102',
      type: 'income',
      title: 'Gaji Pokok',
      amount: 10000000,
      category: 'salary',
      date: '2026-09-01'
    }
  ];

  const res = validateTransactionsImport(validData);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.items.length, 2);
  assert.strictEqual(res.skipped, 0);
  assert.strictEqual(res.items[0].title, 'Makan Siang');
  assert.strictEqual(res.items[1].time, '12:00'); // Default time jika tidak ada
});

test('validateTransactionsImport menolak berkas jika bukan format array', () => {
  const res1 = validateTransactionsImport('bukan json array');
  assert.strictEqual(res1.valid, false);

  const res2 = validateTransactionsImport({ foo: 'bar' });
  assert.strictEqual(res2.valid, false);

  const res3 = validateTransactionsImport(null);
  assert.strictEqual(res3.valid, false);
});

test('validateTransactionsImport menolak/melewati item dengan tanggal kalender invalid', () => {
  const invalidDateData = [
    {
      id: 'tx-201',
      type: 'expense',
      title: 'Bensin',
      amount: 50000,
      category: 'transport',
      date: '2025-02-29' // 2025 bukan tahun kabisat
    }
  ];

  const res = validateTransactionsImport(invalidDateData);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.skipped, 1);
});

test('validateTransactionsImport menolak/melewati item dengan nominal negatif atau bukan angka', () => {
  const invalidAmountData = [
    {
      id: 'tx-301',
      type: 'expense',
      title: 'Belanja',
      amount: -10000,
      category: 'shopping',
      date: '2026-09-25'
    },
    {
      id: 'tx-302',
      type: 'expense',
      title: 'Belanja 2',
      amount: 'bukan_angka',
      category: 'shopping',
      date: '2026-09-25'
    }
  ];

  const res = validateTransactionsImport(invalidAmountData);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.skipped, 2);
});

test('validateTransactionsImport menolak item dengan tipe transaksi salah', () => {
  const invalidTypeData = [
    {
      id: 'tx-401',
      type: 'transfer', // Hanya 'income' atau 'expense' yang sah
      title: 'Transfer Saldo',
      amount: 50000,
      category: 'food',
      date: '2026-09-25'
    }
  ];

  const res = validateTransactionsImport(invalidTypeData);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.skipped, 1);
});

test('validateTransactionsImport menolak item dengan title kosong', () => {
  const emptyTitleData = [
    {
      id: 'tx-501',
      type: 'income',
      title: '   ',
      amount: 50000,
      category: 'salary',
      date: '2026-09-25'
    }
  ];

  const res = validateTransactionsImport(emptyTitleData);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.skipped, 1);
});

test('validateTransactionsImport menolak item dengan ID berbahaya / XSS payload', () => {
  const maliciousIdData = [
    {
      id: "');alert(1);//",
      type: 'income',
      title: 'Bonus',
      amount: 50000,
      category: 'salary',
      date: '2026-09-25'
    },
    {
      id: '<script>alert(1)</script>',
      type: 'income',
      title: 'Bonus 2',
      amount: 50000,
      category: 'salary',
      date: '2026-09-25'
    }
  ];

  const res = validateTransactionsImport(maliciousIdData);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.skipped, 2);
});

test('validateTransactionsImport mengarahkan kategori tidak dikenal ke fallback kategori', () => {
  const foreignCatData = [
    {
      id: 'tx-601',
      type: 'expense',
      title: 'Pengeluaran Acak',
      amount: 75000,
      category: 'kategori_asing_yang_tidak_ada',
      date: '2026-09-25'
    },
    {
      id: 'tx-602',
      type: 'income',
      title: 'Pemasukan Acak',
      amount: 150000,
      category: 'kategori_income_asing',
      date: '2026-09-25'
    }
  ];

  const res = validateTransactionsImport(foreignCatData);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.items[0].category, 'other_expense');
  assert.strictEqual(res.items[1].category, 'other_income');
});

// =============================================================================
// 5. Pengujian Keamanan Penggabungan Data (mergeTransactionsSafely)
// =============================================================================
console.log('\n5. Pengujian Penggabungan Data Aman (mergeTransactionsSafely):');

test('impor ulang transaksi identik tidak menambah data', () => {
  const item = { id: 'one', title: 'Belanja', amount: 50000 };
  assert.deepStrictEqual(mergeTransactionsSafely([item], [{ ...item }]), {
    items: [item], conflicts: 0
  });
});

test('konflik impor mempertahankan transaksi lokal sampai penggantian dipilih', () => {
  const local = { id: 'one', title: 'Belanja', amount: 50000 };
  const backup = { ...local, amount: 20000 };
  const extra = { id: 'two', amount: 10000 };
  assert.deepStrictEqual(mergeTransactionsSafely([local], [backup, extra]), {
    items: [local, extra], conflicts: 1
  });
  assert.deepStrictEqual(mergeTransactionsSafely([local], [backup, extra], true), {
    items: [backup, extra], conflicts: 1
  });
});

test('nominal rupiah menerima pemisah ribuan dan menolak format ambigu', () => {
  assert.strictEqual(parseFormattedNumber('10.000'), 10000);
  assert.ok(Number.isNaN(parseFormattedNumber('-5000')));
  assert.ok(Number.isNaN(parseFormattedNumber('10,5')));
  assert.ok(Number.isNaN(parseFormattedNumber('9007199254740992')));
  assert.ok(Number.isNaN(parseFormattedNumber(1.25)));
  const item = { id: 'one', type: 'expense', title: 'Tes', date: '2026-11-20', amount: '10.000' };
  assert.strictEqual(validateTransactionsImport([item]).items[0].amount, 10000);
  assert.strictEqual(validateTransactionsImport([{ ...item, amount: '1000abc' }]).valid, false);
});

test('cadangan anggaran saja dan cadangan transaksi lama dapat dibaca', () => {
  const { getBackupJSONPayload, readBackupBudgets } = require('../js/export.js');
  global.CATEGORIES = CATEGORIES;
  try {
    const budgets = { [CATEGORIES.expense[0].id]: 10000 };
    const payload = JSON.parse(getBackupJSONPayload({ transactions: [], budgets }));
    assert.deepStrictEqual(readBackupBudgets(payload), budgets);
    assert.equal(validateTransactionsImport(payload).valid, true);
    assert.equal(readBackupBudgets({ transactions: [] }), undefined);
    assert.throws(() => readBackupBudgets({ budgets: { unknown: 100 } }), /tidak valid/);
  } finally {
    delete global.CATEGORIES;
  }
});

test('membatalkan penggantian data contoh mempertahankan transaksi', () => {
  const { loadSampleData } = require('../js/data.js');
  const prior = [{ id: 'one' }];
  const answers = [true, false, false];
  global.state = { transactions: prior };
  global.confirm = () => answers.shift();
  try {
    loadSampleData();
    assert.strictEqual(answers.length, 0);
    assert.strictEqual(global.state.transactions, prior);
  } finally {
    delete global.state;
    delete global.confirm;
  }
});

// =============================================================================
// 6. Pengujian Sample Data Relatif
// =============================================================================
console.log('\n6. Pengujian Sample Data Dinamis:');

test('generateSampleData membuat transaksi dengan tahun dan bulan aktif', () => {
  const testDate = new Date(2026, 8, 25); // September 2026
  const sample = generateSampleData(testDate);
  assert.ok(sample.length > 5);

  const curMonthItems = sample.filter(s => s.date.startsWith('2026-09'));
  assert.ok(curMonthItems.length > 0, 'Harus ada data sample di bulan berjalan September 2026');

  // Pastikan semua tanggal valid kalender
  sample.forEach(item => {
    assert.strictEqual(isValidISODate(item.date), true, `Tanggal sample ${item.date} harus valid`);
  });
});

// =============================================================================
// 7. Pengujian Pencegahan CSV Formula Injection (sanitizeCSVCell)
// =============================================================================
console.log('\n7. Pengujian Pencegahan CSV Injection (sanitizeCSVCell):');

test('sanitizeCSVCell memberi prefix petik tunggal pada formula berbahaya', () => {
  assert.strictEqual(sanitizeCSVCell('=1+1'), `"\'=1+1"`);
  assert.strictEqual(sanitizeCSVCell('@SUM(A1:A10)'), `"\'@SUM(A1:A10)"`);
  assert.strictEqual(sanitizeCSVCell('+cmd|"/C calc"!A0'), `"\'\+cmd|""/C calc""!A0"`);
  assert.strictEqual(sanitizeCSVCell('-2000'), `"\'\-2000"`);
});

test('sanitizeCSVCell membiarkan teks normal dan mengamankan tanda kutip dua', () => {
  assert.strictEqual(sanitizeCSVCell('Makan Siang'), `"Makan Siang"`);
  assert.strictEqual(sanitizeCSVCell('Beli "Kopi"'), `"Beli ""Kopi"""`);
  assert.strictEqual(sanitizeCSVCell(null), '""');
  assert.strictEqual(sanitizeCSVCell(undefined), '""');
});

console.log(`\n========================================`);
console.log(`Pengujian Selesai: ${passedTests}/${totalTests} pengujian BERHASIL.`);
console.log(`========================================\n`);

async function testBackupEncryption() {
  const { encryptBackup, decryptBackup } = require('../js/export.js');
  const password = 'kata sandi cadangan panjang';
  const backup = { transactions: [], budgets: { food: 15000 } };
  const bytes = new TextEncoder().encode(JSON.stringify(backup));
  const first = JSON.parse(await encryptBackup(bytes, password));
  const second = JSON.parse(await encryptBackup(bytes, password));

  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.deepStrictEqual(await decryptBackup(first, password), backup);
  await assert.rejects(decryptBackup(first, 'kata sandi yang berbeda'), /salah atau.*rusak/);

  const binary = atob(first.data);
  const tampered = btoa(String.fromCharCode(binary.charCodeAt(0) ^ 1) + binary.slice(1));
  await assert.rejects(decryptBackup({ ...first, data: tampered }, password), /salah atau.*rusak/);
  await assert.rejects(decryptBackup({ ...first, version: 2 }, password), /Versi/);
  await assert.rejects(encryptBackup(bytes, 'pendek'), /12 sampai 256/);
  console.log('  ✓ enkripsi cadangan, kata sandi salah, dan perubahan ciphertext');
}

testBackupEncryption().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

