const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('baileys');
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ KONFIGURASI ============
const MESSAGE = `Abang Abang kakak kakak yang mau nonton anime , drama cina , atau komik manga bisa di sini yah 😃
Aku buat web stream anime aku sendiriii
Memenesia.web.id`;

// Grup yang DIKECUALIKAN (tidak akan dikirimi pesan)
const EXCLUDED_GROUPS = [
    'MAHASISWA SISTEM INFORMASI UNIBA',
    'PROSES BISNIS 3 SKS SMT 3',
    'PANCASILA SI',
    'Himpunan Mahasiswa Si tahun 2024-2025',
    'PEMOGRAMAN WEB',
    'Makul-IMK',
    'Administrasi Mahasiswa Sistem Informasi',
    'SIM EMABATAM',
    'Kelompok 1 matkul pancasila',
    'Kelompok 7 pak Sigid',
    'Universitas Batam'
];

// ============ STATE ============
let sock = null;
let isConnected = false;
let qrCode = null;
let groups = [];
let postHistory = [];
let lastError = null;

// Load history
const HISTORY_FILE = path.join(__dirname, 'history.json');
if (fs.existsSync(HISTORY_FILE)) {
    try {
        postHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {
        postHistory = [];
    }
}

function saveHistory() {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(postHistory, 2));
}

// ============ WHATSAPP CONNECTION ============
async function connectWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['Memenesia Bot', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: false,
        fireInitQueries: false,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        appStateMacVerification: {
            patch: false,
            snapshot: false
        },
        shouldIgnoreJid: jid => jid?.includes('broadcast') || jid?.includes('status'),
        generateHighQualityLinkPreview: false
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCode = qr;
            console.log('📱 QR Code received! Scan di dashboard: http://localhost:' + PORT);
        }
        
        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log('❌ Connection closed. Status:', statusCode);
            lastError = `Disconnected: ${statusCode}`;
            
            if (shouldReconnect) {
                console.log('🔄 Reconnecting...');
                setTimeout(connectWhatsApp, 5000);
            } else {
                console.log('⚠️ Logged out. Delete auth_info folder and restart.');
            }
        } else if (connection === 'open') {
            isConnected = true;
            qrCode = null;
            lastError = null;
            console.log('✅ WhatsApp Connected!');
            
            // Load groups after connection
            setTimeout(loadGroups, 3000);
        }
    });
}

async function loadGroups() {
    if (!isConnected || !sock) return;
    
    try {
        const result = await sock.groupFetchAllParticipating();
        const allGroups = Object.values(result);
        
        // Filter excluded groups
        groups = allGroups.filter(g => {
            const name = g.subject || '';
            return !EXCLUDED_GROUPS.some(ex => 
                name.toLowerCase().includes(ex.toLowerCase())
            );
        });
        
        console.log(`📋 Found ${allGroups.length} groups total`);
        console.log(`✅ Target groups: ${groups.length}`);
        console.log(`🚫 Excluded: ${allGroups.length - groups.length}`);
        
    } catch (error) {
        console.error('Error loading groups:', error.message);
        lastError = error.message;
    }
}

// ============ SEND TO GROUPS ============
async function sendToGroups() {
    if (!isConnected || !sock) {
        console.log('❌ Not connected!');
        return { success: false, error: 'Not connected' };
    }
    
    // Reload groups to detect new ones
    await loadGroups();
    
    if (groups.length === 0) {
        console.log('❌ No target groups!');
        return { success: false, error: 'No groups' };
    }
    
    const results = [];
    const timestamp = new Date().toISOString();
    
    console.log(`\n📤 Sending to ${groups.length} groups...`);
    
    for (const group of groups) {
        try {
            // Check if image exists
            const imagePath = path.join(__dirname, 'anime.jpg');
            
            if (fs.existsSync(imagePath)) {
                // Send image with caption
                await sock.sendMessage(group.id, {
                    image: fs.readFileSync(imagePath),
                    caption: MESSAGE
                });
            } else {
                // Send text only
                await sock.sendMessage(group.id, { text: MESSAGE });
            }
            
            console.log(`✅ ${group.subject}`);
            results.push({ group: group.subject, success: true });
            
            // Delay to avoid spam detection
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
            
        } catch (error) {
            console.log(`❌ ${group.subject}: ${error.message}`);
            results.push({ group: group.subject, success: false, error: error.message });
        }
    }
    
    // Save to history
    const historyEntry = {
        timestamp,
        groupCount: groups.length,
        successCount: results.filter(r => r.success).length,
        results
    };
    postHistory.unshift(historyEntry);
    postHistory = postHistory.slice(0, 50); // Keep last 50
    saveHistory();
    
    console.log(`\n✅ Done! ${historyEntry.successCount}/${groups.length} success`);
    
    return { success: true, results };
}

