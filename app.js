// app.js - TAXI Log Pro (Version 2.1 - Robust Edition)

// データの読み込みを安全に行う
function safeJSON(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : fallback;
    } catch (e) {
        console.error("Data load error for " + key, e);
        return fallback;
    }
}

let logs = safeJSON('taxi_logs', []);
let moveLogs = safeJSON('move_logs', []);
let currentRide = safeJSON('current_ride', null);
let trackingInterval = null;
let mapInstance = null;
let mapLayers = { markers: [], path: null, rideLines: [] };

let counts = { total: 1, men: 0, women: 0 };

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    try {
        updateClock();
        setInterval(updateClock, 1000);
        renderHistory();
        checkGPSStatus();

        const mainBtn = document.getElementById('main-log-btn');
        if (mainBtn) {
            mainBtn.addEventListener('click', handleMainAction);
        } else {
            console.error("Main button not found");
        }
        
        if (currentRide) updateRideUI(true);

        const trackToggle = document.getElementById('tracking-toggle');
        if (trackToggle) {
            trackToggle.addEventListener('change', (e) => {
                if (e.target.checked) startTracking(); else stopTracking();
            });
        }

        setupTabs();
        console.log("App initialized successfully");
    } catch (e) {
        console.error("Initialization failed:", e);
    }
});

// メインアクション（乗車・降車）
async function handleMainAction() {
    const btn = document.getElementById('main-log-btn');
    const addrEl = document.getElementById('address-text');
    const btnText = document.getElementById('btn-text');
    if (!btn || !addrEl) return;

    btn.disabled = true;
    const oldIcon = document.getElementById('btn-icon').textContent;
    const oldText = btnText.textContent;
    btnText.textContent = "位置取得中...";

    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            const { latitude, longitude } = pos.coords;
            const now = new Date().toISOString();
            
            if (!currentRide) {
                // --- 乗車開始 ---
                currentRide = {
                    pickup: { address: "住所取得中...", lat: latitude, lon: longitude, time: now },
                    pax: { ...counts }
                };
                localStorage.setItem('current_ride', JSON.stringify(currentRide));
                addrEl.textContent = "乗車地点を確定しました";
                
                // 速やかにUIを「乗車中（降車ボタン）」に変える
                updateRideUI(true);

                fetchAddress(latitude, longitude).then(address => {
                    if (currentRide) {
                        currentRide.pickup.address = address;
                        localStorage.setItem('current_ride', JSON.stringify(currentRide));
                        addrEl.textContent = "乗車: " + address;
                    }
                });
            } else {
                // --- 降車完了 ---
                const fareInput = document.getElementById('fare-input');
                const fare = fareInput ? (parseInt(fareInput.value) || 0) : 0;
                const newLog = {
                    id: Date.now(),
                    pickup: currentRide.pickup,
                    dropoff: { address: "住所取得中...", lat: latitude, lon: longitude, time: now },
                    pax: currentRide.pax,
                    fare: fare
                };

                logs.unshift(newLog);
                localStorage.setItem('taxi_logs', JSON.stringify(logs.slice(0, 100)));
                
                const tempId = newLog.id;
                currentRide = null;
                localStorage.removeItem('current_ride');
                if (fareInput) fareInput.value = "";
                
                addrEl.textContent = "降車地点を確定しました";

                // 速やかにUIを「待機中（乗車ボタン）」に変える
                updateRideUI(false);
                renderHistory();

                fetchAddress(latitude, longitude).then(address => {
                    const target = logs.find(l => l.id === tempId);
                    if (target) {
                        target.dropoff.address = address;
                        localStorage.setItem('taxi_logs', JSON.stringify(logs));
                        renderHistory();
                    }
                });
            }
        } catch (e) {
            console.error("Action error:", e);
            updateRideUI(!!currentRide); // 状態を復復元
        }
        btn.disabled = false;
    }, (err) => {
        alert("GPS失敗: " + err.message);
        btn.disabled = false;
        updateRideUI(!!currentRide);
    }, { enableHighAccuracy: true, timeout: 8000 });
}

function updateRideUI(isRiding) {
    const btn = document.getElementById('main-log-btn');
    const btnIcon = document.getElementById('btn-icon');
    const btnText = document.getElementById('btn-text');
    const fareContainer = document.getElementById('fare-container');

    if (!btn || !btnIcon || !btnText || !fareContainer) return;

    if (isRiding) {
        btn.className = 'main-action-btn dropoff';
        btnIcon.textContent = "🏁";
        btnText.textContent = "降車（記録完了・売上）";
        fareContainer.style.display = "block";
    } else {
        btn.className = 'main-action-btn pickup';
        btnIcon.textContent = "🚖";
        btnText.textContent = "乗車（記録開始）";
        fareContainer.style.display = "none";
    }
}

function setupTabs() {
    ['log', 'map', 'settings'].forEach(tab => {
        const el = document.getElementById(`tab-${tab}`);
        if (el) {
            el.addEventListener('click', () => {
                document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
                document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
                
                const targetView = document.getElementById(`view-${tab}`);
                if (targetView) {
                    targetView.classList.add('active');
                    el.classList.add('active');
                    if (tab === 'map') initOrUpdateMap();
                }
            });
        }
    });
}

