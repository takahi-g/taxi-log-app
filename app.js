// app.js
// TAXI Log Pro コアロジック

let logs = JSON.parse(localStorage.getItem('taxi_logs')) || [];
let moveLogs = JSON.parse(localStorage.getItem('move_logs')) || [];
let trackingInterval = null;
let mapInstance = null;
let mapLayers = {
    markers: [],
    path: null
};

// カウント状態
let counts = {
    total: 1,
    men: 0,
    women: 0
};

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    renderHistory();
    checkGPSStatus();

    // 保存ボタン
    document.getElementById('save-log-btn').addEventListener('click', savePickupLog);

    // 追跡トグル
    document.getElementById('tracking-toggle').addEventListener('change', (e) => {
        if (e.target.checked) {
            startTracking();
        } else {
            stopTracking();
        }
    });

    // タブ切り替えの設定
    setupTabs();
});

// --- タブ切り替え ---
function setupTabs() {
    const tabs = ['log', 'map', 'settings'];
    tabs.forEach(tab => {
        document.getElementById(`tab-${tab}`).addEventListener('click', () => {
            // 全ビューを隠す
            document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));

            // 対象を表示
            document.getElementById(`view-${tab}`).classList.add('active');
            document.getElementById(`tab-${tab}`).classList.add('active');

            // マップが選ばれたら地図を初期化・更新
            if (tab === 'map') {
                initOrUpdateMap();
            }
        });
    });
}

// --- 地図ロジック (Leaflet) ---
function initOrUpdateMap() {
    if (!mapInstance) {
        // デフォルトはJR二日市駅付近
        mapInstance = L.map('log-map').setView([33.5002, 130.5168], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(mapInstance);
    }

    // 古いレイヤーを削除
    mapLayers.markers.forEach(m => mapInstance.removeLayer(m));
    mapLayers.markers = [];
    if (mapLayers.path) mapInstance.removeLayer(mapLayers.path);

    // 乗車地点のマーカーを追加
    logs.forEach(log => {
        const marker = L.marker([log.lat, log.lon], {
            icon: L.divIcon({
                className: 'custom-marker',
                html: '🚕',
                iconSize: [20, 20]
            })
        }).addTo(mapInstance)
          .bindPopup(`${log.address}<br>${log.pax.total}名`);
        mapLayers.markers.push(marker);
    });

    // 走行ルートの線を描画
    if (moveLogs.length > 1) {
        const pathPoints = moveLogs.map(m => [m.lat, m.lon]);
        mapLayers.path = L.polyline(pathPoints, {
            color: '#3b82f6',
            weight: 4,
            opacity: 0.6
        }).addTo(mapInstance);
    }

    // 表示範囲を調整
    setTimeout(() => {
        mapInstance.invalidateSize();
        if (logs.length > 0) {
            const group = new L.featureGroup(mapLayers.markers);
            mapInstance.fitBounds(group.getBounds().pad(0.1));
        }
    }, 200);
}

// --- 時計 ---
function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ja-JP', { hour12: false });
    document.getElementById('live-clock').textContent = timeStr;
}

// --- ステッパー操作 ---
function changeCount(type, delta) {
    counts[type] = Math.max(0, counts[type] + delta);
    document.getElementById(`${type}-count`).textContent = counts[type];

    if (type !== 'total') {
        const sumGenders = counts.men + counts.women;
        if (sumGenders > counts.total) {
            counts.total = sumGenders;
            document.getElementById('total-count').textContent = counts.total;
        }
    }
}

// --- GPS & 住所取得 ---
async function fetchAddress(lat, lon) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
            headers: { 'Accept-Language': 'ja' }
        });
        const data = await response.json();
        const addr = data.address;
        const city = addr.city || addr.town || addr.village || "";
        const suburb = addr.suburb || addr.neighbourhood || "";
        const road = addr.road || "";
        const block = addr.house_number || "";
        let simpleAddr = `${city}${suburb}${road}${block}`;
        return simpleAddr || "住所不明";
    } catch (e) {
        console.error("Address fetch error:", e);
        return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
}

function checkGPSStatus() {
    if ("geolocation" in navigator) {
        const statusEl = document.getElementById('gps-status');
        statusEl.textContent = "GPS 準備完了";
        statusEl.style.color = "var(--success)";
    }
}

// --- 乗車記録の保存 ---
async function savePickupLog() {
    const btn = document.getElementById('save-log-btn');
    const addrEl = document.getElementById('address-text');
    
    btn.disabled = true;
    btn.innerHTML = "⌛ 位置取得中...";

    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        const address = await fetchAddress(latitude, longitude);
        
        const newLog = {
            id: Date.now(),
            time: new Date().toISOString(),
            address: address,
            lat: latitude,
            lon: longitude,
            pax: { ...counts }
        };

        logs.unshift(newLog);
        localStorage.setItem('taxi_logs', JSON.stringify(logs.slice(0, 100)));
        renderHistory();
        
        addrEl.textContent = address;
        btn.disabled = false;
        btn.innerHTML = "✅ 記録完了！";
        setTimeout(() => btn.innerHTML = '<span class="btn-icon">💾</span> 今この場所で記録する', 2000);
    }, (err) => {
        alert("GPSが取得できませんでした");
        btn.disabled = false;
        btn.innerHTML = '💾 再試行';
    });
}

// --- 履歴の描画 ---
function renderHistory() {
    const list = document.getElementById('history-list');
    if (logs.length === 0) {
        list.innerHTML = '<div class="empty-state">履歴はまだありません</div>';
        return;
    }

    list.innerHTML = logs.slice(0, 10).map(log => {
        const d = new Date(log.time);
        const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        return `
            <div class="history-item">
                <div class="history-info">
                    <span class="time">${timeStr}</span>
                    <span class="addr">${log.address}</span>
                </div>
                <div class="history-pax">
                    ${log.pax.total}名 (${log.pax.men}/${log.pax.women})
                </div>
            </div>
        `;
    }).join('');
}

// --- 自動走行ログ (Tracking) ---
function startTracking() {
    trackingInterval = setInterval(() => {
        navigator.geolocation.getCurrentPosition((pos) => {
            const moveLog = {
                time: new Date().toISOString(),
                lat: pos.coords.latitude,
                lon: pos.coords.longitude
            };
            moveLogs.push(moveLog);
            localStorage.setItem('move_logs', JSON.stringify(moveLogs.slice(-500)));
        });
    }, 60000);
}

function stopTracking() {
    if (trackingInterval) clearInterval(trackingInterval);
}

// --- 設定・データ管理 ---
function clearData() {
    if (confirm("すべての乗車履歴と走行ログを消去しますか？")) {
        localStorage.removeItem('taxi_logs');
        localStorage.removeItem('move_logs');
        location.reload();
    }
}

function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "taxi_log_export.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}
