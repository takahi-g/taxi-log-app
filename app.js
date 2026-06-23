/**
 * TAXI Log Pro - Core Logic v3.0 (Editing Enabled)
 * -------------------------------------------
 */

// --- 1. UTILITIES ---
const DB = {
    save: (k, d) => localStorage.setItem(k, JSON.stringify(d)),
    load: (k, def) => {
        try {
            const item = localStorage.getItem(k);
            return item ? JSON.parse(item) : def;
        } catch (e) { return def; }
    }
};

function safeJSON(key, fallback) {
    return DB.load(key, fallback);
}

// --- 2. CONFIG & STATE ---
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

            // Automatically sync with the calculator history database
            if (fare > 0) {
                const hist = DB.load('taxi_v11_hist', []);
                const todayStr = new Date().toISOString().split('T')[0];
                hist.push({
                    id: newLog.id,
                    date: todayStr,
                    gross: fare,
                    net: Math.floor(fare / 1.1)
                });
                DB.save('taxi_v11_hist', hist);
            }
            
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
        let msg = "位置情報の取得に失敗しました。";
        if (e.code === 1) {
            msg += "\nブラウザや端末の設定で、位置情報の使用（GPS）が許可されているかご確認ください。";
        } else if (e.code === 2) {
            msg += "\n位置情報を判定できませんでした。GPS信号の届く場所でお試しください。";
        } else if (e.code === 3) {
            msg += "\n位置情報の取得中にタイムアウトしました。";
        }
        alert(msg + "\n\n(エラー詳細: " + (e.message || "Unknown error") + ")");
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
    // If fare is 0, show empty string so user doesn't have to backspace a 0
    UI.get('edit-fare').value = log.fare === 0 ? "" : log.fare;
    
    // Set stepper values for editing
    state.editCounts = { men: log.pax.men || 0, women: log.pax.women || 0 };
    UI.render('edit-men-count', state.editCounts.men);
    UI.render('edit-women-count', state.editCounts.women);
    
    UI.show('edit-modal', true);
}

function closeEditModal() {
    UI.show('edit-modal', false);
    state.editingLogId = null;
}

function changeEditCount(type, delta) {
    if (!state.editCounts) return;
    state.editCounts[type] = Math.max(0, state.editCounts[type] + delta);
    UI.render(`edit-${type}-count`, state.editCounts[type]);
}

function saveEdit() {
    const log = state.logs.find(l => l.id === state.editingLogId);
    if (log) {
        const newFare = parseInt(UI.get('edit-fare').value) || 0;
        log.fare = newFare;
        log.pax.men = state.editCounts ? state.editCounts.men : 0;
        log.pax.women = state.editCounts ? state.editCounts.women : 0;
        log.pax.total = log.pax.men + log.pax.women;
        
        localStorage.setItem('taxi_logs', JSON.stringify(state.logs));

        // Sync with calculator history if it exists, or add if it has a fare now
        const calcHist = DB.load('taxi_v11_hist', []);
        const calcItem = calcHist.find(x => x.id === state.editingLogId);
        if (calcItem) {
            calcItem.gross = newFare;
            calcItem.net = Math.floor(newFare / 1.1);
            DB.save('taxi_v11_hist', calcHist);
        } else if (newFare > 0) {
            const dateStr = new Date(log.dropoff.time).toISOString().split('T')[0];
            calcHist.push({
                id: log.id,
                date: dateStr,
                gross: newFare,
                net: Math.floor(newFare / 1.1)
            });
            DB.save('taxi_v11_hist', calcHist);
        }
        
        renderHistory();
        refreshCalc();
    }
    closeEditModal();
}

