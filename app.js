// app.js
// TAXI Log Pro コアロジック

let logs = JSON.parse(localStorage.getItem('taxi_logs')) || [];
let moveLogs = JSON.parse(localStorage.getItem('move_logs')) || [];
let trackingInterval = null;

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
    
    // GPS初期監視
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
});

// --- 時計 ---
function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ja-JP', { hour12: false });
    document.getElementById('live-clock').textContent = timeStr;
}

// --- ステッパー操作 ---
function changeCount(type, delta) {
    counts[type] = Math.max(0, counts[type] + delta);
    
    // UI更新
    document.getElementById(`${type}-count`).textContent = counts[type];

    // 全体人数が男女合計より少ない場合は調整
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
        
        // 市区町村、町名、丁目などを抽出
        const city = addr.city || addr.town || addr.village || "";
        const suburb = addr.suburb || addr.neighbourhood || "";
        const road = addr.road || "";
        // 丁目や番地
        const block = addr.house_number || "";

        // 筑紫野市 + 塔原東 + 1丁目 のように組み合わせる
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
    addrEl.textContent = "現在地を解析しています...";

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

        logs.unshift(newLog); // 先頭に追加
        localStorage.setItem('taxi_logs', JSON.stringify(logs.slice(0, 50))); // 最大50件
        
        renderHistory();
        addrEl.textContent = address;
        
        btn.disabled = false;
        btn.innerHTML = "✅ 記録完了！";
        setTimeout(() => {
            btn.innerHTML = '<span class="btn-icon">💾</span> 今この場所で記録する';
        }, 2000);

    }, (err) => {
        alert("GPSが取得できませんでした: " + err.message);
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">💾</span> 再試行';
    });
}

// --- 履歴の描画 ---
function renderHistory() {
    const list = document.getElementById('history-list');
    if (logs.length === 0) {
        list.innerHTML = '<div class="empty-state">履歴はまだありません</div>';
        return;
    }

    list.innerHTML = logs.slice(0, 5).map(log => {
        const d = new Date(log.time);
        const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        return `
            <div class="history-item">
                <div class="history-info">
                    <span class="time">${timeStr}</span>
                    <span class="addr">${log.address}</span>
                </div>
                <div class="history-pax">
                    ${log.pax.total}名 (${log.pax.men}♂ ${log.pax.women}♀)
                </div>
            </div>
        `;
    }).join('');
}

// --- 自動走行ログ (Tracking) ---
function startTracking() {
    console.log("Auto-tracking started");
    trackingInterval = setInterval(() => {
        navigator.geolocation.getCurrentPosition((pos) => {
            const moveLog = {
                time: new Date().toISOString(),
                lat: pos.coords.latitude,
                lon: pos.coords.longitude
            };
            moveLogs.push(moveLog);
            localStorage.setItem('move_logs', JSON.stringify(moveLogs.slice(-200))); // 最新200件
        });
    }, 60000); // 1分ごとに記録
}

function stopTracking() {
    console.log("Auto-tracking stopped");
    if (trackingInterval) clearInterval(trackingInterval);
}