function initOrUpdateMap() {
    try {
        if (!mapInstance) {
            mapInstance = L.map('log-map').setView([33.5002, 130.5168], 14);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);
        }
        mapLayers.markers.forEach(m => mapInstance.removeLayer(m));
        mapLayers.markers = [];
        mapLayers.rideLines.forEach(l => mapInstance.removeLayer(l));
        mapLayers.rideLines = [];
        if (mapLayers.path) mapInstance.removeLayer(mapLayers.path);

        logs.forEach(log => {
            if (log.pickup && log.dropoff) {
                const start = L.circleMarker([log.pickup.lat, log.pickup.lon], { color: 'gold', radius: 6, fillOpacity: 0.8 }).addTo(mapInstance);
                const end = L.circleMarker([log.dropoff.lat, log.dropoff.lon], { color: '#ef4444', radius: 6, fillOpacity: 0.8 }).addTo(mapInstance);
                const line = L.polyline([[log.pickup.lat, log.pickup.lon], [log.dropoff.lat, log.dropoff.lon]], { color: 'white', weight: 2, dashArray: '5, 8', opacity: 0.5 }).addTo(mapInstance);
                mapLayers.markers.push(start, end);
                mapLayers.rideLines.push(line);
            }
        });

        if (moveLogs.length > 1) {
            mapLayers.path = L.polyline(moveLogs.map(m => [m.lat, m.lon]), { color: '#3b82f6', weight: 3, opacity: 0.4 }).addTo(mapInstance);
        }

        setTimeout(() => {
            if (mapInstance) {
                mapInstance.invalidateSize();
                if (mapLayers.markers.length > 0) mapInstance.fitBounds(new L.featureGroup(mapLayers.markers).getBounds().pad(0.2));
            }
        }, 200);
    } catch (e) {
        console.error("Map error:", e);
    }
}

function updateClock() {
    const clock = document.getElementById('live-clock');
    if (clock) clock.textContent = new Date().toLocaleTimeString('ja-JP', { hour12: false });
}

function changeCount(type, delta) {
    counts[type] = Math.max(0, counts[type] + delta);
    const el = document.getElementById(`${type}-count`);
    if (el) el.textContent = counts[type];
    if (type !== 'total') {
        const sum = counts.men + counts.women;
        if (sum > counts.total) { 
            counts.total = sum; 
            const totalEl = document.getElementById('total-count');
            if (totalEl) totalEl.textContent = counts.total;
        }
    }
}

async function fetchAddress(lat, lon) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, { headers: { 'Accept-Language': 'ja' } });
        const d = await r.json();
        const a = d.address;
        if (!a) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        return `${a.city || a.town || a.village || ""}${a.suburb || a.neighbourhood || ""}${a.road || ""}${a.house_number || ""}` || "住所不明";
    } catch (e) { return `${lat.toFixed(4)}, ${lon.toFixed(4)}`; }
}

function checkGPSStatus() { 
    const s = document.getElementById('gps-status');
    if ("geolocation" in navigator && s) { 
        s.textContent = "GPS 有効"; 
        s.style.color = "var(--success)"; 
    } 
}

function renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    if (logs.length === 0) { list.innerHTML = '<div class="empty-state">履歴なし</div>'; return; }
    list.innerHTML = logs.slice(0, 10).map(log => {
        const d = new Date(log.dropoff ? log.dropoff.time : log.id);
        const fare = log.fare !== undefined ? ` <span style="color:var(--success)">¥${log.fare}</span>` : "";
        const from = log.pickup ? log.pickup.address : "不明";
        const to = log.dropoff ? log.dropoff.address : "不明";
        return `<div class="history-item"><div class="history-info"><span class="time">${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}${fare}</span><span class="addr" style="font-size:0.75rem;opacity:0.8;display:block">自: ${from}</span><span class="addr" style="font-size:0.75rem;opacity:0.8;display:block">至: ${to}</span></div><div class="history-pax">${log.pax ? log.pax.total : "?"}名</div></div>`;
    }).join('');
}

function startTracking() { 
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(() => { 
        navigator.geolocation.getCurrentPosition((pos) => { 
            moveLogs.push({ time: new Date().toISOString(), lat: pos.coords.latitude, lon: pos.coords.longitude }); 
            localStorage.setItem('move_logs', JSON.stringify(moveLogs.slice(-1000))); 
        }); 
    }, 60000); 
}

function stopTracking() { if (trackingInterval) clearInterval(trackingInterval); }
function clearData() { if (confirm("全消去してもよろしいですか？")) { localStorage.clear(); location.reload(); } }
function exportData() {
    try {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs));
        const a = document.createElement('a'); 
        a.setAttribute("href", dataStr); 
        a.setAttribute("download", "taxi_log.json"); 
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (e) { alert("エクスポート失敗"); }
}
