/**
 * TAXI Log Pro - Core Logic v3.0 (Editing Enabled)
 * -------------------------------------------
 */

// --- 1. CONFIG & STATE ---
const CONFIG = {
    MAX_LOGS: 100,
    GPS_TIMEOUT: 10000,
    TRACKING_INTERVAL: 30000,
    DUMMY_COORDS: [33.5002, 130.5168]
};

const state = {
    logs: safeJSON('taxi_logs', []),
    moveLogs: safeJSON('move_logs', []),
    currentRide: safeJSON('current_ride', null),
    trackingIntervalId: null,
    editingLogId: null, // 編集中のID
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
    show: (id, visible = true) => { const el = UI.get(id); if (el) el.style.display = visible ? 'flex' : 'none'; },
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
    const addrEl = UI.get('address-text');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    UI.render('btn-text', '⌛ 位置取得中...');

    try {
        const pos = await GeoService.getCurrentPosition();
        const { latitude: lat, longitude: lon } = pos.coords;
        const now = new Date().toISOString();

        if (!state.currentRide) {
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
                    UI.render('address-text', `目的地に向かいましょう`);
                }
            });
        } else {
            const fareInput = UI.get('fare-input');
            const fare = fareInput ? (parseInt(fareInput.value) || 0) : 0;
            const newLog = {
                id: Date.now(),
                pickup: state.currentRide.pickup,
                dropoff: { address: '取得中...', lat, lon, time: now },
                pax: { ...state.counts },
                fare
            };

            state.logs.unshift(newLog);
            localStorage.setItem('taxi_logs', JSON.stringify(state.logs.slice(0, CONFIG.MAX_LOGS)));
            
            const logId = newLog.id;
            state.currentRide = null;
            state.counts = { total: 1, men: 0, women: 0 }; 
            localStorage.removeItem('current_ride');
            if (fareInput) fareInput.value = "";
            
            updateAppView();
            UI.render('men-count', 0);
            UI.render('women-count', 0);
            if (addrEl) addrEl.textContent = "目的地でお客さんを降ろしました";

            GeoService.getAddress(lat, lon).then(addr => {
                const target = state.logs.find(l => l.id === logId);
                if (target) {
                    target.dropoff.address = addr;
                    try {
                        localStorage.setItem('taxi_logs', JSON.stringify(state.logs.slice(0, CONFIG.MAX_LOGS)));
                    } catch(e) { }
                    renderHistory();
                }
            });
        }
    } catch (e) {
        alert("エラー詳細: " + e.name + ": " + e.message);
    } finally {
        btn.disabled = false;
        updateAppView();
    }
}

// --- 5. EDIT MODE ACTIONS ---
function openEditModal(id) {
    const log = state.logs.find(l => l.id === id);
    if (!log) return;
    
    state.editingLogId = id;
    UI.get('edit-fare').value = log.fare;
    UI.get('edit-men').value = log.pax.men;
    UI.get('edit-women').value = log.pax.women;
    UI.show('edit-modal', true);
}

function closeEditModal() {
    UI.show('edit-modal', false);
    state.editingLogId = null;
}

function saveEdit() {
    const log = state.logs.find(l => l.id === state.editingLogId);
    if (log) {
        log.fare = parseInt(UI.get('edit-fare').value) || 0;
        log.pax.men = parseInt(UI.get('edit-men').value) || 0;
        log.pax.women = parseInt(UI.get('edit-women').value) || 0;
        log.pax.total = log.pax.men + log.pax.women;
        
        localStorage.setItem('taxi_logs', JSON.stringify(state.logs));
        renderHistory();
    }
    closeEditModal();
}

// --- 6. UI SYNCING ---
function updateAppView() {
    const isRiding = !!state.currentRide;
    const btn = UI.get('main-log-btn');
    if (!btn) return;

    btn.className = `main-action-btn ${isRiding ? 'dropoff' : 'pickup'}`;
    UI.render('main-log-btn', isRiding ? 
        `<span id="btn-icon">🏁</span> <span id="btn-text">降車（記録完了・売上）</span>` : 
        `<span id="btn-icon">🚖</span> <span id="btn-text">乗車（記録開始）</span>`
    );
    UI.show('fare-container', isRiding);
    
    if (isRiding) {
        state.counts = { ...state.currentRide.pax };
        UI.render('men-count', state.counts.men);
        UI.render('women-count', state.counts.women);
        UI.render('address-text', `目的地に向かいましょう`);
    } else {
        UI.render('address-text', `次回乗車をお待ちください`);
    }
    renderHistory();
}

function renderHistory() {
    if (state.logs.length === 0) {
        UI.render('history-list', '<div class="empty-state">履歴はまだありません</div>');
        return;
    }

    const groups = {};
    state.logs.forEach(log => {
        const dateKey = new Date(log.dropoff.time).toLocaleDateString('ja-JP', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
        });
        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(log);
    });

    let html = '';
    Object.keys(groups).forEach(date => {
        html += `<div class="date-header">${date}</div>`;
        const dayLogs = groups[date];
        dayLogs.forEach((log, index) => {
            const rideNumber = dayLogs.length - index;
            html += `
                <div class="history-item">
                    <div class="ride-num">${rideNumber}</div>
                    <div class="history-info">
                        <span class="time">${Formatter.time(log.dropoff.time)} <span class="fare-tag">${Formatter.currency(log.fare)}</span></span>
                        <span class="addr">自: ${log.pickup.address}</span>
                        <span class="addr">至: ${log.dropoff.address}</span>
                    </div>
                    <div class="pax-badge">
                        <span class="men">♂${log.pax.men}</span>
                        <span class="women">♀${log.pax.women}</span>
                    </div>
                    <button class="history-edit-btn" onclick="openEditModal(${log.id})">✏️</button>
                </div>
            `;
        });
    });
    UI.render('history-list', html);
}

// --- 7. MAP LOGIC ---
function initOrUpdateMap() {
    if (!state.map) {
        state.map = L.map('log-map').setView(CONFIG.DUMMY_COORDS, 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OS' }).addTo(state.map);
    }
    state.mapLayers.markers.forEach(m => state.map.removeLayer(m));
    state.mapLayers.rideLines.forEach(l => state.map.removeLayer(l));
    if (state.mapLayers.path) state.map.removeLayer(state.mapLayers.path);
    state.mapLayers.markers = [];
    state.mapLayers.rideLines = [];
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
        if (state.mapLayers.markers.length > 0) state.map.fitBounds(new L.featureGroup(state.mapLayers.markers).getBounds().pad(0.2));
    }, 200);
}

// --- 8. ECO SYSTEM & EVENTS ---
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
    state.counts.total = state.counts.men + state.counts.women;
    if (state.currentRide) {
        state.currentRide.pax = { ...state.counts };
        localStorage.setItem('current_ride', JSON.stringify(state.currentRide));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setInterval(() => UI.render('live-clock', new Date().toLocaleTimeString('ja-JP', { hour12: false })), 1000);
    setupEventListeners();
    updateAppView();
});

function clearData() { if (confirm("全消去しますか？")) { localStorage.clear(); location.reload(); } }
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.logs));
    const a = document.createElement('a'); a.href = dataStr; a.download = `taxi_log_${Date.now()}.json`; a.click();
}
