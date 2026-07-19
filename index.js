// Panggil dotenv di baris paling atas agar env terisi sebelum bot berjalan
require('dotenv').config();

const { Telegraf, session } = require('telegraf'); // Menggunakan session bawaan Telegraf
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

console.log('⏳ [Step 1/4] Memulai inisialisasi konfigurasi...');

// ==================== KONFIGURASI ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN) {
    console.error('❌ ERROR FATAL: BOT_TOKEN tidak ditemukan di file .env!');
    process.exit(1);
}
// =====================================================

const bot = new Telegraf(BOT_TOKEN);

// Aktifkan middleware session agar bot bisa melacak status percakapan user
bot.use(session());

const DB_FILE = path.join(__dirname, 'database_v2.json');

const defaultData = {
    users: [],
    schedules: {}
};

// Fungsi membaca database
function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }

        const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
        if (!fileContent.trim()) {
            fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }

        return JSON.parse(fileContent);
    } catch (error) {
        console.error("⚠️ [Database] Error saat membaca/parsing, reset ke default:", error.message);
        return defaultData;
    }
}

// Fungsi menyimpan database
function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("❌ [Database] Gagal menulis data:", error.message);
    }
}

// Fungsi escape karakter khusus Markdown
function escapeMarkdown(text) {
    if (!text) return '';
    return text.toString().replace(/[_*`\[]/g, '\\$&');
}

// Fungsi untuk men-generate ID pesan yang unik secara global (di seluruh schedule pemakai)
function generateGlobalScheduleId(db) {
    const allIds = [];
    Object.keys(db.schedules).forEach((senderId) => {
        if (Array.isArray(db.schedules[senderId])) {
            db.schedules[senderId].forEach((s) => {
                if (s && typeof s.id === 'number') {
                    allIds.push(s.id);
                }
            });
        }
    });
    return allIds.length > 0 ? Math.max(...allIds) + 1 : 1;
}

// Helper untuk memanggil API Telegram dengan retry logic jika terjadi error jaringan (misal ETIMEDOUT)
async function callTelegramWithRetry(method, ...args) {
    const retries = 3;
    let delay = 5000;
    for (let i = 0; i < retries; i++) {
        try {
            return await bot.telegram[method](...args);
        } catch (err) {
            const isNetworkError = err.code === 'ETIMEDOUT' || err.errno === 'ETIMEDOUT' ||
                                   err.message.includes('ETIMEDOUT') || err.message.includes('ENOTFOUND') ||
                                   err.message.includes('EAI_AGAIN') || err.message.includes('ECONNRESET') ||
                                   err.message.includes('network');
            
            if (isNetworkError && i < retries - 1) {
                console.warn(`⚠️ [Network] Gagal memanggil ${method} (${err.message}). Mencoba kembali dalam ${delay / 1000} detik... (Percobaan ${i + 1}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
            } else {
                throw err;
            }
        }
    }
}

// Fungsi untuk mengirim pesan log error ke Admin
function sendToAdmin(text) {
    if (!ADMIN_ID) return;
    bot.telegram.sendMessage(ADMIN_ID, text)
        .catch(err => console.error(`[Admin Log] Gagal mengirim log error ke admin:`, err.message));
}

console.log('⏳ [Step 2/4] Memuat core commands bot...');

// ==================== ALUR USER (START) ====================

bot.start((ctx) => {
    const from = ctx.from;
    const db = readDB();

    const userExists = db.users.find(u => u.id === from.id);
    if (!userExists) {
        db.users.push({
            id: from.id,
            username: from.username ? `@${from.username}` : 'Tanpa Username',
            first_name: from.first_name || 'User'
        });
        writeDB(db);
    }

    ctx.replyWithMarkdown(
        `👋 *Selamat datang, ${escapeMarkdown(from.first_name)}!*\n\n` +
        `Bot ini dirancang untuk mengirimkan pesan pengingat secara berkala kepada target sampai mereka merespons dengan menyatakan tugas selesai.\n\n` +
        `📌 *DAFTAR PERINTAH UTAMA (Interaktif):*\n` +
        `🎵 \`/users\` — Melihat daftar nomor urut pengguna bot.\n` +
        `📝 \`/setpesan\` — Membuat teks pengingat baru.\n` +
        `⏱️ \`/setwaktu\` — Mengatur jeda waktu pengiriman ulang pesan.\n` +
        `🖼️ \`/setqr\` — Menambahkan gambar QRIS pembayaran pada pesan.\n` +
        `🎯 \`/settarget\` — Memilih target pengguna yang akan dikirimi pesan.\n` +
        `📊 \`/status\` — Meninjau semua daftar antrean pengingat aktif Anda.\n` +
        `🗑️ \`/delpesan\` — Menghapus pesan pengingat tertentu.\n\n` +
        `💡 *Info Penting untuk Penerima Target:* \n` +
        `Jika tugas dari pesan terkait sudah selesai dilakukan, Anda wajib membalas dengan cara:\n` +
        `➡️ Ketik perintah \`/done\` lalu masukkan ID pesan saat diminta oleh bot.`
    );
});

// ==================== PENGATURAN SENDER ====================

bot.command('users', (ctx) => {
    const db = readDB();
    if (db.users.length === 0) {
        return ctx.reply("Belum ada user yang terdaftar di bot ini.");
    }

    // Gunakan teks biasa (hapus bintang **), agar karakter '_' aman dibaca sebagai teks biasa
    let response = "📋 Daftar Seluruh Pengguna Bot:\n\n";
    db.users.forEach((user, index) => {
        response += `${index + 1}. ${user.first_name} (${user.username})\n`;
    });
    response += "\n💡 Gunakan nomor urut di atas saat menyeting target di /settarget.";

    // Hapus parse_mode: 'Markdown' di sini agar aman dari karakter underscore username
    ctx.reply(response);
});

