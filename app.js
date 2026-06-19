// app.js
// TAXI Log Pro コアロジック (Version 2.0 - Ride Lifecycle)

let logs = JSON.parse(localStorage.getItem('taxi_logs')) || [];
let moveLogs = JSON.parse(localStorage.getItem('move_logs')) || [];
let currentRide = JSON.parse(localStorage.getItem('current_ride')) || null;
let trackingInterval = null;
let mapInstance = null;
let mapLayers = {
    markers: [],
    path: null,
    rideLines: []
};

let counts = { total: 1, men: 0, women: 0 };

document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    renderHistory();
    checkGPSStatus();

    const mainBtn = document.getElementById('main-log-btn');
    if (mainBtn) mainBtn.addEventListener('click', handleMainAction);
    
    if (currentRide) updateRideUI(true);

    document.getElementById('tracking-toggle').addEventListener('change', (e) => {
        if (e.target.checked) startTracking(); else stopTracking();
    });

    setupTabs();
});

async function handleMainAction() {
    const btn = document.getElementById('main-log-btn');
    const addrEl = document.getElementById('address-text');
    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = "⌛ 位置取得中...";

    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        const address = await fetchAddress(latitude, longitude);
        const now = new Date().toISOString();

        if (!currentRide) {
            // --- 乗車処理 ---
            currentRide = {
                pickup: { address, lat: latitude, lon: longitude, time: now },
                pax: { ...counts }
            };
            localStorage.setItem('current_ride', JSON.stringify(currentRide));
            updateRideUI(true);
            addrEl.textContent = "乗車: " + address;
        } else {
            // --- 降車処理 ---
            const fare = parseInt(document.getElementById('fare-input').value) || 0;
            const newLog = {
                id: Date.now(),
                pickup: currentRide.pickup,
                dropoff: { address, lat: latitude, lon: longitude, time: now },
                pax: currentRide.pax,
                fare: fare
            };

            logs.unshift(newLog);
            localStorage.setItem('taxi_logs', JSON.stringify(logs.slice(0, 100)));
            currentRide = null;
            localStorage.removeItem('current_ride');
            document.getElementById('fare-input').value = "";
            updateRideUI(false);
            renderHistory();
            addrEl.textContent = "降車: " + address;
        }
        btn.disabled = false;
    }, (err) => {
        alert("GPS失敗");
        btn.disabled = false;
        btn.innerHTML = originalContent;
    });
}

function updateRideUI(isRiding) {
    const btn = document.getElementById('main-log-btn');
    const btnIcon = document.getElementById('btn-icon');
    const btnText = document.getElementById('btn-text');
    const fareContainer = document.getElementById('fare-container');

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
        document.getElementById(`tab-${tab}`).addEventListener('click', () => {
            document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            document.getElementById(`view-${tab}`).classList.add('active');
            document.getElementById(`tab-${tab}`).classList.add('active');
            if (tab === 'map') initOrUpdateMap();
        });
    });
}

function initOrUpdateMap() {
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
        const start = L.circleMarker([log.pickup.lat, log.pickup.lon], { color: 'gold', radius: 6, fillOpacity: 0.8 }).addTo(mapInstance);
        const end = L.circleMarker([log.dropoff.lat, log.dropoff.lon], { color: '#ef4444', radius: 6, fillOpacity: 0.8 }).addTo(mapInstance);
        const line = L.polyline([[log.pickup.lat, log.pickup.lon], [log.dropoff.lat, log.dropoff.lon]], { color: 'white', weight: 2, dashArray: '5, 8', opacity: 0.5 }).addTo(mapInstance);
        mapLayers.markers.push(start, end);
        mapLayers.rideLines.push(line);
    });

    if (moveLogs.length > 1) {
        mapLayers.path = L.polyline(moveLogs.map(m => [m.lat, m.lon]), { color: '#3b82f6', weight: 3, opacity: 0.4 }).addTo(mapInstance);
    }

    setTimeout(() => {
        mapInstance.invalidateSize();
        if (mapLayers.markers.length > 0) mapInstance.fitBounds(new L.featureGroup(mapLayers.markers).getBounds().pad(0.2));
    }, 200);
}

function updateClock() { document.getElementById('live-clock').textContent = new Date().toLocaleTimeString('ja-JP', { hour12: false }); }
function changeCount(type, delta) {
    counts[type] = Math.max(0, counts[type] + delta);
    document.getElementById(`${type}-count`).textContent = counts[type];
    if (type !== 'total') {
        const sum = counts.men + counts.women;
        if (sum > counts.total) { counts.total = sum; document.getElementById('total-count').textContent = counts.total; }
    }
}
async function fetchAddress(lat, lon) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, { headers: { 'Accept-Language': 'ja' } });
        const d = await r.json();
        const a = d.address;
        return `${a.city || a.town || a.village || ""}${a.suburb || a.neighbourhood || ""}${a.road || ""}${a.house_number || ""}` || "住所不明";
    } catch (e) { return `${lat.toFixed(4)}, ${lon.toFixed(4)}`; }
}
function checkGPSStatus() { if ("geolocation" in navigator) { const s = document.getElementById('gps-status'); s.textContent = "GPS 有効"; s.style.color = "var(--success)"; } }
function renderHistory() {
    const list = document.getElementById('history-list');
    if (logs.length === 0) { list.innerHTML = '<div class="empty-state">履歴なし</div>'; return; }
    list.innerHTML = logs.slice(0, 10).map(log => {
        const d = new Date(log.dropoff.time);
        return `<div class="history-item"><div class="history-info"><span class="time">${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} <span style="color:var(--success)">¥${log.fare}</span></span><span class="addr" style="font-size:0.75rem;opacity:0.8">自: ${log.pickup.address}</span><span class="addr" style="font-size:0.75rem;opacity:0.8">至: ${log.dropoff.address}</span></div><div class="history-pax">${log.pax.total}名</div></div>`;
    }).join('');
}
function startTracking() { trackingInterval = setInterval(() => { navigator.geolocation.getCurrentPosition((pos) => { moveLogs.push({ time: new Date().toISOString(), lat: pos.coords.latitude, lon: pos.coords.longitude }); localStorage.setItem('move_logs', JSON.stringify(moveLogs.slice(-1000))); }); }, 60000); }
function stopTracking() { if (trackingInterval) clearInterval(trackingInterval); }
function clearData() { if (confirm("全消去？")) { localStorage.clear(); location.reload(); } }
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs));
    const a = document.createElement('a'); a.setAttribute("href", dataStr); a.setAttribute("download", "taxi_log.json"); a.click();
}