// ============ SCHEDULE: Every 5 hours ============
// 00:00, 05:00, 10:00, 15:00, 20:00 WIB
cron.schedule('0 0,5,10,15,20 * * *', async () => {
    console.log('\n⏰ Scheduled post triggered!');
    await sendToGroups();
}, {
    timezone: 'Asia/Jakarta'
});

// ============ DASHBOARD ============
app.get('/', (req, res) => {
    res.send(getDashboardHTML());
});

// Keep alive endpoint for UptimeRobot
app.get('/health', (req, res) => {
    res.json({ 
        status: isConnected ? 'connected' : 'disconnected',
        groups: groups.length,
        uptime: process.uptime()
    });
});

// API to test send
app.post('/test', async (req, res) => {
    const result = await sendToGroups();
    res.json(result);
});

// Get QR code
app.get('/qr', (req, res) => {
    if (qrCode) {
        const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`;
        res.json({ qr: qrImage, raw: qrCode });
    } else if (isConnected) {
        res.json({ connected: true });
    } else {
        res.json({ waiting: true });
    }
});

// Get groups
app.get('/groups', (req, res) => {
    res.json({
        total: groups.length,
        groups: groups.map(g => ({ id: g.id, name: g.subject }))
    });
});

// Get history
app.get('/history', (req, res) => {
    res.json(postHistory);
});

function getDashboardHTML() {
    const groupsList = groups.map(g => `<li>✅ ${g.subject}</li>`).join('');
    const historyList = postHistory.slice(0, 10).map(h => {
        const date = new Date(h.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        return `<li>📤 ${date} - ${h.successCount}/${h.groupCount} success</li>`;
    }).join('') || '<li>Belum ada riwayat</li>';
    
    const nextSchedule = getNextSchedule();
    
    return `<!DOCTYPE html>
<html>
<head>
    <title>WhatsApp Bot - Memenesia</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="30">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            font-family: 'Segoe UI', sans-serif; 
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            color: #fff;
            padding: 20px;
        }
        .container { max-width: 900px; margin: 0 auto; }
        h1 { 
            text-align: center; 
            margin-bottom: 30px;
            font-size: 2em;
            text-shadow: 0 0 20px rgba(0,255,136,0.5);
        }
        .status-card {
            background: rgba(255,255,255,0.1);
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
        }
        .status { 
            font-size: 1.5em; 
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .connected { color: #00ff88; }
        .disconnected { color: #ff4757; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
        .card {
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 20px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .card h3 { 
            color: #00ff88; 
            margin-bottom: 15px;
            font-size: 1.1em;
        }
        ul { list-style: none; }
        li { 
            padding: 8px 0; 
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.9em;
        }
        .btn {
            background: linear-gradient(135deg, #00ff88, #00cc6a);
            color: #000;
            border: none;
            padding: 15px 40px;
            border-radius: 30px;
            font-size: 1.1em;
            font-weight: bold;
            cursor: pointer;
            display: block;
            margin: 30px auto;
            transition: all 0.3s;
        }
        .btn:hover { 
            transform: scale(1.05);
            box-shadow: 0 0 30px rgba(0,255,136,0.5);
        }
        .btn:disabled {
            background: #666;
            cursor: not-allowed;
        }
        .qr-container {
            text-align: center;
            padding: 20px;
        }
        .qr-container img {
            max-width: 250px;
            border-radius: 10px;
            background: white;
            padding: 10px;
        }
        .schedule {
            background: rgba(0,255,136,0.1);
            padding: 15px;
            border-radius: 10px;
            text-align: center;
            margin-top: 15px;
        }
        .uptime {
            color: #888;
            text-align: center;
            margin-top: 20px;
            font-size: 0.85em;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 WhatsApp Bot - Memenesia</h1>
        
        <div class="status-card">
            <div class="status ${isConnected ? 'connected' : 'disconnected'}">
                ${isConnected ? '🟢 CONNECTED' : '🔴 DISCONNECTED'}
                ${isConnected ? `<span style="font-size:0.6em;color:#888"> | ${groups.length} groups</span>` : ''}
            </div>
            ${lastError ? `<p style="color:#ff4757;margin-top:10px">Error: ${lastError}</p>` : ''}
            
            <div class="schedule">
                <strong>📅 Schedule:</strong> Every 5 hours (00:00, 05:00, 10:00, 15:00, 20:00 WIB)<br>
                <strong>⏰ Next:</strong> ${nextSchedule}
            </div>
        </div>
        
        ${!isConnected && qrCode ? `
        <div class="status-card qr-container">
            <h3>📱 Scan QR Code dengan WhatsApp</h3>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}" alt="QR Code">
            <p style="margin-top:15px;color:#888">Buka WhatsApp > Menu > Linked Devices > Link a Device</p>
        </div>
        ` : ''}
        
        <div class="grid">
            <div class="card">
                <h3>📋 Target Groups (${groups.length})</h3>
                <ul style="max-height:300px;overflow-y:auto">
                    ${groupsList || '<li>Belum ada grup</li>'}
                </ul>
            </div>
            <div class="card">
                <h3>📜 Recent Posts</h3>
                <ul>
                    ${historyList}
                </ul>
            </div>
        </div>
        
        <button class="btn" onclick="testPost()" ${!isConnected ? 'disabled' : ''}>
            🚀 TEST POST NOW
        </button>
        
        <div class="uptime">
            Uptime: ${formatUptime(process.uptime())} | 
            <a href="/health" style="color:#00ff88">Health Check</a>
        </div>
    </div>
    
    <script>
        async function testPost() {
            if (!confirm('Send to all groups now?')) return;
            const btn = document.querySelector('.btn');
            btn.disabled = true;
            btn.textContent = '⏳ Sending...';
            
            try {
                const res = await fetch('/test', { method: 'POST' });
                const data = await res.json();
                alert(data.success ? 'Success! Check history.' : 'Failed: ' + data.error);
            } catch(e) {
                alert('Error: ' + e.message);
            }
            
            location.reload();
        }
    </script>
</body>
</html>`;
}

function getNextSchedule() {
    const now = new Date();
    const hours = [0, 5, 10, 15, 20];
    const jakartaOffset = 7 * 60; // WIB = UTC+7
    const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
    const jakartaNow = new Date(utcNow + (jakartaOffset * 60000));
    
    const currentHour = jakartaNow.getHours();
    const currentMinute = jakartaNow.getMinutes();
    
    let nextHour = hours.find(h => h > currentHour) || hours[0];
    let nextDate = new Date(jakartaNow);
    
    if (nextHour <= currentHour) {
        nextDate.setDate(nextDate.getDate() + 1);
    }
    nextDate.setHours(nextHour, 0, 0, 0);
    
    return nextDate.toLocaleString('id-ID', { 
        weekday: 'short',
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
    }) + ' WIB';
}

function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
}

// ============ START ============
app.listen(PORT, () => {
    console.log(`\n🌐 Dashboard: http://localhost:${PORT}`);
    console.log('📱 Health check: http://localhost:' + PORT + '/health');
    console.log('\n🔌 Connecting to WhatsApp...\n');
    connectWhatsApp();
});