bot.command('hitung', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = 'MENUNGGU_INPUT_NOTA';

    let panduan = `🧾 **Generator Nota & Hitung Diskon Proporsional**\n\n`;
    panduan += `Silakan masukkan detail nota dengan format sebagai berikut:\n\n`;
    panduan += `\`\`\`\n`;
    panduan += `beli burger jumlahnya 3 dengan harga 20700\n`;
    panduan += `diskon 4000\n`;
    panduan += `ongkir 2000\n`;
    panduan += `ppn 2000\n`;
    panduan += `\`\`\`\n\n`;
    panduan += `💡 _Tips: Ketik nama barang, jumlah, harga, diskon, ongkir, dan ppn dalam baris terpisah seperti contoh di atas._`;

    ctx.replyWithMarkdown(panduan);
});

// Alur /setpesan interaktif
bot.command('setpesan', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = 'MENUNGGU_ISI_PESAN';
    ctx.reply("📝 Silakan inputkan pesanya:");
});

// Alur /setwaktu interaktif Tahap 1
bot.command('setwaktu', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = 'MENUNGGU_ID_WAKTU';
    ctx.reply("⏱️ Silahkan masukkan id pesanya:");
});

// Alur /setqr interaktif Tahap 1
bot.command('setqr', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = 'MENUNGGU_ID_QR';
    ctx.reply("🖼️ Silahkan masukkan id pesanya untuk dipasang QRIS:");
});

// Alur /settarget interaktif Tahap 1
bot.command('settarget', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = 'MENUNGGU_ID_TARGET';
    ctx.reply("🎯 Silahkan pilih id pesan:");
});

// Alur /delpesan interaktif Tahap 1
bot.command('delpesan', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = 'MENUNGGU_ID_HAPUS';
    ctx.reply("🗑️ Silahkan pilih id pesan:");
});

// REVISI SEKARANG: Alur /done interaktif Tahap 1 (Meminta ID Pesan)
bot.command('done', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = 'MENUNGGU_ID_DONE';
    ctx.reply("✅ Silahkan pilih id pesan yang ingin done:");
});

bot.command('status', (ctx) => {
    const senderId = ctx.from.id;
    const db = readDB();
    const userSchedules = db.schedules[senderId] || [];

    if (userSchedules.length === 0) {
        return ctx.reply("📊 Anda tidak memiliki daftar pengingat aktif saat ini.");
    }

    let response = `📊 **DAFTAR PENGINGAT AKTIF ANDA (${userSchedules.length}):**\n\n`;

    userSchedules.forEach((schedule) => {
        const match = schedule.cronInterval.match(/^(\d+)(m|h)$/);
        const label = match ? `${match[1]} ${match[2] === 'm' ? 'Menit' : 'Jam'}` : '4 Jam';

        response += `🆔 **ID Pesan: ${schedule.id}**\n`;
        response += `💬 Pesan: "${escapeMarkdown(schedule.messageText)}"\n`;
        response += `⏱️ Jeda: Tiap ${label}\n`;
        if (schedule.qrPhotoId) {
            response += `🖼️ QRIS: Terpasang\n`;
        }

        response += `✅ Done (${schedule.doneTargets.length}): `;
        if (schedule.doneTargets.length > 0) {
            response += schedule.doneTargets.map(t => escapeMarkdown(t.name)).join(', ') + '\n';
        } else {
            response += `-\n`;
        }

        response += `⏳ Belum (${schedule.targets.length}): `;
        if (schedule.targets.length > 0) {
            const names = schedule.targets.map(tId => {
                const u = db.users.find(user => user.id === tId);
                return u ? escapeMarkdown(u.first_name) : 'User';
            });
            response += names.join(', ') + '\n';
        } else {
            response += `_- Selesai total -\n_`;
        }
        response += `------------------------------------\n\n`;
    });

    ctx.replyWithMarkdown(response);
});

