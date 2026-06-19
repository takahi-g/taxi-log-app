/**
 * TAXI Log Pro - Core Logic v2.5 (Refactored)
 * -------------------------------------------
 * concerns: State Management, UI Sync, Geolocation, API Services
 */

// --- 1. CONFIG & STATE ---
const CONFIG = {
    MAX_LOGS: 100,
    GPS_TIMEOUT: 10000,
    TRACKING_INTERVAL: 60000,
    DUMMY_COORDS: [33.5002, 130.5168] // 二日市駅
};

const state = {
    logs: safeJSON('taxi_logs', []),
    moveLogs: safeJSON('move_logs', []),
    currentRide: safeJSON('current_ride', null),
    trackingIntervalId: null,
    map: null,
    mapLayers: { markers: [], path: null, rideLines: [] },
    counts: { total: 1, men: 0, women: 0 }
};

// --- 2. UTILITIES ---
function safeJSON(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : fallback;
    } catch (e) { return fallback; }
}

const UI = {
    get: (id) => document.getElementById(id),
    render: (id, html) => { const el = UI.get(id); if (el) el.innerHTML = html; },
    show: (id, visible = true) => { const el = UI.get(id); if (el) el.style.display = visible ? 'block' : 'none'; },
    active: (id, isActive = true) => { const el = UI.get(id); if (el) el.classList.toggle('active', isActive); }
};

const Formatter = {
    time: (date) => new Date(date).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    currency: (val) => `¥${Number(val).toLocaleString()}`
};

// --- 3. GEO & ADDRESS SERVICE ---
const GeoService = {
    async getAddress(lat, lon) {
        try {
            const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, { headers: { 'Accept-Language': 'ja' } });
            const d = await r.json();
            const a = d.address;
            if (!a) return "住所詳細不明";
            return `${a.city || a.town || a.village || ""}${a.suburb || a.neighbourhood || ""}${a.road || ""}${a.house_number || ""}` || "不明な住所";
        } catch (e) { return `${lat.toFixed(4)}, ${lon.toFixed(4)}`; }
    },
    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: CONFIG.GPS_TIMEOUT });
        });
    }
};

// --- 4. CORE ACTIONS ---
async function handleMainAction() {
    const btn = UI.get('main-log-btn');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    UI.render('btn-text', '⌛ 位置取得中...');

    try {
        const pos = await GeoService.getCurrentPosition();
        const { latitude: lat, longitude: lon } = pos.coords;
        const now = new Date().toISOString();

        if (!state.currentRide) {
            // --- 乗車 ---
            state.currentRide = {
                pickup: { address: '取得中...', lat, lon, time: now },
                pax: { ...state.counts }
            };
            localStorage.setItem('current_ride', JSON.stringify(state.currentRide));
            updateAppView();
            
            GeoService.getAddress(lat, lon).then(addr => {
                if (state.currentRide) {
                    state.currentRide.pickup.address = addr;
                    localStorage.setItem('current_ride', JSON.stringify(state.currentRide));
                    UI.render('address-text', `乗車: ${addr}`);
                }
            });
        } else {
            // --- 降車 ---
            const fare = parseInt(UI.get('fare-input').value) || 0;
            const newLog = {
                id: Date.now(),
                pickup: state.currentRide.pickup,
                dropoff: { address: '取得中...', lat, lon, time: now },
                pax: state.currentRide.pax,
                fare
            };

            state.logs.unshift(newLog);
            localStorage.setItem('taxi_logs', JSON.stringify(state.logs.slice(0, CONFIG.MAX_LOGS)));
            
            const logId = newLog.id;
            // リセット
            state.currentRide = null;
            state.counts = { total: 1, men: 0, women: 0 }; // カウントをリセット
            localStorage.removeItem('current_ride');
            if (fareInput) fareInput.value = "";
            
            updateAppView();
            UI.render('men-count', 0);
            UI.render('women-count', 0);
            addrEl.textContent = "目的地でお客さんを降ろしました";

            GeoService.getAddress(lat, lon).then(addr => {
                const target = state.logs.find(l => l.id === logId);
                if (target) {
                    target.dropoff.address = addr;
                    localStorage.setItem('taxi_logs', JSON.stringify(state.logs));
                    renderHistory();
                }
            });
        }
    } catch (e) {
        alert("GPSが取得できませんでした。");
    } finally {
        btn.disabled = false;
        updateAppView();
    }
}

// --- 5. UI SYNCING ---
function updateAppView() {
    const isRiding = !!state.currentRide;
    const btn = UI.get('main-log-btn');
    if (!btn) return;

    // View Switching
    btn.className = `main-action-btn ${isRiding ? 'dropoff' : 'pickup'}`;
    UI.render('main-log-btn', isRiding ? 
        `<span id="btn-icon">🏁</span> <span id="btn-text">降車（記録完了・売上）</span>` : 
        `<span id="btn-icon">🚖</span> <span id="btn-text">乗車（記録開始）</span>`
    );
    UI.show('fare-container', isRiding);
    
    if (isRiding) {
        UI.render('address-text', `乗車中: ${state.currentRide.pickup.address}`);
    } else {
        UI.render('address-text', `目的地でお客さんを降ろしましょう`);
    }
    renderHistory();
}

