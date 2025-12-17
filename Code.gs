// --- KODE GOOGLE APPS SCRIPT (FINAL - SUPPORT UPLOAD GAMBAR) ---

/**
 * FUNGSI PENTING: JALANKAN INI DULU UNTUK MEMBERI IZIN
 * Klik dropdown fungsi di atas, pilih "checkPermissions", lalu klik "Run".
 * Google akan meminta izin akses ke Drive dan Spreadsheet.
 */
function checkPermissions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log("Akses Spreadsheet: OK - Nama File: " + ss.getName());

  const folderName = "Data Kasir App";
  const folders = DriveApp.getFoldersByName(folderName);
  let folder;

  if (folders.hasNext()) {
    folder = folders.next();
    console.log("Folder ditemukan.");
  } else {
    console.log("Folder belum ada, membuat folder baru...");
    folder = DriveApp.createFolder(folderName);
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }

  // --- PAKSA TES IZIN TULIS (WRITE) ---
  console.log("Mengecek izin Tulis (Write)...");
  const tempFile = folder.createFile("tes_izin_sementara.txt", "Isi tes");
  tempFile.setTrashed(true); // Langsung hapus

  console.log("Akses Drive Read/Write: OK SEMPURNA.");

  return "Izin LENGKAP berhasil diberikan! Sekarang deploy ulang web app Anda (Pilih 'New Version').";
}

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  // Lock service untuk mencegah konflik data jika ada request bersamaan
  const lock = LockService.getScriptLock();
  lock.tryLock(30000); // Tunggu maksimal 30 detik

  try {
    // Parsing input dari parameter URL atau Body (JSON)
    let action, data;
    if (e.parameter.action) {
      action = e.parameter.action;
    } else if (e.postData) {
      data = JSON.parse(e.postData.contents);
      action = data.action;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let result = {};

    // Routing Action
    if (action === 'getProducts') {
      result = getProducts(ss);
    } else if (action === 'addProduct') {
      result = addProduct(ss, data);
    } else if (action === 'checkout') {
      result = processTransaction(ss, data);
    } else if (action === 'getTransactions') {
      result = getTransactions(ss);
    } else {
      result = { status: 'error', message: 'Action tidak dikenal' };
    }

    // Return JSON Response
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// --- FUNGSI PRODUK & UPLOAD GAMBAR ---

function getProducts(ss) {
  const sheet = ss.getSheetByName('Produk');
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { status: 'success', data: [] };

  // Ambil data dari baris 2 sampai terakhir, kolom 1 sampai 6
  // Kolom: ID, Nama, Harga, Stok, Kategori, Gambar
  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  const products = data.map(row => {
    // AUTO-REPAIR DATA: Jika ada format gambar Markdown yang rusak dari bug sebelumnya
    let img = row[5] || '';
    const imgStr = String(img); // Pastikan string

    // Cek format rusak: "[url](url)ID" atau "[url](url)"
    if (imgStr.startsWith('[')) {
      // Kita coba ekstrak ID file nya.
      // Pola yang mungkin terjadi akibat bug: "[https://...](https://...)FILE_ID_DISINI"
      // Atau sekedar "[https://...](https://...)" tanpa ID di luar (jarang, tapi mungkin)

      // Ambil bagian setelah tanda ')' terakhir
      const parts = imgStr.split(')');
      if (parts.length > 1) {
        let potentialId = parts[parts.length - 1].trim();

        // Jika ID kosong (berarti formatnya [text](url)), kita coba ambil dari dalam kurung ()
        if (!potentialId || potentialId.length < 5) {
             const innerUrl = imgStr.substring(imgStr.lastIndexOf('(') + 1, imgStr.lastIndexOf(')'));
             if (innerUrl.includes('id=')) {
                potentialId = innerUrl.split('id=')[1];
             }
        }

        if (potentialId && potentialId.length > 10) {
           img = "https://lh3.googleusercontent.com/d/" + potentialId;
        }
      }
    }

    return {
      id: row[0],
      name: row[1],
      price: row[2],
      stock: row[3],
      category: row[4],
      image: img
    };
  }).filter(p => p.id !== '');

  return { status: 'success', data: products };
}

function addProduct(ss, data) {
  const sheet = ss.getSheetByName('Produk');
  const id = 'P-' + Math.floor(Math.random() * 100000);

  // Logic Upload Gambar
  let imageUrl = '';
  // Cek apakah data gambar berupa Base64 (hasil upload file)
  if (data.image && data.image.startsWith('data:image')) {
    try {
      // Upload ke Google Drive
      imageUrl = uploadToDrive(data.image, id + "_" + data.name);
    } catch (e) {
      let msg = e.toString();
      if (msg.includes("permission") || msg.includes("DriveApp")) {
        msg = "IZIN DITOLAK (Detail: " + msg + "). Jalankan 'checkPermissions' lagi.";
      }
      return { status: 'error', message: 'Gagal upload gambar: ' + msg };
    }
  } else {
    // Jika user memasukkan link manual (bukan upload)
    imageUrl = data.image || '';
  }

  // Simpan ke Sheet: ID, Nama, Harga, Stok, Kategori, URL Gambar
  sheet.appendRow([id, data.name, data.price, data.stock, data.category, imageUrl]);
  return { status: 'success', message: 'Produk berhasil ditambahkan' };
}

function uploadToDrive(base64Data, fileName) {
  const folderName = "Data Kasir App";
  const folders = DriveApp.getFoldersByName(folderName);
  let folder;

  // Cek/Buat Folder
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(folderName);
    // Set folder jadi publik (view only) agar gambar bisa dilihat di App
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }

  // Proses Decode Base64
  const split = base64Data.split(',');
  const type = split[0].split(':')[1].split(';')[0]; // Ambil mime type (image/jpeg, dll)
  const bytes = Utilities.base64Decode(split[1]);
  const blob = Utilities.newBlob(bytes, type, fileName);

  // Buat File
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Return URL Thumbnail/View yang bisa diakses publik
  // URL format baru yang lebih stabil (lh3.googleusercontent.com/d/...)
  return "https://lh3.googleusercontent.com/d/" + file.getId();
}

// --- FUNGSI TRANSAKSI ---

function processTransaction(ss, data) {
  const tSheet = ss.getSheetByName('Transaksi');
  const pSheet = ss.getSheetByName('Produk');
  const pData = pSheet.getDataRange().getValues();

  // 1. Kurangi Stok
  data.cart.forEach(item => {
    for (let i = 1; i < pData.length; i++) {
      if (pData[i][0] == item.id) { // Cocokkan ID
        const currentStock = pData[i][3];
        const newStock = currentStock - item.qty;
        // Update cell stok (Baris i+1 karena array mulai 0 tapi sheet mulai 1, Kolom 4)
        pSheet.getRange(i + 1, 4).setValue(newStock);
        break;
      }
    }
  });

  // 2. Catat Riwayat Transaksi
  const idTrans = 'TRX-' + new Date().getTime(); // Generate ID unik dari timestamp
  const detailString = data.cart.map(i => `${i.name} (${i.qty})`).join(', ');

  // Kolom: ID Transaksi, Waktu, Total, Metode, Detail Barang
  tSheet.appendRow([
    idTrans,
    new Date(),
    data.total,
    data.method,
    detailString
  ]);

  return { status: 'success', message: 'Transaksi berhasil disimpan' };
}

function getTransactions(ss) {
  const sheet = ss.getSheetByName('Transaksi');
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { status: 'success', data: [] };

  // Ambil maksimal 50 transaksi terakhir agar ringan
  const startRow = Math.max(2, lastRow - 49);
  const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, 5).getValues();

  // Format data dan balik urutan (terbaru diatas)
  const transactions = data.reverse().map(row => ({
    id: row[0],
    date: row[1],
    total: row[2],
    // row[3] adalah method, row[4] adalah items
    items: row[4]
  }));

  return { status: 'success', data: transactions };
}