// ==================== MIDDLEWARE UNTUK MENANGKAP INPUT STATE ====================
bot.on('text', (ctx, next) => {
    if (!ctx.session) ctx.session = {};
    const text = ctx.message.text.trim();
    const senderId = ctx.from.id;

    // Jika user malah mengetik command berawalan /, batalkan state tanya-jawab yang sedang berjalan
    if (text.startsWith('/')) {
        ctx.session.state = null;
        return next();
    }

    // STATE REVISI: Memproses Banyak Jenis Barang (Input Harga = Subtotal Kotor)
    if (ctx.session.state === 'MENUNGGU_INPUT_NOTA') {
        const lines = text.split('\n');

        let daftarBarang = [];
        let totalDiskonGlobal = 0;
        let totalOngkirGlobal = 0;
        let totalPpnGlobal = 0;

        // 1. Parsing data teks baris demi baris
        lines.forEach(line => {
            const l = line.toLowerCase().trim();

            // Deteksi jika baris ini berisi data barang
            if (l.includes('beli') || l.includes('jumlah')) {
                const matchQty = l.match(/(?:jumlahnya|jumlah|qty)\s+(\d+)/);
                const matchHarga = l.match(/(?:harga)\s+(\d+)/);
                const matchNama = line.match(/^(?:beli\s+)?(.*?)\s+(?:jumlahnya|jumlah|qty|dengan|harga)/i);

                if (matchQty && matchHarga) {
                    const qty = parseInt(matchQty[1]);
                    const inputHargaTotal = parseInt(matchHarga[1]); // Ini adalah HARGA TOTAL SUBBARANG
                    
                    let namaBarang = `Barang ${daftarBarang.length + 1}`;
                    if (matchNama && matchNama[1].trim()) {
                        const tempNama = matchNama[1].trim();
                        const lowerTemp = tempNama.toLowerCase();
                        // Validasi agar nama barang tidak kosong atau hanya berisi kata kunci/angka saja
                        if (
                            lowerTemp !== '' &&
                            !lowerTemp.startsWith('jumlah') &&
                            !lowerTemp.startsWith('qty') &&
                            !lowerTemp.startsWith('harga') &&
                            !lowerTemp.startsWith('dengan')
                        ) {
                            namaBarang = tempNama;
                        }
                    }

                    // Hitung harga satuan awal dari total kotor yang diinput
                    const hargaSatuanAwal = inputHargaTotal / qty;

                    daftarBarang.push({
                        nama: namaBarang,
                        qty: qty,
                        hargaAsli: hargaSatuanAwal,       // Harga per pcs sebelum diskon/beban
                        subtotalKotor: inputHargaTotal    // Total kotor sub-barang
                    });
                }
            }
            // Deteksi Diskon Global
            else if (l.includes('diskon')) {
                const match = l.match(/diskon\s+(\d+)/);
                if (match) totalDiskonGlobal = parseInt(match[1]);
            }
            // Deteksi Ongkir Global
            else if (l.includes('ongkir')) {
                const match = l.match(/ongkir\s+(\d+)/);
                if (match) totalOngkirGlobal = parseInt(match[1]);
            }
            // Deteksi PPN Global
            else if (l.includes('ppn') || l.includes('pajak')) {
                const match = l.match(/(?:ppn|pajak)\s+(\d+)/);
                if (match) totalPpnGlobal = parseInt(match[1]);
            }
        });

        if (daftarBarang.length === 0) {
            return ctx.reply("⚠️ Gagal memproses. Pastikan Anda memasukkan minimal satu barang dengan format jumlah dan harga yang benar.");
        }

        // 2. Hitung Total Subtotal Kotor Semua Barang untuk menentukan Bobot Proporsional
        const grandSubtotalKotor = daftarBarang.reduce((sum, item) => sum + item.subtotalKotor, 0);

        // 3. Hitung Proporsi untuk masing-masing barang
        let hasilNota = `🧾 *NOTA TAGIHAN MULTI-ITEM*\n`;
        hasilNota += `------------------------------------\n`;

        let grandTotalBersih = 0;

        daftarBarang.forEach(item => {
            // Rasio proporsional berdasarkan kontribusi harga subtotal kotor barang terhadap total belanjaan
            const rasioProporsional = item.subtotalKotor / grandSubtotalKotor;

            // Alokasikan diskon, ongkir, dan PPN ke barang ini sesuai rasionya
            const diskonPorsiBarang = totalDiskonGlobal * rasioProporsional;
            const ongkirPorsiBarang = totalOngkirGlobal * rasioProporsional;
            const ppnPorsiBarang = totalPpnGlobal * rasioProporsional;

            // Hitung potongan & beban per 1 pcs barang tersebut
            const diskonPerPcs = diskonPorsiBarang / item.qty;
            const ongkirPerPcs = ongkirPorsiBarang / item.qty;
            const ppnPerPcs = ppnPorsiBarang / item.qty;

            // Kalkulasi harga bersih satuan
            const hargaBersihPerPcs = item.hargaAsli - diskonPerPcs + ongkirPerPcs + ppnPerPcs;
            const totalBersihItem = hargaBersihPerPcs * item.qty;
            grandTotalBersih += totalBersihItem;

            // Susun teks struk per item barang
            hasilNota += `📦 *${escapeMarkdown(item.nama)}* (x${item.qty})\n`;
            hasilNota += `   • Harga Awal Satuan : Rp ${Math.round(item.hargaAsli).toLocaleString('id-ID')}/pcs\n`;

            if (totalDiskonGlobal > 0) {
                hasilNota += `   • Potongan (Diskon) : -Rp ${Math.round(diskonPerPcs).toLocaleString('id-ID')}/pcs\n`;
            }
            if (totalOngkirGlobal > 0 || totalPpnGlobal > 0) {
                const totalBebanTambahanPerPcs = ongkirPerPcs + ppnPerPcs;
                hasilNota += `   • Beban (Ongkir+PPN): +Rp ${Math.round(totalBebanTambahanPerPcs).toLocaleString('id-ID')}/pcs\n`;
            }

            hasilNota += `   ➡️ *HARGA BERSIH SATUAN:* Rp ${Math.round(hargaBersihPerPcs).toLocaleString('id-ID')}/pcs\n`;
            hasilNota += `   ➡️ *Subtotal Bersih:* Rp ${Math.round(totalBersihItem).toLocaleString('id-ID')}\n\n`;
        });

        hasilNota += `------------------------------------\n`;
        if (totalDiskonGlobal > 0) hasilNota += `📉 Total Diskon: Rp ${totalDiskonGlobal.toLocaleString('id-ID')}\n`;
        if (totalOngkirGlobal > 0) hasilNota += `🚚 Total Ongkir: Rp ${totalOngkirGlobal.toLocaleString('id-ID')}\n`;
        if (totalPpnGlobal > 0) hasilNota += `🏛️ Total PPN: Rp ${totalPpnGlobal.toLocaleString('id-ID')}\n`;
        hasilNota += `💰 *TOTAL ALL ITEM:* Rp ${Math.round(grandTotalBersih).toLocaleString('id-ID')}\n`;

        // 4. Simpan ke Database
        const db = readDB();
        if (!db.schedules[senderId]) db.schedules[senderId] = [];

        const newId = generateGlobalScheduleId(db);

        db.schedules[senderId].push({
            id: newId,
            messageText: hasilNota.replace(/\*/g, ''), // Bersihkan teks dari format tebal Markdown saat disimpan
            targets: [],
            doneTargets: [],
            cronInterval: '4h',
            lastSent: 0
        });
        writeDB(db);

        ctx.session.state = null;

        let responseBalikan = `✅ **Nota Berhasil Dihitung (Input Berdasar Subtotal)!**\n\n`;
        responseBalikan += `${hasilNota}\n`;
        responseBalikan += `📌 ID Pesan: **${newId}**\n`;
        responseBalikan += `⏱️ _Default jeda: 4 jam. Gunakan /settarget untuk mulai spam._`;

        return ctx.replyWithMarkdown(responseBalikan);
    }

    // 1. STATE: Menerima Teks Isi Pesan (/setpesan)
    if (ctx.session.state === 'MENUNGGU_ISI_PESAN') {
        const db = readDB();

        if (!db.schedules[senderId]) {
            db.schedules[senderId] = [];
        }

        const newId = generateGlobalScheduleId(db);

        const newSchedule = {
            id: newId,
            messageText: text,
            targets: [],
            doneTargets: [],
            cronInterval: '4h',
            lastSent: 0
        };

        db.schedules[senderId].push(newSchedule);
        writeDB(db);

        ctx.session.state = null; // Reset state
        return ctx.replyWithMarkdown(`✅ Pesan baru berhasil dibuat dengan **ID: ${newId}**\n\n💬 Pesan: "${escapeMarkdown(text)}"\n\n⏱️ _Default jeda: 4 jam. Silakan atur jeda waktu menggunakan perintah:_ \`/setwaktu\``);
    }

    // STATE: Menerima ID Pesan untuk QRIS (/setqr Tahap 1)
    if (ctx.session.state === 'MENUNGGU_ID_QR') {
        const targetMsgId = parseInt(text);

        if (isNaN(targetMsgId)) {
            return ctx.reply("⚠️ ID Pesan harus berupa angka. Silahkan masukkan kembali id pesanya:");
        }

        const db = readDB();
        const userSchedules = db.schedules[senderId] || [];
        const schedule = userSchedules.find(s => s.id === targetMsgId);

        if (!schedule) {
            return ctx.reply(`❌ Pengingat dengan ID ${targetMsgId} tidak ditemukan. Silahkan masukkan ID pesan yang benar (cek di /status):`);
        }

        ctx.session.tempQrMsgId = targetMsgId;
        ctx.session.state = 'MENUNGGU_FOTO_QR';

        return ctx.reply("📸 Silahkan kirimkan foto/gambar QRIS pembayaran untuk pesan ini:");
    }

    // 2. STATE: Menerima ID Pesan untuk Waktu (/setwaktu Tahap 1)
    if (ctx.session.state === 'MENUNGGU_ID_WAKTU') {
        const targetMsgId = parseInt(text);

        if (isNaN(targetMsgId)) {
            return ctx.reply("⚠️ ID Pesan harus berupa angka. Silahkan masukkan kembali id pesanya:");
        }

        const db = readDB();
        const userSchedules = db.schedules[senderId] || [];
        const schedule = userSchedules.find(s => s.id === targetMsgId);

        if (!schedule) {
            return ctx.reply(`❌ Pengingat dengan ID ${targetMsgId} tidak ditemukan. Silahkan masukkan ID pesan yang benar (cek di /status):`);
        }

        ctx.session.tempWaktuMsgId = targetMsgId;
        ctx.session.state = 'MENUNGGU_NILAI_WAKTU';

        return ctx.replyWithMarkdown(
            `⏱️ *Silahkan masukkan jeda waktunya sesuai aturan:*\n\n` +
            `⚙️ *Aturan Format Waktu:*\n` +
            `• Gunakan angka diikuti huruf \`m\` untuk satuan *Menit*.\n` +
            `• Gunakan angka diikuti huruf \`h\` untuk satuan *Jam*.\n\n` +
            `💡 *Contoh Input (Pilih salah satu):*\n` +
            `• Ketik \`15m\` (jika ingin dikirim ulang tiap 15 menit)\n` +
            `• Ketik \`2h\` (jika ingin dikirim ulang tiap 2 jam)`
        );
    }

    // 3. STATE: Menerima Nilai Waktu (/setwaktu Tahap 2 - Final)
    if (ctx.session.state === 'MENUNGGU_NILAI_WAKTU') {
        const targetMsgId = ctx.session.tempWaktuMsgId;

        if (!targetMsgId) {
            ctx.session.state = null;
            return ctx.reply("❌ Terjadi kesalahan sesi. Silakan ulangi dengan perintah /setwaktu");
        }

        const timeInput = text.toLowerCase();
        const match = timeInput.match(/^(\d+)(m|h)$/);

        if (!match) {
            return ctx.reply("⚠️ Format salah! Waktu harus berupa angka diikuti 'm' (menit) atau 'h' (jam).\n\nSilahkan masukkan kembali sesuai contoh (misal: 15m atau 2h):");
        }

        const db = readDB();
        const userSchedules = db.schedules[senderId] || [];
        const schedule = userSchedules.find(s => s.id === targetMsgId);

        if (!schedule) {
            ctx.session.state = null;
            return ctx.reply("❌ Data pengingat tidak ditemukan. Proses dibatalkan.");
        }

        schedule.cronInterval = timeInput;
        writeDB(db);

        const timeLabel = match[2] === 'm' ? 'Menit' : 'Jam';

        ctx.session.state = null;
        ctx.session.tempWaktuMsgId = null;

        return ctx.replyWithMarkdown(`✅ Jeda untuk Pesan **ID: ${targetMsgId}** berhasil diatur menjadi setiap: *${match[1]} ${timeLabel}*`);
    }

    // 4. STATE: Menerima ID Pesan untuk Target (/settarget Tahap 1)
    if (ctx.session.state === 'MENUNGGU_ID_TARGET') {
        const targetMsgId = parseInt(text);

        if (isNaN(targetMsgId)) {
            return ctx.reply("⚠️ ID Pesan harus berupa angka. Silahkan masukkan kembali id pesan:");
        }

        const db = readDB();
        const userSchedules = db.schedules[senderId] || [];
        const schedule = userSchedules.find(s => s.id === targetMsgId);

        if (!schedule) {
            return ctx.reply(`❌ Pengingat dengan ID ${targetMsgId} tidak ditemukan. Silahkan masukkan ID pesan yang benar (cek di /status):`);
        }

        ctx.session.tempTargetMsgId = targetMsgId;
        ctx.session.state = 'MENUNGGU_NOMOR_TARGET';

        return ctx.replyWithMarkdown(
            `👤 *Silahkan masukkan nomor user target:*\n\n` +
            `💡 _Info: Ambil nomor urut user dari perintah /users_\n` +
            `🔹 Jika target hanya *1 user*, langsung ketik angkanya saja. Contoh: \`1\`\n` +
            `🔹 Jika target *lebih dari satu user*, pisahkan dengan tanda koma. Contoh: \`1,2\` atau \`1,3,4\``
        );
    }

    // 5. STATE: Menerima Nomor User (/settarget Tahap 2 - Final)
    if (ctx.session.state === 'MENUNGGU_NOMOR_TARGET') {
        const targetMsgId = ctx.session.tempTargetMsgId;

        if (!targetMsgId) {
            ctx.session.state = null;
            return ctx.reply("❌ Terjadi kesalahan sesi. Silakan ulangi dengan perintah /settarget");
        }

        const db = readDB();
        const userSchedules = db.schedules[senderId] || [];
        const schedule = userSchedules.find(s => s.id === targetMsgId);

        if (!schedule) {
            ctx.session.state = null;
            return ctx.reply("❌ Data pengingat mendadak tidak ditemukan. Proses dibatalkan.");
        }

        const choices = text.split('.').join(',').split(',').map(num => parseInt(num.trim()) - 1);

        schedule.targets = [];
        schedule.doneTargets = [];
        schedule.lastSent = Date.now();

        let targetNames = [];
        choices.forEach(index => {
            if (db.users[index]) {
                const targetUser = db.users[index];
                if (!schedule.targets.includes(targetUser.id)) {
                    schedule.targets.push(targetUser.id);
                    targetNames.push(escapeMarkdown(targetUser.first_name));
                }
            }
        });

        if (targetNames.length > 0) {
            writeDB(db);
            const match = schedule.cronInterval.match(/^(\d+)(m|h)$/);
            const label = match ? `${match[1]} ${match[2] === 'm' ? 'Menit' : 'Jam'}` : '4 Jam';

            ctx.session.state = null;
            ctx.session.tempTargetMsgId = null;

            return ctx.replyWithMarkdown(`🎯 Pesan **ID: ${targetMsgId}** berhasil diseting menuju: ${targetNames.join(', ')}\nBot mulai mengirim berkala tiap *${label}*.`);
        } else {
            return ctx.reply("❌ Nomor urut user salah atau tidak terdaftar di sistem. Silahkan masukkan ulang nomor target yang benar:");
        }
    }

    // 6. STATE: Menerima ID Pesan untuk Dihapus (/delpesan Tahap 2 - Final)
    if (ctx.session.state === 'MENUNGGU_ID_HAPUS') {
        const targetMsgId = parseInt(text);

        if (isNaN(targetMsgId)) {
            return ctx.reply("⚠️ ID Pesan harus berupa angka. Silahkan masukkan kembali id pesan yang ingin dihapus:");
        }

        const db = readDB();
        const userSchedules = db.schedules[senderId] || [];
        const scheduleIndex = userSchedules.findIndex(s => s.id === targetMsgId);

        if (scheduleIndex === -1) {
            return ctx.reply(`❌ Pengingat dengan ID ${targetMsgId} tidak ditemukan dalam daftar aktif Anda. Silahkan masukkan ID pesan yang benar (cek di /status):`);
        }

        const deletedMessageText = userSchedules[scheduleIndex].messageText;

        // Hapus dari array database jika ID valid
        db.schedules[senderId].splice(scheduleIndex, 1);
        writeDB(db);

        ctx.session.state = null;

        return ctx.replyWithMarkdown(`🗑️ **Pengingat ID #${targetMsgId} Berhasil Dihapus!**\n\n💬 Teks pesan sebelumnya:\n_"${escapeMarkdown(deletedMessageText)}"_\n\nStatus antrean dibersihkan dan bot berhenti mengirim pesan ini.`);
    }

    // REVISI SEKARANG: 7. STATE: Menerima ID Pesan untuk diproses DONE (/done Tahap 2 - Final)
    // REVISI BARU: 7. STATE: Menerima ID Pesan untuk diproses DONE (/done Tahap 2 - Validasi ID)
    if (ctx.session.state === 'MENUNGGU_ID_DONE') {
        const targetMsgId = parseInt(text);

        if (isNaN(targetMsgId)) {
            return ctx.reply("⚠️ ID Pesan harus berupa angka. Silahkan masukkan kembali id pesan yang ingin done:");
        }

        const targetId = ctx.chat.id;
        const db = readDB();
        let isFound = false;

        // Validasi apakah user memang terdaftar di ID pesan tersebut
        Object.keys(db.schedules).forEach((sId) => {
            const schedule = db.schedules[sId].find(s => s.id === targetMsgId);
            if (schedule && schedule.targets.includes(targetId)) {
                isFound = true;
            }
        });

        if (isFound) {
            // Simpan ID pesan ke session dan pindah ke state menunggu foto
            ctx.session.tempDoneMsgId = targetMsgId;
            ctx.session.state = 'MENUNGGU_BUKTI_FOTO';
            return ctx.replyWithMarkdown("📸 ID Pesan valid. Sekarang, silakan **kirimkan foto/gambar** sebagai bukti lampiran, atau ketik **tunai** jika pembayaran secara tunai (tanpa foto):");
        } else {
            return ctx.reply(`❌ Anda tidak terdaftar dalam antrean aktif untuk pesan ID #${targetMsgId}.\n\nSilahkan cek kembali dan masukkan ID pesan yang benar:`);
        }
    }

    // 8. STATE: Menunggu Bukti Foto, tapi user mengetik "tunai"
    if (ctx.session.state === 'MENUNGGU_BUKTI_FOTO') {
        const inputMsg = text.toLowerCase().trim();
        if (inputMsg === 'tunai') {
            const targetMsgId = ctx.session.tempDoneMsgId;
            if (!targetMsgId) {
                ctx.session.state = null;
                return ctx.reply("❌ Terjadi kesalahan sesi. Silakan ulangi dengan perintah /done");
            }

            const targetId = ctx.chat.id;
            const targetName = ctx.from.first_name;
            const targetUsername = ctx.from.username ? `@${ctx.from.username}` : 'Tanpa Username';

            const db = readDB();
            let updated = false;

            Object.keys(db.schedules).forEach((sId) => {
                const scheduleIndex = db.schedules[sId].findIndex(s => s.id === targetMsgId);

                if (scheduleIndex !== -1) {
                    const schedule = db.schedules[sId][scheduleIndex];
                    const index = schedule.targets.indexOf(targetId);

                    if (index !== -1) {
                        // Pindahkan target dari daftar antrean ke daftar selesai (doneTargets)
                        schedule.targets.splice(index, 1);
                        schedule.doneTargets.push({ id: targetId, name: targetName, username: targetUsername });
                        updated = true;

                        const match = schedule.cronInterval.match(/^(\d+)(m|h)$/);
                        const label = match ? `${match[1]} ${match[2] === 'm' ? 'Menit' : 'Jam'}` : '4 Jam';

                        // --- FORMAT LAPORAN UNTUK SENDER (PEMBAYARAN TUNAI) ---
                        let reportMsg = `👤 **PENGIRIM BUKTI (TUNAI):** ${escapeMarkdown(targetName)} (${escapeMarkdown(targetUsername)})\n`;
                        reportMsg += `🔔 **INFO:** TARGET MERESPON DONE (ID PESAN: #${targetMsgId}) - PEMBAYARAN TUNAI\n\n`;
                        reportMsg += `📝 **Isi Pesan Tagihan:**\n_"${escapeMarkdown(schedule.messageText)}"_\n`;

                        reportMsg += `\n✅ **Sudah Done:**\n`;
                        schedule.doneTargets.forEach((t, idx) => reportMsg += `${idx + 1}. ${escapeMarkdown(t.name)} (${escapeMarkdown(t.username)})\n`);

                        reportMsg += `\n⏳ **Belum Done:**\n`;
                        if (schedule.targets.length > 0) {
                            schedule.targets.forEach((tId, idx) => {
                                const uObj = db.users.find(u => u.id === tId);
                                reportMsg += `${idx + 1}. ${uObj ? escapeMarkdown(uObj.first_name) : 'User'} (${uObj ? escapeMarkdown(uObj.username) : ''})\n`;
                            });
                            reportMsg += `\n🔄 _Spam berlanjut setiap ${label} untuk sisa target._`;
                        } else {
                            reportMsg += `_- Semua target selesai total! -\n_\n🎉 **Pengingat ID #${targetMsgId} dihentikan dan dihapus otomatis.**`;
                        }

                        // Kirim laporan teks langsung ke pembuat pesan (sId) tanpa foto
                        callTelegramWithRetry('sendMessage', sId, reportMsg, {
                            parse_mode: 'Markdown'
                        }).catch(e => {
                            const errMsg = `❌ Gagal mengirim laporan tunai ke pembuat pesan ${sId}: ${e.message}`;
                            console.error(errMsg);
                            sendToAdmin(errMsg);
                        });

                        // Jika target sudah habis, hapus antrean dari database agar hemat ruang
                        if (schedule.targets.length === 0) {
                            db.schedules[sId].splice(scheduleIndex, 1);
                        }
                    }
                }
            });

            if (updated) {
                writeDB(db);
                ctx.session.state = null;
                ctx.session.tempDoneMsgId = null;
                return ctx.reply(`✅ Konfirmasi 'done' (Tunai) untuk pesan ID #${targetMsgId} berhasil dikirim ke pembuat pesan.`);
            } else {
                ctx.session.state = null;
                ctx.session.tempDoneMsgId = null;
                return ctx.reply(`❌ Terjadi kesalahan. Anda mendadak tidak ditemukan di daftar antrean.`);
            }
        } else {
            return ctx.replyWithMarkdown("⚠️ Input tidak dikenali. Silakan **kirimkan foto/gambar** bukti lampiran, atau ketik **tunai** jika pembayaran secara tunai:");
        }
    }

    return next();
});
// ==================== MIDDLEWARE UNTUK MENANGKAP FOTO (BUKTI ATAU QRIS) ====================
bot.on('photo', (ctx) => {
    if (!ctx.session) return;

    // Jika sedang menunggu foto QRIS
    if (ctx.session.state === 'MENUNGGU_FOTO_QR') {
        const targetMsgId = ctx.session.tempQrMsgId;
        if (!targetMsgId) {
            ctx.session.state = null;
            return ctx.reply("❌ Terjadi kesalahan sesi. Silakan ulangi dengan perintah /setqr");
        }

        const senderId = ctx.from.id;
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

        const db = readDB();
        const userSchedules = db.schedules[senderId] || [];
        const schedule = userSchedules.find(s => s.id === targetMsgId);

        if (!schedule) {
            ctx.session.state = null;
            ctx.session.tempQrMsgId = null;
            return ctx.reply("❌ Data pengingat tidak ditemukan. Proses dibatalkan.");
        }

        schedule.qrPhotoId = photoId;
        writeDB(db);

        ctx.session.state = null;
        ctx.session.tempQrMsgId = null;

        return ctx.replyWithMarkdown(`✅ Gambar QRIS berhasil ditambahkan untuk Pesan **ID: ${targetMsgId}**`);
    }

    if (ctx.session.state !== 'MENUNGGU_BUKTI_FOTO') {
        return; // Abaikan jika user mengirim foto tanpa alur /done
    }

    const targetMsgId = ctx.session.tempDoneMsgId;
    if (!targetMsgId) {
        ctx.session.state = null;
        return ctx.reply("❌ Terjadi kesalahan sesi. Silakan ulangi dengan perintah /done");
    }

    const targetId = ctx.chat.id;
    const targetName = ctx.from.first_name;
    const targetUsername = ctx.from.username ? `@${ctx.from.username}` : 'Tanpa Username';

    // Mengambil file_id foto dengan resolusi tertinggi (paling terakhir di array)
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const captionOpsi = ctx.message.caption || ''; // Ambil caption tambahan dari user jika ada

    const db = readDB();
    let updated = false;

    Object.keys(db.schedules).forEach((sId) => {
        const scheduleIndex = db.schedules[sId].findIndex(s => s.id === targetMsgId);

        if (scheduleIndex !== -1) {
            const schedule = db.schedules[sId][scheduleIndex];
            const index = schedule.targets.indexOf(targetId);

            if (index !== -1) {
                // Pindahkan target dari daftar antrean ke daftar selesai (doneTargets)
                schedule.targets.splice(index, 1);
                schedule.doneTargets.push({ id: targetId, name: targetName, username: targetUsername });
                updated = true;

                const match = schedule.cronInterval.match(/^(\d+)(m|h)$/);
                const label = match ? `${match[1]} ${match[2] === 'm' ? 'Menit' : 'Jam'}` : '4 Jam';

                // --- FORMAT CAPTION FOTO UNTUK SENDER (NAMA PENGIRIM DI ATAS) ---
                let reportMsg = `👤 **PENGIRIM BUKTI:** ${escapeMarkdown(targetName)} (${escapeMarkdown(targetUsername)})\n`;
                reportMsg += `🔔 **INFO:** TARGET MERESPON DONE (ID PESAN: #${targetMsgId})\n\n`;
                reportMsg += `📝 **Isi Pesan Tagihan:**\n_"${escapeMarkdown(schedule.messageText)}"_\n`;

                if (captionOpsi) {
                    reportMsg += `💬 **Catatan Tambahan User:** "${escapeMarkdown(captionOpsi)}"\n`;
                }

                reportMsg += `\n✅ **Sudah Done:**\n`;
                schedule.doneTargets.forEach((t, idx) => reportMsg += `${idx + 1}. ${escapeMarkdown(t.name)} (${escapeMarkdown(t.username)})\n`);

                reportMsg += `\n⏳ **Belum Done:**\n`;
                if (schedule.targets.length > 0) {
                    schedule.targets.forEach((tId, idx) => {
                        const uObj = db.users.find(u => u.id === tId);
                        reportMsg += `${idx + 1}. ${uObj ? escapeMarkdown(uObj.first_name) : 'User'} (${uObj ? escapeMarkdown(uObj.username) : ''})\n`;
                    });
                    reportMsg += `\n🔄 _Spam berlanjut setiap ${label} untuk sisa target._`;
                } else {
                    reportMsg += `_- Semua target selesai total! -\n_\n🎉 **Pengingat ID #${targetMsgId} dihentikan dan dihapus otomatis.**`;
                }

                // Kirim Foto Bukti beserta laporan teks langsung ke pembuat pesan (sId)
                callTelegramWithRetry('sendPhoto', sId, photoId, {
                    caption: reportMsg,
                    parse_mode: 'Markdown'
                }).catch(e => {
                    const errMsg = `❌ Gagal mengirim foto bukti ke pembuat pesan ${sId}: ${e.message}`;
                    console.error(errMsg);
                    sendToAdmin(errMsg);
                });

                // Jika target sudah habis, hapus antrean dari database agar hemat ruang
                if (schedule.targets.length === 0) {
                    db.schedules[sId].splice(scheduleIndex, 1);
                }
            }
        }
    });

    if (updated) {
        writeDB(db);
        ctx.session.state = null;
        ctx.session.tempDoneMsgId = null;
        return ctx.reply(`✅ Konfirmasi 'done' beserta bukti foto untuk pesan ID #${targetMsgId} berhasil dikirim ke pembuat pesan.`);
    } else {
        ctx.session.state = null;
        ctx.session.tempDoneMsgId = null;
        return ctx.reply(`❌ Terjadi kesalahan. Anda mendadak tidak ditemukan di daftar antrean.`);
    }
});

