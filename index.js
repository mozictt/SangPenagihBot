// Panggil dotenv di baris paling atas agar env terisi sebelum bot berjalan
require('dotenv').config();

const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

console.log('⏳ [Step 1/4] Memulai inisialisasi konfigurasi...');

// ==================== KONFIGURASI ====================
// Mengambil token dari environment variable
const BOT_TOKEN = process.env.BOT_TOKEN;

// Validasi ketat untuk Node.js v24 agar bot tidak diam jika token kosong
if (!BOT_TOKEN) {
    console.error('❌ ERROR FATAL: BOT_TOKEN tidak ditemukan di file .env!');
    process.exit(1);
}
// =====================================================

const bot = new Telegraf(BOT_TOKEN);
const DB_FILE = path.join(__dirname, 'database_v2.json');

const defaultData = {
    users: [],
    schedules: {}    // Struktur baru di dalam: { senderId: [ { id: 1, messageText: '', targets: [], doneTargets: [], cronInterval: '4h', lastSent: 0 } ] }
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

    ctx.reply(
        `👋 Selamat datang ${from.first_name}!\n\n` +
        `Bot ini mendukung multi-pesan aktif! Berikut perintahnya:\n` +
        `1. Ketik /users untuk melihat daftar nomor pengguna bot.\n` +
        `2. Ketik /setpesan [isi pesan] untuk membuat pengingat baru.\n` +
        `3. Ketik /setwaktu [id_pesan] [jeda] untuk atur waktu (Contoh: /setwaktu 1 15m).\n` +
        `4. Ketik /settarget [id_pesan] [nomor] untuk target (Contoh: /settarget 1 1,2).\n` +
        `5. Ketik /status untuk melihat semua daftar pengingat aktif Anda.\n\n` +
        `6. Ketik /delpesan [id_pesan] untuk menghapus pengingat yang tidak jadi dipakai.\n\n` +
        `💡 *Info untuk Target:* Jika tugas selesai, balas dengan \`/done [id_pesan]\` (Contoh: /done 1)`
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

bot.command('setpesan', (ctx) => {
    const senderId = ctx.from.id;
    const text = ctx.message.text.replace('/setpesan ', '').trim();

    if (!text || text === '/setpesan') {
        return ctx.reply("⚠️ Format salah. Contoh: /setpesan Tolong review codingan Modul A");
    }

    const db = readDB();

    if (!db.schedules[senderId]) {
        db.schedules[senderId] = [];
    }

    // Tentukan ID baru (auto increment berdasarkan data user tersebut)
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

    ctx.replyWithMarkdown(`✅ Pesan baru berhasil dibuat dengan **ID: ${newId}**\n\n💬 Pesan: "${text}"\n\n⏱️ _Default jeda: 4 jam. Silakan atur target menggunakan perintah:_\n\`/settarget ${newId} [nomor_user]\``);
});

bot.command('setwaktu', (ctx) => {
    const senderId = ctx.from.id;
    const args = ctx.message.text.replace('/setwaktu ', '').trim().split(' ');

    if (args.length < 2 || args[0] === '/setwaktu') {
        return ctx.reply("⚠️ Format salah. Contoh: /setwaktu 1 30m (Artinya: Pesan ID 1 di-set tiap 30 menit) atau /setwaktu 2 4h");
    }

    const targetMsgId = parseInt(args[0]);
    const timeInput = args[1].toLowerCase();
    const match = timeInput.match(/^(\d+)(m|h)$/);

    if (!match) {
        return ctx.reply("⚠️ Format waktu harus berupa angka diikuti 'm' (menit) atau 'h' (jam). Contoh: 15m, 2h");
    }

    const db = readDB();
    const userSchedules = db.schedules[senderId] || [];
    const schedule = userSchedules.find(s => s.id === targetMsgId);

    if (!schedule) {
        return ctx.reply(`❌ Pengingat dengan ID ${targetMsgId} tidak ditemukan. Cek list di /status`);
    }

    schedule.cronInterval = timeInput;
    writeDB(db);

    const timeLabel = match[2] === 'm' ? 'Menit' : 'Jam';
    ctx.replyWithMarkdown(`✅ Jeda untuk Pesan **ID: ${targetMsgId}** berhasil diatur menjadi setiap: *${match[1]} ${timeLabel}*`);
});

bot.command('settarget', (ctx) => {
    const senderId = ctx.from.id;
    const args = ctx.message.text.replace('/settarget ', '').trim().split(' ');

    if (args.length < 2 || args[0] === '/settarget') {
        return ctx.reply("⚠️ Format salah. Contoh: /settarget 1 1,2 (Artinya: Pesan ID 1 ditargetkan ke user nomor 1 dan 2)");
    }

    const targetMsgId = parseInt(args[0]);
    const targetInput = args[1];

    const db = readDB();
    const userSchedules = db.schedules[senderId] || [];
    const schedule = userSchedules.find(s => s.id === targetMsgId);

    if (!schedule) {
        return ctx.reply(`❌ Pengingat dengan ID ${targetMsgId} tidak ditemukan.`);
    }

    const choices = targetInput.split(',').map(num => parseInt(num.trim()) - 1);

    schedule.targets = [];
    schedule.doneTargets = [];
    schedule.lastSent = Date.now(); // Mulai hitung mundur pengiriman dari sekarang

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

    writeDB(db);

    if (targetNames.length > 0) {
        const match = schedule.cronInterval.match(/^(\d+)(m|h)$/);
        const label = match ? `${match[1]} ${match[2] === 'm' ? 'Menit' : 'Jam'}` : '4 Jam';
        ctx.replyWithMarkdown(`🎯 Pesan **ID: ${targetMsgId}** berhasil diseting menuju: ${targetNames.join(', ')}\nBot mulai mengirim berkala tiap *${label}*.`);
    } else {
        ctx.reply("❌ Nomor urut user salah. Cek daftar nomor di `/users`.");
    }
});

bot.command('delpesan', (ctx) => {
    const senderId = ctx.from.id;
    const text = ctx.message.text.replace('/delpesan ', '').trim();

    if (!text || text === '/delpesan') {
        return ctx.reply("⚠️ Format salah. Contoh: /delpesan 1 (Artinya: Menghapus pengingat dengan ID 1)");
    }

    const targetMsgId = parseInt(text);
    if (isNaN(targetMsgId)) {
        return ctx.reply("⚠️ ID Pesan harus berupa angka. Contoh: /delpesan 1");
    }

    const db = readDB();
    const userSchedules = db.schedules[senderId] || [];

    // Cari index pesan yang ingin dihapus
    const scheduleIndex = userSchedules.findIndex(s => s.id === targetMsgId);

    if (scheduleIndex === -1) {
        return ctx.reply(`❌ Pengingat dengan ID ${targetMsgId} tidak ditemukan dalam daftar aktif Anda. Cek di /status`);
    }

    // Ambil teks pesan sekadar untuk konfirmasi di reply
    const deletedMessageText = userSchedules[scheduleIndex].messageText;

    // Hapus dari array schedules milik user
    db.schedules[senderId].splice(scheduleIndex, 1);
    writeDB(db);

    ctx.replyWithMarkdown(`🗑️ **Pengingat ID #${targetMsgId} Berhasil Dihapus!**\n\n💬 Teks pesan sebelumnya:\n_"${deletedMessageText}"_\n\nStatus antrean dibersihkan dan bot berhenti mengirim pesan ini.`);
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

// ==================== RESPONSE DONE BERDASARKAN ID PESAN ====================

bot.hears(/^\/(done)\s+(\d+)$/, (ctx) => {
    const targetId = ctx.chat.id;
    const targetName = ctx.from.first_name;
    const targetUsername = ctx.from.username ? `@${ctx.from.username}` : 'Tanpa Username';
    const targetMsgId = parseInt(ctx.match[2]);

    const db = readDB();
    let updated = false;
    let senderToNotify = null;

    Object.keys(db.schedules).forEach((senderId) => {
        // Cari schedule spesifik milik sender yang memiliki ID pesan tersebut
        const scheduleIndex = db.schedules[senderId].findIndex(s => s.id === targetMsgId);

        if (scheduleIndex !== -1) {
            const schedule = db.schedules[senderId][scheduleIndex];
            const index = schedule.targets.indexOf(targetId);

            if (index !== -1) {
                schedule.targets.splice(index, 1);
                schedule.doneTargets.push({ id: targetId, name: targetName, username: targetUsername });
                updated = true;
                senderToNotify = senderId;

                const match = schedule.cronInterval.match(/^(\d+)(m|h)$/);
                const label = match ? `${match[1]} ${match[2] === 'm' ? 'Menit' : 'Jam'}` : '4 Jam';

                // Buat Laporan Info Cepat Realtime
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

                // Jika target habis, hapus elemen pesan ini dari array antrean milik sender
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

// Fallback untuk yang typo ketik 'done' tanpa ID
bot.hears(/^(done|Done|DONE)$/, (ctx) => {
    ctx.reply("💡 Untuk menyelesaikan antrean pesan, gunakan format: `/done [id_pesan]`\nContoh: `/done 1`\n\nAnda bisa melihat daftar ID pesan aktif pada info laporan berkala.");
});

console.log('⏳ [Step 3/4] Mengaktifkan mesin checker dinamis (Tiap 1 Menit)...');

// ==================== ENGINE CHECKER DINAMIS ENGINE V3 ====================
cron.schedule('*/1 * * * *', () => {
    const db = readDB();
    const now = Date.now();
    let isDbChanged = false;

    Object.keys(db.schedules).forEach((senderId) => {
        // Melakukan perulangan di dalam array multi-pesan milik sender
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

                    // 1. Spam pesan ke sisa target
                    schedule.targets.forEach((targetId) => {
                        bot.telegram.sendMessage(targetId, `[PENGINGAT ID: ${schedule.id}]\n\n${schedule.messageText}\n\n💡 Ketik \`/done ${schedule.id}\` jika sudah selesai.`, { parse_mode: 'Markdown' })
                            .catch((err) => console.error(`Gagal kirim ke ${targetId}:`, err.message));
                    });

                    // 2. Kirim laporan berkala ke sender
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