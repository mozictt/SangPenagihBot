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
        `Bot ini dirancang untuk mengirimkan pesan pengingat secara berkala kepada target sampai mereka merespons \`/done\`.\n\n` +
        `📌 *DAFTAR PERINTAH UTAMA (Interaktif):*\n` +
        `🎵 \`/users\` — Melihat daftar nomor urut pengguna bot.\n` +
        `📝 \`/setpesan\` — Membuat teks pengingat baru.\n` +
        `⏱️ \`/setwaktu\` — Mengatur jeda waktu pengiriman ulang pesan.\n` +
        `🎯 \`/settarget\` — Memilih target pengguna yang akan dikirimi pesan.\n` +
        `📊 \`/status\` — Meninjau semua daftar antrean pengingat aktif Anda.\n` +
        `🗑️ \`/delpesan\` — Menghapus pesan pengingat tertentu.\n\n` +
        `💡 *Info Penting untuk Penerima Target:* \n` +
        `Jika tugas dari pesan terkait sudah selesai dilakukan, Anda wajib membalas dengan mengetik:\n` +
        `➡️ \`/done [id_pesan]\` *(Contoh: \`/done 1\`)*`
    );
});

// ==================== PENGATURAN SENDER ====================

bot.command('users', (ctx) => {
    const db = readDB();
    if (db.users.length === 0) {
        return ctx.reply("Belum ada user yang terdaftar di bot ini.");
    }

    let response = "📋 **Daftar Seluruh Pengguna Bot:**\n\n";
    db.users.forEach((user, index) => {
        response += `${index + 1}. ${user.first_name} (${user.username})\n`;
    });
    response += "\n💡 Gunakan nomor urut di atas saat menyeting target di `/settarget`.";

    ctx.replyWithMarkdown(response);
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

// REVISI SEKARANG: /delpesan interaktif Tahap 1 (Meminta ID Pesan)
bot.command('delpesan', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = 'MENUNGGU_ID_HAPUS';
    ctx.reply("🗑️ Silahkan pilih id pesan:");
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

    // REVISI SEKARANG: 6. STATE: Menerima ID Pesan untuk Dihapus (/delpesan Tahap 2 - Final)
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

        // Reset state setelah berhasil dihapus
        ctx.session.state = null;

        return ctx.replyWithMarkdown(`🗑️ **Pengingat ID #${targetMsgId} Berhasil Dihapus!**\n\n💬 Teks pesan sebelumnya:\n_"${deletedMessageText}"_\n\nStatus antrean dibersihkan dan bot berhenti mengirim pesan ini.`);
    }

    return next();
});

// ==================== RESPONSE DONE BERDASARKAN ID PESAN ====================

bot.hears(/^\/(done)\s+(\d+)$/, (ctx) => {
    const targetId = ctx.chat.id;
    const targetName = ctx.from.first_name;
    const targetUsername = ctx.from.username ? `@${ctx.from.username}` : 'Tanpa Username';
    const targetMsgId = parseInt(ctx.match[2]);

    const db = readDB();
    let updated = false;

    Object.keys(db.schedules).forEach((senderId) => {
        const scheduleIndex = db.schedules[senderId].findIndex(s => s.id === targetMsgId);

        if (scheduleIndex !== -1) {
            const schedule = db.schedules[senderId][scheduleIndex];
            const index = schedule.targets.indexOf(targetId);

            if (index !== -1) {
                schedule.targets.splice(index, 1);
                schedule.doneTargets.push({ id: targetId, name: targetName, username: targetUsername });
                updated = true;

                const match = schedule.cronInterval.match(/^(\d+)(m|h)$/);
                const label = match ? `${match[1]} ${match[2] === 'm' ? 'Menit' : 'Jam'}` : '4 Jam';

                let reportMsg = `🔔 **INFO CEPAT: TARGET MERESPON DONE (ID: ${targetMsgId})**\n\n`;
                reportMsg += `📝 **Isi Pesan:**\n_"${schedule.messageText}"_\n\n`;
                reportMsg += `✅ **Sudah Done:**\n`;
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

                bot.telegram.sendMessage(senderId, reportMsg, { parse_mode: 'Markdown' }).catch(e => console.error(e));

                if (schedule.targets.length === 0) {
                    db.schedules[senderId].splice(scheduleIndex, 1);
                }
            }
        }
    });

    if (updated) {
        writeDB(db);
        ctx.reply(`✅ Konfirmasi 'done' untuk pesan ID #${targetMsgId} berhasil diterima.`);
    } else {
        ctx.reply(`❌ Anda tidak terdaftar dalam antrean aktif untuk pesan ID #${targetMsgId}. Cek kembali nomor ID pesan.`);
    }
});

bot.hears(/^(done|Done|DONE)$/, (ctx) => {
    ctx.replyWithMarkdown("💡 Untuk menyelesaikan antrean pesan, gunakan format: `/done [id_pesan]`\nContoh: `/done 1`\n\nAnda bisa melihat daftar ID pesan aktif pada info laporan berkala.");
});

console.log('⏳ [Step 3/4] Mengaktifkan mesin checker dinamis (Tiap 1 Menit)...');

// ==================== ENGINE CHECKER DINAMIS ENGINE V3 ====================
cron.schedule('*/1 * * * *', () => {
    const db = readDB();
    const now = Date.now();
    let isDbChanged = false;

    Object.keys(db.schedules).forEach((senderId) => {
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

                    schedule.targets.forEach((targetId) => {
                        bot.telegram.sendMessage(targetId, `[PENGINGAT ID: ${schedule.id}]\n\n${schedule.messageText}\n\n💡 Ketik \`/done ${schedule.id}\` jika sudah selesai.`, { parse_mode: 'Markdown' })
                            .catch((err) => console.error(`Gagal kirim ke ${targetId}:`, err.message));
                    });

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