// ==================== EDUKASI CHAT "DONE" TANPA SLASH ====================

bot.hears(/^(done|Done|DONE)$/, (ctx) => {
    ctx.replyWithMarkdown("💡 Untuk menyelesaikan antrean pesan, gunakan perintah: \`/done\` lalu masukkan ID pesan saat diminta oleh bot.");
});

console.log('⏳ [Step 3/4] Mengaktifkan mesin checker dinamis (Tiap 1 Menit)...');

// ==================== ENGINE CHECKER DINAMIS ENGINE V3 ====================
cron.schedule('*/10 * * * *', () => {
    const db = readDB();
    const now = Date.now();
    let isDbChanged = false;

    Object.keys(db.schedules).forEach((senderId) => {
        // CARI INFO PEMBUAT PESAN BERDASARKAN SENDER ID
        const creator = db.users.find(u => u.id === parseInt(senderId));
        const creatorName = creator ? creator.first_name : 'Admin/Pembuat';
        const creatorUsername = creator && creator.username ? ` (${creator.username})` : '';

        db.schedules[senderId].forEach((schedule) => {
            if (schedule.targets && schedule.targets.length > 0) {
                const intervalStr = schedule.cronInterval || '4h';
                const match = intervalStr.match(/^(\d+)(m|h)$/);

                let intervalMs = 4 * 60 * 60 * 1000;
                if (match) {
                    const value = parseInt(match[1]);
                    intervalMs = match[2] === 'm' ? value * 60 * 1000 : value * 60 * 60 * 1000;
                }

                if (!schedule.lastSent) {
                    schedule.lastSent = now;
                    isDbChanged = true;
                }

                if (now - schedule.lastSent >= intervalMs) {
                    schedule.lastSent = now;
                    isDbChanged = true;

                    // Mengamankan karakter agar tidak merusak Markdown tagihan
                    const safeCreatorUsername = escapeMarkdown(creatorUsername);
                    const safeCreatorName = escapeMarkdown(creatorName);
                    const safeMessageText = escapeMarkdown(schedule.messageText);

                    // 1. KIRIM SPAM KE TARGET (DITAMBAHKAN NAMA PEMBUAT)
                    schedule.targets.forEach((targetId) => {
                        let spamMsg = `🔔 *[ PENGINGAT / TAGIHAN ]*\n\n`;
                        spamMsg += `👤 *Dari Pembuat:* ${safeCreatorName}${safeCreatorUsername}\n`;
                        spamMsg += `📝 *Pesan:* ${safeMessageText}\n\n`;
                        spamMsg += `💡 Ketik \`/done\` lalu inputkan ID pesan *${schedule.id}* jika tugas Anda sudah selesai.`;

                        if (schedule.qrPhotoId) {
                            callTelegramWithRetry('sendPhoto', targetId, schedule.qrPhotoId, {
                                caption: spamMsg,
                                parse_mode: 'Markdown'
                            }).catch((err) => {
                                const errMsg = `❌ Gagal kirim spam QRIS ke target ${targetId} (ID Pesan: #${schedule.id}): ${err.message}`;
                                console.error(errMsg);
                                sendToAdmin(errMsg);
                            });
                        } else {
                            callTelegramWithRetry('sendMessage', targetId, spamMsg, { parse_mode: 'Markdown' })
                                .catch((err) => {
                                    const errMsg = `❌ Gagal kirim spam ke target ${targetId} (ID Pesan: #${schedule.id}): ${err.message}`;
                                    console.error(errMsg);
                                    sendToAdmin(errMsg);
                                });
                        }
                    });

                    // 2. KIRIM LAPORAN BERKALA KE SENDER
                    const label = match ? `${match[1]} ${match[2] === 'm' ? 'Menit' : 'Jam'}` : '4 Jam';
                    let reportMsg = `📊 **LAPORAN BERKALA PESAN ID #${schedule.id} (Tiap ${label})**\n\n`;
                    reportMsg += `📝 **Isi Teks:** "${safeMessageText}"\n\n`;

                    reportMsg += `✅ **Sudah Done:**\n`;
                    if (schedule.doneTargets.length > 0) {
                        schedule.doneTargets.forEach((t, idx) => reportMsg += `${idx + 1}. ${escapeMarkdown(t.name)}\n`);
                    } else {
                        reportMsg += `_- Belum ada -\n_`;
                    }

                    reportMsg += `\n⏳ **Belum Done (Masih Di-spam):**\n`;
                    schedule.targets.forEach((targetId, idx) => {
                        const uObj = db.users.find(u => u.id === targetId);
                        reportMsg += `${idx + 1}. ${uObj ? escapeMarkdown(uObj.first_name) : 'User'}\n`;
                    });

                    callTelegramWithRetry('sendMessage', senderId, reportMsg, { parse_mode: 'Markdown' })
                        .catch(e => {
                            const errMsg = `❌ Gagal kirim laporan berkala ke sender ${senderId} (ID Pesan: #${schedule.id}): ${e.message}`;
                            console.error(errMsg);
                            sendToAdmin(errMsg);
                        });
                }
            }
        });
    });

    if (isDbChanged) {
        writeDB(db);
    }
});

