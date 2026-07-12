// Panggil dotenv di baris paling atas agar env terisi sebelum bot berjalan
require('dotenv').config();

const { Telegraf, session } = require('telegraf'); // Menggunakan session bawaan Telegraf
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

console.log('⏳ [Step 1/4] Memulai inisialisasi konfigurasi...');

// ==================== KONFIGURASI ====================
const BOT_TOKEN = process.env.BOT_TOKEN;

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
        `👋 *Selamat datang, ${from.first_name}!*\n\n` +
        `Bot ini dirancang untuk mengirimkan pesan pengingat secara berkala kepada target sampai mereka merespons dengan menyatakan tugas selesai.\n\n` +
        `📌 *DAFTAR PERINTAH UTAMA (Interaktif):*\n` +
        `🎵 \`/users\` — Melihat daftar nomor urut pengguna bot.\n` +
        `📝 \`/setpesan\` — Membuat teks pengingat baru.\n` +
        `⏱️ \`/setwaktu\` — Mengatur jeda waktu pengiriman ulang pesan.\n` +
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
        response += `💬 Pesan: "${schedule.messageText}"\n`;
        response += `⏱️ Jeda: Tiap ${label}\n`;

        response += `✅ Done (${schedule.doneTargets.length}): `;
        if (schedule.doneTargets.length > 0) {
            response += schedule.doneTargets.map(t => t.name).join(', ') + '\n';
        } else {
            response += `-\n`;
        }

        response += `⏳ Belum (${schedule.targets.length}): `;
        if (schedule.targets.length > 0) {
            const names = schedule.targets.map(tId => {
                const u = db.users.find(user => user.id === tId);
                return u ? u.first_name : 'User';
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
                const matchNama = line.match(/(?:beli)\s+(.*?)\s+(?:jumlahnya|jumlah|qty|dengan|harga)/i);

                if (matchQty && matchHarga) {
                    const qty = parseInt(matchQty[1]);
                    const inputHargaTotal = parseInt(matchHarga[1]); // Ini adalah HARGA TOTAL SUBBARANG
                    const namaBarang = matchNama ? matchNama[1].trim() : `Barang ${daftarBarang.length + 1}`;

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
            hasilNota += `📦 *${item.nama}* (x${item.qty})\n`;
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

        const newId = db.schedules[senderId].length > 0
            ? Math.max(...db.schedules[senderId].map(s => s.id)) + 1
            : 1;

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

        const newId = db.schedules[senderId].length > 0
            ? Math.max(...db.schedules[senderId].map(s => s.id)) + 1
            : 1;

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
        return ctx.replyWithMarkdown(`✅ Pesan baru berhasil dibuat dengan **ID: ${newId}**\n\n💬 Pesan: "${text}"\n\n⏱️ _Default jeda: 4 jam. Silakan atur jeda waktu menggunakan perintah:_ \`/setwaktu\``);
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
                    targetNames.push(targetUser.first_name);
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

        return ctx.replyWithMarkdown(`🗑️ **Pengingat ID #${targetMsgId} Berhasil Dihapus!**\n\n💬 Teks pesan sebelumnya:\n_"${deletedMessageText}"_\n\nStatus antrean dibersihkan dan bot berhenti mengirim pesan ini.`);
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
            return ctx.reply("📸 ID Pesan valid. Sekarang, silakan **kirimkan foto/gambar** sebagai bukti lampiran:");
        } else {
            return ctx.reply(`❌ Anda tidak terdaftar dalam antrean aktif untuk pesan ID #${targetMsgId}.\n\nSilahkan cek kembali dan masukkan ID pesan yang benar:`);
        }
    }

    return next();
});
// ==================== MIDDLEWARE UNTUK MENANGKAP BUKTI FOTO ====================
bot.on('photo', (ctx) => {
    if (!ctx.session || ctx.session.state !== 'MENUNGGU_BUKTI_FOTO') {
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
                let reportMsg = `👤 **PENGIRIM BUKTI:** ${targetName} (${targetUsername})\n`;
                reportMsg += `🔔 **INFO:** TARGET MERESPON DONE (ID PESAN: #${targetMsgId})\n\n`;
                reportMsg += `📝 **Isi Pesan Tagihan:**\n_"${schedule.messageText}"_\n`;

                if (captionOpsi) {
                    reportMsg += `💬 **Catatan Tambahan User:** "${captionOpsi}"\n`;
                }

                reportMsg += `\n✅ **Sudah Done:**\n`;
                schedule.doneTargets.forEach((t, idx) => reportMsg += `${idx + 1}. ${t.name} (${t.username})\n`);

                reportMsg += `\n⏳ **Belum Done:**\n`;
                if (schedule.targets.length > 0) {
                    schedule.targets.forEach((tId, idx) => {
                        const uObj = db.users.find(u => u.id === tId);
                        reportMsg += `${idx + 1}. ${uObj ? uObj.first_name : 'User'} (${uObj ? uObj.username : ''})\n`;
                    });
                    reportMsg += `\n🔄 _Spam berlanjut setiap ${label} untuk sisa target._`;
                } else {
                    reportMsg += `_- Semua target selesai total! -\n_\n🎉 **Pengingat ID #${targetMsgId} dihentikan dan dihapus otomatis.**`;
                }

                // Kirim Foto Bukti beserta laporan teks langsung ke pembuat pesan (sId)
                bot.telegram.sendPhoto(sId, photoId, {
                    caption: reportMsg,
                    parse_mode: 'Markdown'
                }).catch(e => console.error("Gagal mengirim foto bukti ke pembuat pesan:", e));

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
cron.schedule('*/1 * * * *', () => {
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

                    // Mengamankan karakter '@' atau '_' pada username agar tidak merusak Markdown tagihan
                    const safeCreatorUsername = creatorUsername.replace(/_/g, '\\_');

                    // 1. KIRIM SPAM KE TARGET (DITAMBAHKAN NAMA PEMBUAT)
                    schedule.targets.forEach((targetId) => {
                        let spamMsg = `🔔 *[ PENGINGAT / TAGIHAN ]*\n\n`;
                        spamMsg += `👤 *Dari Pembuat:* ${creatorName}${safeCreatorUsername}\n`;
                        spamMsg += `📝 *Pesan:* ${schedule.messageText}\n\n`;
                        spamMsg += `💡 Ketik \`/done\` lalu inputkan ID pesan *${schedule.id}* jika tugas Anda sudah selesai.`;

                        bot.telegram.sendMessage(targetId, spamMsg, { parse_mode: 'Markdown' })
                            .catch((err) => console.error(`Gagal kirim ke ${targetId}:`, err.message));
                    });

                    // 2. KIRIM LAPORAN BERKALA KE SENDER
                    const label = match ? `${match[1]} ${match[2] === 'm' ? 'Menit' : 'Jam'}` : '4 Jam';
                    let reportMsg = `📊 **LAPORAN BERKALA PESAN ID #${schedule.id} (Tiap ${label})**\n\n`;
                    reportMsg += `📝 **Isi Teks:** "${schedule.messageText}"\n\n`;

                    reportMsg += `✅ **Sudah Done:**\n`;
                    if (schedule.doneTargets.length > 0) {
                        schedule.doneTargets.forEach((t, idx) => reportMsg += `${idx + 1}. ${t.name}\n`);
                    } else {
                        reportMsg += `_- Belum ada -\n_`;
                    }

                    reportMsg += `\n⏳ **Belum Done (Masih Di-spam):**\n`;
                    schedule.targets.forEach((targetId, idx) => {
                        const uObj = db.users.find(u => u.id === targetId);
                        reportMsg += `${idx + 1}. ${uObj ? uObj.first_name : 'User'}\n`;
                    });

                    bot.telegram.sendMessage(senderId, reportMsg, { parse_mode: 'Markdown' }).catch(e => console.error(e));
                }
            }
        });
    });

    if (isDbChanged) {
        writeDB(db);
    }
});

console.log('⏳ [Step 4/4] Menghubungkan ke API Telegram...');

// ==================== RUN BOT ====================
try {
    bot.launch().then(() => {
        console.log('\n🚀 BINGO! Bot "Sang Penagih" Multi-Instance Aktif Berjalan Sempurna.');
    }).catch((err) => {
        console.error('\n❌ Gagal saat melakukan bot.launch():', err.message);
    });
} catch (globalLaunchError) {
    console.error('\n❌ Terjadi error fatal saat booting:', globalLaunchError.message);
}

process.on('unhandledRejection', (reason) => console.error('⚠️ Async Reject:', reason));
process.on('uncaughtException', (error) => console.error('⚠️ System Error:', error.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));