function deleteLog(id) {
    if (confirm("この乗車記録を削除しますか？")) {
        const targetLog = state.logs.find(l => l.id === id);
        if (targetLog) {
            // Delete from calculator history if it exists
            const calcHist = DB.load('taxi_v11_hist', []);
            const updatedCalcHist = calcHist.filter(x => x.id !== id);
            DB.save('taxi_v11_hist', updatedCalcHist);
        }
        state.logs = state.logs.filter(l => l.id !== id);
        localStorage.setItem('taxi_logs', JSON.stringify(state.logs));
        updateAppView();
        if (state.map) initOrUpdateMap();
        refreshCalc();
    }
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
        dayLogs.sort((a, b) => a.id - b.id);
        
        const dayHtml = dayLogs.map((log, i) => {
            const rideNumber = i + 1;
            return `
                <div class="history-item">
                    <div class="ride-num">${rideNumber}</div>
                    <div class="history-info">
                        <span class="time-fare" style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--accent); margin-bottom: 2px;">
                            ${Formatter.time(log.dropoff.time)} 
                            <span class="fare-tag" style="background: rgba(16, 185, 129, 0.15); color: var(--success); padding: 2px 6px; border-radius: 4px; font-weight: bold;">${Formatter.currency(log.fare)}</span>
                        </span>
                        <span class="addr"><span class="addr-label">自</span> ${log.pickup.address}</span>
                        <span class="addr"><span class="addr-label" style="background: rgba(239, 68, 68, 0.15); color: var(--danger);">至</span> ${log.dropoff.address}</span>
                    </div>
                    <div class="target-col" style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                        <div class="pax-badge" style="width: auto; padding: 4px 6px;">
                            <span class="men">♂${log.pax.men}</span>
                            <span class="women">♀${log.pax.women}</span>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button class="history-edit-btn" style="margin: 0; width: 32px; height: 32px;" onclick="openEditModal(${log.id})">✏️</button>
                            <button class="history-edit-btn" style="margin: 0; width: 32px; height: 32px; background: rgba(239, 68, 68, 0.15); color: var(--danger);" onclick="deleteLog(${log.id})">🗑️</button>
                        </div>
                    </div>
                </div>
            `;
        });
        dayHtml.reverse();
        html += dayHtml.join('');
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
    ['log', 'calc', 'map', 'settings'].forEach(tab => {
        UI.get(`tab-${tab}`)?.addEventListener('click', () => {
            document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            UI.active(`view-${tab}`);
            UI.active(`tab-${tab}`);
            if (tab === 'map') initOrUpdateMap();
            if (tab === 'calc') refreshCalc();
        });
    });
    // Click/Touch outside edit-modal to close it
    const handleOutsideClick = (e) => {
        if (e.target === UI.get('edit-modal')) {
            closeEditModal();
        }
    };
    UI.get('edit-modal')?.addEventListener('click', handleOutsideClick);
    UI.get('edit-modal')?.addEventListener('touchstart', handleOutsideClick, { passive: true });

    // Focus handler for edit-fare to clear if 0
    UI.get('edit-fare')?.addEventListener('focus', function() {
        if (this.value === '0' || this.value === '') {
            this.value = '';
        }
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

// --- 9. TAXI App (タク計) Integration Logic ---
let hasCelebratedToday = false;
const CELEB_DURATION = 5000; 

function startCelebration() {
    const overlay = document.getElementById('celebration-overlay');
    const text = document.getElementById('celebration-text');
    if (!overlay || !text) return;
    overlay.style.display = 'flex';
    setTimeout(() => {
        overlay.style.opacity = '1'; text.style.transform = 'scale(1)';
    }, 50);
    for (let i = 0; i < 150; i++) setTimeout(createConfetti, i * 20);
    setTimeout(() => { 
        overlay.style.opacity = '0'; 
        text.style.transform = 'scale(0.5)'; 
        setTimeout(() => { overlay.style.display = 'none'; }, 500);
    }, CELEB_DURATION);
}

function createConfetti() {
    const c = document.createElement('div'); c.className = 'confetti'; c.style.left = Math.random() * 100 + 'vw';
    c.style.backgroundColor = `hsl(${Math.random() * 360}, 100%, 50%)`;
    const dur = 3 + Math.random() * 2; c.style.animation = `confetti-fall ${dur}s linear forwards`;
    const size = Math.random() * 12 + 8; c.style.width = size + 'px'; c.style.height = (Math.random() > 0.5 ? size : size * 0.6) + 'px';
    c.style.borderRadius = Math.random() > 0.5 ? '2px' : '50%'; document.body.appendChild(c); setTimeout(() => c.remove(), dur * 1000);
}

function getRate(net) { if (net >= 550000) return 60.8; if (net >= 470000) return 57.9; return 55.0; }

function updateNormPreview() {
    const inputEl = document.getElementById('input-gross');
    const normEl = document.getElementById('disp-norm');
    const normGrossEl = document.getElementById('disp-norm-gross');
    if (!inputEl || !normEl) return;
    const inputVal = parseFloat(inputEl.value) || 0;
    const netInput = Math.floor(inputVal / 1.1);
    const currentNorm = parseFloat(normEl.getAttribute('data-base-norm')) || 0;
    const finalNorm = Math.max(0, currentNorm - netInput);
    normEl.innerText = Math.floor(finalNorm).toLocaleString();
    if (normGrossEl) {
        normGrossEl.innerText = Math.floor(Math.ceil(finalNorm * 1.1)).toLocaleString();
    }
}

function refreshCalc(isSave = false) {
    const history = DB.load('taxi_v11_hist', []);
    const sets = DB.load('taxi_v11_sets', { goal: 550000, days: 12 });
    const workDateEl = document.getElementById('work-date');
    if (!workDateEl) return;
    const selectedDate = workDateEl.value;
    if (!selectedDate) return;
    const curMonth = selectedDate.substring(0, 7);
    const monthlyData = history.filter(h => h.date.startsWith(curMonth));
    const workedDates = [...new Set(monthlyData.map(h => h.date))];
    const workedCount = workedDates.length;
    const now = new Date(); const todayStr = now.toISOString().split('T')[0];
    const pastWorkedDates = workedDates.filter(d => d !== todayStr);
    const pastWorkedDaysCount = pastWorkedDates.length;
    const remainDays = Math.max(1, sets.days - pastWorkedDaysCount);
    const salesBeforeToday = monthlyData.filter(h => h.date !== todayStr).reduce((sum, h) => sum + h.net, 0);
    const dailyBaseNorm = Math.ceil(Math.max(0, sets.goal - salesBeforeToday) / remainDays);
    const todayRecords = monthlyData.filter(h => h.date === selectedDate);
    const todayNetSum = todayRecords.reduce((sum, h) => sum + h.net, 0);
    const finalTodayNorm = Math.max(0, dailyBaseNorm - todayNetSum);
    if (isSave && finalTodayNorm <= 0 && !hasCelebratedToday && selectedDate === todayStr) { startCelebration(); hasCelebratedToday = true; }
    const normEl = document.getElementById('disp-norm'); 
    const normGrossEl = document.getElementById('disp-norm-gross');
    if (normEl) {
        normEl.innerText = Math.floor(finalTodayNorm).toLocaleString();
        normEl.setAttribute('data-base-norm', finalTodayNorm + (isSave ? 0 : todayNetSum));
    }
    if (normGrossEl) {
        normGrossEl.innerText = Math.floor(Math.ceil(finalTodayNorm * 1.1)).toLocaleString();
    }
    const progressEl = document.getElementById('disp-progress');
    if (progressEl) progressEl.innerText = `今月: ${workedCount} / ${sets.days} 回出勤`;
    const todaySumEl = document.getElementById('disp-today-sum');
    if (todaySumEl) {
        const todayGrossSum = todayRecords.reduce((s, h) => s + h.gross, 0);
        todaySumEl.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; width: 100%; padding: 5px 0;">
                <div style="font-size: 0.85rem; color: #aaa; font-weight: 600;">今日の合計売上</div>
                <div style="display: flex; gap: 20px; align-items: baseline; justify-content: center; flex-wrap: wrap;">
                    <div style="color: #FFD700; font-size: 1.8rem; font-weight: 900;">
                        <small style="font-size: 0.8rem; color: #aaa; margin-right: 4px; font-weight: normal;">税抜</small>${Math.floor(todayNetSum).toLocaleString()}<small style="font-size: 0.9rem; margin-left: 2px;">円</small>
                    </div>
                    <div style="color: var(--success); font-size: 1.8rem; font-weight: 900;">
                        <small style="font-size: 0.8rem; color: #aaa; margin-right: 4px; font-weight: normal;">税込</small>${Math.floor(todayGrossSum).toLocaleString()}<small style="font-size: 0.9rem; margin-left: 2px;">円</small>
                    </div>
                </div>
            </div>
        `;
    }
    const dailyQuotaEl = document.getElementById('disp-calc-quota-daily');
    if (dailyQuotaEl && sets.days > 0) {
        const dailyQuota = Math.ceil((sets.goal / sets.days) * 1.1);
        dailyQuotaEl.innerText = `¥${dailyQuota.toLocaleString()}`;
    }
    updateHistoryTab(history, sets);
}

function updateHistoryTab(history, sets) {
    const y = parseInt(document.getElementById('hist-year').value), m = parseInt(document.getElementById('hist-month').value);
    if (isNaN(y) || isNaN(m)) return;
    renderCalcCalendar(y, m, history);
    const fHist = history.filter(h => h.date.startsWith(`${y}-${String(m).padStart(2,'0')}`));
    const totalNet = fHist.reduce((sum, h) => sum + h.net, 0);
    const totalGross = fHist.reduce((sum, h) => sum + h.gross, 0);
    const rate = getRate(totalNet);
    const days = [...new Set(fHist.map(h => h.date))].length;
    document.getElementById('hist-label').innerText = `${y}年${m}月の合計`;
    document.getElementById('hist-rate').innerText = `暫定歩合: ${rate}%`;
    document.getElementById('hist-total-sales').innerText = Math.floor(totalNet).toLocaleString();
    const grossEl = document.getElementById('hist-total-sales-gross');
    if (grossEl) grossEl.innerText = Math.floor(totalGross).toLocaleString();
    document.getElementById('hist-avg-sales').innerText = (days > 0 ? Math.floor(totalNet/days) : 0).toLocaleString();
    document.getElementById('hist-target-avg').innerText = Math.floor(sets.goal/sets.days).toLocaleString();
    document.getElementById('hist-total-income').innerText = Math.floor(totalNet * (rate/100)).toLocaleString() + "円";
    const groups = {}; fHist.sort((a,b) => a.id - b.id).forEach(h => { if(!groups[h.date]) groups[h.date] = []; groups[h.date].push(h); });
    document.getElementById('history-groups').innerHTML = Object.keys(groups).sort().reverse().map(date => {
        const sum = groups[date].reduce((s, h) => s + h.net, 0);
        const dayHtml = groups[date].map((h, i) => `
            <div class="detail-item">
                <div>
                    <div class="detail-label">${i+1}件目</div>
                    <div class="detail-value" style="display: flex; gap: 10px; font-size: 1rem; align-items: baseline; margin-top: 4px;">
                        <span style="color: #FFD700; font-weight: 700;"><small style="font-size: 0.75rem; color: #8e8e93; font-weight: normal; margin-right: 2px;">税抜</small>${h.net.toLocaleString()}円</span>
                        <span style="color: var(--success); font-weight: 700;"><small style="font-size: 0.75rem; color: #8e8e93; font-weight: normal; margin-right: 2px;">税込</small>${h.gross.toLocaleString()}円</span>
                    </div>
                </div>
                <div class="detail-actions">
                    <button class="btn-pencil" onclick="editCalcData(${h.id})">✏️</button>
                    <button class="btn-trash" onclick="deleteCalcData(${h.id})">🗑️</button>
                </div>
            </div>
        `);
        dayHtml.reverse();
        return `<div class="day-group" id="group-${date}"><div class="day-header" onclick="toggleCalcDay('${date}')"><span>${date.substring(5).replace('-','/')} <span class="arrow">▶</span></span><span style="font-weight:800; font-size:1.1rem;">${Math.floor(sum).toLocaleString()}円</span></div><div class="day-details">${dayHtml.join('')}</div></div>`;
    }).join('') || '<div style="text-align:center;padding:20px;color:#8e8e93;">データなし</div>';
}

function editCalcData(id) {
    const h = DB.load('taxi_v11_hist', []); const item = h.find(x => x.id === id);
    if(item) {
        const newVal = prompt("売上(税込)を修正:", item.gross);
        if(newVal !== null && !isNaN(newVal) && newVal !== "") {
            item.gross = parseFloat(newVal); item.net = Math.floor(item.gross / 1.1);
            DB.save('taxi_v11_hist', h); refreshCalc();
        }
    }
}

function scrollToCalcDate(dateStr) {
    const el = document.getElementById(`group-${dateStr}`);
    if (el) {
        document.querySelectorAll('.day-group').forEach(g => g.classList.remove('open'));
        el.classList.add('open'); el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.background = '#2c2c2e'; setTimeout(() => { el.style.background = 'transparent'; }, 1000);
    }
}

function renderCalcCalendar(year, month, history) {
    const container = document.getElementById('cal-container'); container.innerHTML = '';
    const days = ['日','月','火','水','木','金','土']; days.forEach(d => container.innerHTML += `<div class="cal-day-label">${d}</div>`);
    const first = new Date(year, month - 1, 1).getDay(), last = new Date(year, month, 0).getDate();
    for (let i = 0; i < first; i++) container.innerHTML += '<div></div>';
    for (let d = 1; d <= last; d++) {
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const hasData = history.some(h => h.date === dateStr), isToday = dateStr === new Date().toISOString().split('T')[0] ? 'is-today' : '';
        container.innerHTML += `<div class="cal-cell ${hasData ? 'has-data' : ''} ${isToday}" onclick="scrollToCalcDate('${dateStr}')">${d}</div>`;
    }
}

function saveCalcData() { 
    const date = document.getElementById('work-date').value, gross = parseFloat(document.getElementById('input-gross').value);
    if (!gross) return; const h = DB.load('taxi_v11_hist', []); h.push({ id: Date.now(), date, gross, net: Math.floor(gross/1.1) });
    DB.save('taxi_v11_hist', h); document.getElementById('input-gross').value = ''; refreshCalc(true);
}

function deleteCalcData(id) { if(confirm('消去しますか？')) { const h = DB.load('taxi_v11_hist', []); DB.save('taxi_v11_hist', h.filter(x => x.id !== id)); refreshCalc(); } }
function saveCalcSettings() { DB.save('taxi_v11_sets', { goal: parseFloat(document.getElementById('set-goal').value)||550000, days: parseFloat(document.getElementById('set-days').value)||12 }); refreshCalc(); }
function toggleCalcDay(dateStr) { const el = document.getElementById(`group-${dateStr}`); if (el) el.classList.toggle('open'); }
function copyBackup() { const h = localStorage.getItem('taxi_v11_hist') || '[]', s = localStorage.getItem('taxi_v11_sets') || '{}', b = btoa(unescape(encodeURIComponent(JSON.stringify({ h, s })))); navigator.clipboard.writeText(b).then(() => alert('コピー完了！')); }
function restoreBackup() { const s = prompt('コードを貼り付け：'); if(!s) return; try { const d = JSON.parse(decodeURIComponent(escape(atob(s)))); localStorage.setItem('taxi_v11_hist', d.h); localStorage.setItem('taxi_v11_sets', d.s); location.reload(); } catch(e) { alert('失敗'); } }

document.addEventListener('DOMContentLoaded', () => {
    setInterval(() => UI.render('live-clock', new Date().toLocaleTimeString('ja-JP', { hour12: false })), 1000);
    setupEventListeners();
    updateAppView();

    // Initialize TAXI App calculator inputs
    const workDateInput = UI.get('work-date');
    if (workDateInput) {
        workDateInput.valueAsDate = new Date();
    }
    const yr = UI.get('hist-year'), mt = UI.get('hist-month');
    if (yr && mt) {
        for(let y=new Date().getFullYear(); y>=2024; y--) { let o = document.createElement('option'); o.value=y; o.text=y+'年'; yr.add(o); }
        for(let m=1; m<=12; m++) { let o = document.createElement('option'); o.value=m; o.text=m+'月'; if(m === new Date().getMonth()+1) o.selected = true; mt.add(o); }
    }
    const setsInit = DB.load('taxi_v11_sets', { goal: 550000, days: 12 });
    if (UI.get('set-goal')) UI.get('set-goal').value = setsInit.goal;
    if (UI.get('set-days')) UI.get('set-days').value = setsInit.days;
    refreshCalc();
});

function clearData() { if (confirm("すべての設定および履歴データを完全に消去しますか？")) { localStorage.clear(); location.reload(); } }
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
        logs: state.logs,
        moveLogs: state.moveLogs,
        taxiHist: DB.load('taxi_v11_hist', []),
        taxiSets: DB.load('taxi_v11_sets', {})
    }));
    const a = document.createElement('a'); a.href = dataStr; a.download = `taxi_log_full_${Date.now()}.json`; a.click();
}