console.log('⏳ [Step 4/4] Menghubungkan ke API Telegram...');

// ==================== RUN BOT DENGAN AUTO-RECONNECT ====================
const DELAY_RETRY_MS = 5000; // Jeda waktu mencoba kembali (5 detik)

function launchBotWithRetry() {
    console.log('⏳ Menghubungkan ke API Telegram...');
    
    bot.launch()
        .then(() => {
            console.log('\n🚀 BINGO! Bot "Sang Penagih" Multi-Instance Aktif Berjalan Sempurna.');
        })
        .catch((err) => {
            console.error(`\n❌ Gagal saat melakukan bot.launch(): ${err.message}`);
            sendToAdmin(`❌ Gagal saat melakukan bot.launch(): ${err.message}`);
            console.log(`🔄 Mencoba menghubungkan kembali dalam ${DELAY_RETRY_MS / 1000} detik...`);
            
            // Panggil ulang fungsi ini setelah jeda waktu tertentu
            setTimeout(launchBotWithRetry, DELAY_RETRY_MS);
        });
}

// Jalankan fungsi booting pertama kali
launchBotWithRetry();

// Handler untuk error yang tidak tertangkap global agar bot tidak langsung crash
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Async Reject:', reason);
    sendToAdmin(`⚠️ [Unhandled Rejection] ${reason instanceof Error ? reason.stack || reason.message : reason}`);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ System Error:', error.message);
    sendToAdmin(`⚠️ [Uncaught Exception] ${error.stack || error.message}`);
    // Jika crash disebabkan oleh gangguan jaringan telegraf di tengah jalan
    if (error.message.includes('ETIMEDOUT') || error.message.includes('ENOTFOUND')) {
        console.log(`🔄 Terjadi masalah jaringan jaringan, memicu reconnect...`);
        // Bot Telegraf modern biasanya auto-reconnect untuk long polling, 
        // namun jika bot berhenti total, Anda bisa memicu launchBotWithRetry() kembali di sini jika diperlukan.
    }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));