function renderHistory() {
    if (state.logs.length === 0) {
        UI.render('history-list', '<div class="empty-state">履歴はまだありません</div>');
        return;
    }

    const html = state.logs.slice(0, 10).map(log => `
        <div class="history-item">
            <div class="history-info">
                <span class="time">${Formatter.time(log.dropoff.time)} <span class="fare-tag">${Formatter.currency(log.fare)}</span></span>
                <span class="addr">自: ${log.pickup.address}</span>
                <span class="addr">至: ${log.dropoff.address}</span>
            </div>
            <div class="pax-badge">
                <span class="men">♂${log.pax.men}</span>
                <span class="women">♀${log.pax.women}</span>
            </div>
        </div>
    `).join('');
    UI.render('history-list', html);
}

// --- 6. MAP LOGIC ---
function initOrUpdateMap() {
    if (!state.map) {
        state.map = L.map('log-map').setView(CONFIG.DUMMY_COORDS, 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OS' }).addTo(state.map);
    }

    // 清掃
    state.mapLayers.markers.forEach(m => state.map.removeLayer(m));
    state.mapLayers.rideLines.forEach(l => state.map.removeLayer(l));
    if (state.mapLayers.path) state.map.removeLayer(state.mapLayers.path);
    state.mapLayers.markers = [];
    state.mapLayers.rideLines = [];

    // トリップ描画
    state.logs.forEach(log => {
        if (!log.pickup || !log.dropoff) return;
        const start = L.circleMarker([log.pickup.lat, log.pickup.lon], { color: 'gold', radius: 5, fillOpacity: 0.8 }).addTo(state.map);
        const end = L.circleMarker([log.dropoff.lat, log.dropoff.lon], { color: '#ef4444', radius: 5, fillOpacity: 0.8 }).addTo(state.map);
        const line = L.polyline([[log.pickup.lat, log.pickup.lon], [log.dropoff.lat, log.dropoff.lon]], { color: 'white', weight: 1, dashArray: '5, 8', opacity: 0.5 }).addTo(state.map);
        state.mapLayers.markers.push(start, end);
        state.mapLayers.rideLines.push(line);
    });

    if (state.moveLogs.length > 1) {
        state.mapLayers.path = L.polyline(state.moveLogs.map(m => [m.lat, m.lon]), { color: '#3b82f6', weight: 3, opacity: 0.4 }).addTo(state.map);
    }

    setTimeout(() => {
        state.map.invalidateSize();
        if (state.mapLayers.markers.length > 0) {
            state.map.fitBounds(new L.featureGroup(state.mapLayers.markers).getBounds().pad(0.2));
        }
    }, 200);
}

// --- 7. ECO SYSTEM & EVENTS ---
function setupEventListeners() {
    UI.get('main-log-btn')?.addEventListener('click', handleMainAction);
    
    UI.get('tracking-toggle')?.addEventListener('change', (e) => {
        if (e.target.checked) startTracking(); else stopTracking();
    });

    ['log', 'map', 'settings'].forEach(tab => {
        UI.get(`tab-${tab}`)?.addEventListener('click', () => {
            document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            UI.active(`view-${tab}`);
            UI.active(`tab-${tab}`);
            if (tab === 'map') initOrUpdateMap();
        });
    });
}

function startTracking() {
    stopTracking();
    state.trackingIntervalId = setInterval(() => {
        navigator.geolocation.getCurrentPosition(pos => {
            state.moveLogs.push({ time: new Date().toISOString(), lat: pos.coords.latitude, lon: pos.coords.longitude });
            localStorage.setItem('move_logs', JSON.stringify(state.moveLogs.slice(-1000)));
        });
    }, CONFIG.TRACKING_INTERVAL);
}

function stopTracking() { if (state.trackingIntervalId) clearInterval(state.trackingIntervalId); }

function changeCount(type, delta) {
    state.counts[type] = Math.max(0, state.counts[type] + delta);
    UI.render(`${type}-count`, state.counts[type]);
    
    // 合計を自動更新
    state.counts.total = state.counts.men + state.counts.women;
}

// --- 8. BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
    setInterval(() => UI.render('live-clock', new Date().toLocaleTimeString('ja-JP', { hour12: false })), 1000);
    setupEventListeners();
    updateAppView();
    if ("geolocation" in navigator) {
        const s = UI.get('gps-status');
        if (s) { s.textContent = "GPS 有効"; s.style.color = "#10b981"; }
    }
});

// Settings
function clearData() { if (confirm("全消去しますか？")) { localStorage.clear(); location.reload(); } }
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.logs));
    const a = document.createElement('a'); a.href = dataStr; a.download = `taxi_log_${Date.now()}.json`; a.click();
}
