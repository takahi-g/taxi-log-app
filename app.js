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
    },
    remove: (k) => localStorage.removeItem(k)
};

function safeJSON(key, fallback) {
    return DB.load(key, fallback);
}

// --- 2. CONFIG & STATE ---
const CONFIG = {
    MAX_LOGS: 100,
    GPS_TIMEOUT: 10000,
    TRACKING_INTERVAL: 30000,
    DUMMY_COORDS: [33.5002, 130.5168],
    
    // デフォルト目標設定
    DEFAULT_GOAL: 550000,
    DEFAULT_DAYS: 12,
    
    // 乗務・休憩のデフォルト設定
    DEFAULT_START_TIME: "08:00",
    DEFAULT_BREAK_MINUTES: 0,
    DEFAULT_STANDARD_WORK_HOURS: 19,
    DEFAULT_STANDARD_WORK_MINUTES: 40
};

const state = {
    logs: safeJSON('taxi_logs', []),
    moveLogs: safeJSON('move_logs', []),
    currentRide: safeJSON('current_ride', null),
    trackingIntervalId: null,
    editingLogId: null,
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
            DB.save('current_ride', state.currentRide);
            updateAppView();
            
            GeoService.getAddress(lat, lon).then(addr => {
                if (state.currentRide) {
                    state.currentRide.pickup.address = addr;
                    DB.save('current_ride', state.currentRide);
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
            DB.save('taxi_logs', state.logs.slice(0, CONFIG.MAX_LOGS));

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
            DB.remove('current_ride');
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
                        DB.save('taxi_logs', state.logs.slice(0, CONFIG.MAX_LOGS));
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
        
        DB.save('taxi_logs', state.logs);

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
        DB.save('taxi_logs', state.logs);
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
    ['log', 'calc', 'history', 'map', 'settings'].forEach(tab => {
        UI.get(`tab-${tab}`)?.addEventListener('click', () => {
            document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            UI.active(`view-${tab}`);
            UI.active(`tab-${tab}`);
            if (tab === 'map') initOrUpdateMap();
            if (tab === 'calc' || tab === 'history') refreshCalc();
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
            DB.save('move_logs', state.moveLogs.slice(-1000));
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
        DB.save('current_ride', state.currentRide);
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
    const workDateEl = document.getElementById('work-date');
    if (!workDateEl) return;
    const selectedDate = workDateEl.value;
    if (!selectedDate) return;
    const curMonth = selectedDate.substring(0, 7);
    
    // 選択された日付の年月をもとに月別目標を読み込む
    const [yPart, mPart] = selectedDate.split('-').map(Number);
    const mSets = getMonthlySettings(yPart, mPart);
    const sets = DB.load('taxi_v11_sets', { baseStartTime: "08:00", standardWorkHours: 19, standardWorkMinutes: 40 });
    const curGoal = mSets.goal;
    const curDays = mSets.days;

    const monthlyData = history.filter(h => h.date.startsWith(curMonth));
    const workedDates = [...new Set(monthlyData.map(h => h.date))];
    const workedCount = workedDates.length;
    const now = new Date(); const todayStr = now.toISOString().split('T')[0];
    const pastWorkedDates = workedDates.filter(d => d !== todayStr);
    const pastWorkedDaysCount = pastWorkedDates.length;
    let remainDays = 1;
    if (mSets.workDates && mSets.workDates.length > 0) {
        const futureOrTodayWorkdates = mSets.workDates.filter(d => d >= todayStr);
        remainDays = Math.max(1, futureOrTodayWorkdates.length);
    } else {
        remainDays = Math.max(1, curDays - pastWorkedDaysCount);
    }
    const salesBeforeToday = monthlyData.filter(h => h.date !== todayStr).reduce((sum, h) => sum + h.net, 0);
    const dailyBaseNorm = Math.ceil(Math.max(0, curGoal - salesBeforeToday) / remainDays);
    const todayRecords = monthlyData.filter(h => h.date === selectedDate);
    const todayNetSum = todayRecords.reduce((sum, h) => sum + h.net, 0);
    const finalTodayNorm = Math.max(0, dailyBaseNorm - todayNetSum);
    
    // 今日の曜日・特別目標と現在の達成差分（プラスマイナス表示）の更新
    const workStateObj = loadWorkState(selectedDate);
    const todayTargetTypeEl = document.getElementById('disp-today-target-type');
    const todayTargetValEl = document.getElementById('disp-today-target-value');
    const todayTargetDiffEl = document.getElementById('disp-today-target-diff');
    const btnToggleTargetType = document.getElementById('btn-toggle-target-type');
    
    let activeTargetType = workStateObj.targetType || "auto";
    let isWeekendOrHoliday = isDayBeforeHolidayOrWeekend(selectedDate);
    let resolvedTargetType = "weekday";
    
    if (activeTargetType === "weekend" || (activeTargetType === "auto" && isWeekendOrHoliday)) {
        resolvedTargetType = "weekend";
    }
    
    const targetVal = resolvedTargetType === "weekend" ? mSets.weekendGoal : mSets.weekdayGoal;
    
    if (todayTargetTypeEl) {
        let typeText = resolvedTargetType === "weekend" ? "金土祝前目標" : "平日標準目標";
        if (activeTargetType === "auto") {
            typeText += " (自動)";
        } else {
            typeText += " (固定)";
        }
        todayTargetTypeEl.innerText = typeText;
    }
    
    if (btnToggleTargetType) {
        if (activeTargetType === "auto") {
            btnToggleTargetType.innerText = "自動判定中";
            btnToggleTargetType.style.background = "rgba(255,255,255,0.08)";
        } else if (activeTargetType === "weekday") {
            btnToggleTargetType.innerText = "平日固定中";
            btnToggleTargetType.style.background = "rgba(94, 92, 230, 0.2)";
        } else {
            btnToggleTargetType.innerText = "金土固定中";
            btnToggleTargetType.style.background = "rgba(237, 180, 24, 0.2)";
        }
    }
    
    if (todayTargetValEl) {
        const targetValGross = Math.floor(targetVal * 1.1);
        todayTargetValEl.innerHTML = `${Math.floor(targetVal).toLocaleString()} 円 <small style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">(税込: ${targetValGross.toLocaleString()}円)</small>`;
    }
    
    if (todayTargetDiffEl) {
        const diff = todayNetSum - targetVal;
        const diffGross = Math.floor(diff * 1.1);
        if (diff >= 0) {
            todayTargetDiffEl.innerHTML = `<span style="color:var(--success); font-weight:900;">+¥${Math.floor(diff).toLocaleString()} <small style="font-size:0.75rem; font-weight:normal;">(税込: +¥${Math.floor(diffGross).toLocaleString()}) 達成！</small></span>`;
        } else {
            todayTargetDiffEl.innerHTML = `<span style="color:#ff453a; font-weight:900;">-¥${Math.floor(Math.abs(diff)).toLocaleString()} <small style="font-size:0.75rem; font-weight:normal; color:var(--text-muted);">(税込: -¥${Math.floor(Math.abs(diffGross)).toLocaleString()})</small></span>`;
        }
    }

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
    if (progressEl) progressEl.innerText = `今月: ${workedCount} / ${curDays} 回出勤`;
    
    const todayGrossSum = todayRecords.reduce((s, h) => s + h.gross, 0);
    const todaySumEl = document.getElementById('disp-today-sum');
    if (todaySumEl) {
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
    if (dailyQuotaEl && curDays > 0) {
        const dailyQuota = Math.ceil((curGoal / curDays) * 1.1);
        dailyQuotaEl.innerText = `¥${dailyQuota.toLocaleString()}`;
    }

    // --- 乗務・時間売上ステータス（時給計算）の更新 ---
    const workState = loadWorkState(selectedDate);
    
    // UI要素の同期
    const startTimeInput = document.getElementById('work-start-time');
    const endTimeInput = document.getElementById('work-end-time');
    const dispEndTimeStatus = document.getElementById('disp-end-time-status');
    const btnActionEndTime = document.getElementById('btn-action-end-time');
    const breakMinutesInput = document.getElementById('input-break-minutes');
    const dispBreakHoursSpan = document.getElementById('disp-break-hours');
    
    if (startTimeInput) startTimeInput.value = workState.startTime;
    if (breakMinutesInput && document.activeElement !== breakMinutesInput) breakMinutesInput.value = workState.breakMinutes;
    if (dispBreakHoursSpan) dispBreakHoursSpan.innerText = `${(workState.breakMinutes / 60).toFixed(1)}時間`;
    
    // 休憩履歴リストの同期・描画
    const breakHistoryList = document.getElementById('break-history-list');
    if (breakHistoryList) {
        if (workState.breaks && workState.breaks.length > 0) {
            breakHistoryList.style.display = 'block';
            const listHtml = workState.breaks.map((b, i) => `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 4px;">
                    <span>☕ 休憩${i+1}: ${b.start} 〜 ${b.end}</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-weight:bold; color:var(--accent); margin-right:4px;">${b.duration}分</span>
                        <button onclick="editBreakSession(${i})" style="background:none; border:none; font-size:1rem; cursor:pointer; padding:2px;">✏️</button>
                        <button onclick="deleteBreakSession(${i})" style="background:none; border:none; font-size:1rem; cursor:pointer; padding:2px;">🗑️</button>
                    </div>
                </div>
            `).join('');
            breakHistoryList.innerHTML = `<div style="font-weight:bold; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; color:var(--text-main); font-size:0.85rem;">⏱️ 休憩時間セッション履歴</div>` + listHtml;
        } else {
            breakHistoryList.style.display = 'none';
        }
    }
    
    if (endTimeInput && dispEndTimeStatus && btnActionEndTime) {
        if (workState.endTime) {
            endTimeInput.style.display = 'block';
            endTimeInput.value = workState.endTime;
            dispEndTimeStatus.style.display = 'none';
            btnActionEndTime.innerText = '戻す';
            btnActionEndTime.style.background = 'rgba(94, 92, 230, 0.15)';
            btnActionEndTime.style.color = '#5e5ce6';
        } else {
            endTimeInput.style.display = 'none';
            dispEndTimeStatus.style.display = 'block';
            btnActionEndTime.innerText = '退勤';
            btnActionEndTime.style.background = 'rgba(255, 255, 255, 0.08)';
            btnActionEndTime.style.color = 'white';
        }
    }

    // 経過時間の算出
    const [sh, sm] = workState.startTime.split(':').map(Number);
    const workStart = new Date(selectedDate);
    workStart.setHours(sh, sm, 0, 0);

    let elapsedMinutes = 0;
    
    if (workState.endTime) {
        // 退勤時刻が登録されている場合
        const [eh, em] = workState.endTime.split(':').map(Number);
        let workEnd = new Date(selectedDate);
        workEnd.setHours(eh, em, 0, 0);
        // 退勤時刻が出勤時刻以下の場合は翌日とみなす（日付またぎ運行）
        if (workEnd <= workStart) {
            workEnd.setDate(workEnd.getDate() + 1);
        }
        const diffMs = workEnd - workStart;
        if (diffMs > 0) {
            elapsedMinutes = Math.floor(diffMs / 60000);
        }
    } else {
        // 乗務中（endTimeがnull）の場合、現在時刻との差分
        const diffMs = now - workStart;
        if (diffMs > 0) {
            elapsedMinutes = Math.floor(diffMs / 60000);
        }
        
        // 過去の日付、または22時間を超える場合は設定された標準勤務時間を基準にする
        const stdWorkHours = sets.standardWorkHours !== undefined ? sets.standardWorkHours : 19;
        const stdWorkMinutes = sets.standardWorkMinutes !== undefined ? sets.standardWorkMinutes : 40;
        const stdTotalMinutes = stdWorkHours * 60 + stdWorkMinutes;
        if (elapsedMinutes > 1320 || selectedDate !== todayStr) {
            elapsedMinutes = stdTotalMinutes;
        }
    }

    // 現在計測中の休憩時間も加算する
    let activeBreakMinutes = 0;
    if (workState.activeBreakStarted) {
        const breakStart = new Date(workState.activeBreakStarted);
        const activeDiff = now - breakStart;
        if (activeDiff > 0) {
            activeBreakMinutes = Math.floor(activeDiff / 60000);
        }
        if (!activeBreakIntervalId) startBreakTimer();
    }

    const totalBreakMinutes = workState.breakMinutes + activeBreakMinutes;
    const actualWorkMinutes = Math.max(6, elapsedMinutes - totalBreakMinutes); // 最低6分（0.1時間）
    const actualWorkHours = actualWorkMinutes / 60;

    const dispWorkHoursSpan = document.getElementById('disp-work-hours');
    if (dispWorkHoursSpan) {
        dispWorkHoursSpan.innerText = `${actualWorkHours.toFixed(1)} 時間`;
    }

    // 時給の算出
    const hourlyNet = Math.round(todayNetSum / actualWorkHours);
    const hourlyGross = Math.round(todayGrossSum / actualWorkHours);

    const dispHourlyNetStrong = document.getElementById('disp-hourly-net');
    const dispHourlyGrossSpan = document.getElementById('disp-hourly-gross');
    if (dispHourlyNetStrong) dispHourlyNetStrong.innerText = `¥${hourlyNet.toLocaleString()} /h`;
    if (dispHourlyGrossSpan) dispHourlyGrossSpan.innerText = `¥${hourlyGross.toLocaleString()} /h`;

    // 手取り時給の計算 (歩合考慮)
    const dispHourlyIncomeLabel = document.getElementById('disp-hourly-income-label');
    const dispHourlyIncome = document.getElementById('disp-hourly-income');
    if (dispHourlyIncome) {
        const [yPart, mPart] = selectedDate.split('-').map(Number);
        const monthlyData = history.filter(h => h.date.startsWith(`${yPart}-${String(mPart).padStart(2,'0')}`));
        const totalNetVal = monthlyData.reduce((sum, h) => sum + h.net, 0);
        const rate = getRate(totalNetVal);
        
        const hourlyIncome = Math.round(hourlyNet * (rate / 100));
        
        if (dispHourlyIncomeLabel) dispHourlyIncomeLabel.innerText = `手取り時給 (暫定歩合: ${rate}%)`;
        dispHourlyIncome.innerText = `¥${hourlyIncome.toLocaleString()} /h`;
    }

    updateHistoryTab(history, sets);
}

function updateHistoryTab(history, sets) {
    const y = parseInt(document.getElementById('hist-year').value), m = parseInt(document.getElementById('hist-month').value);
    if (isNaN(y) || isNaN(m)) return;
    renderCalcCalendar(y, m, history);
    
    // 表示中月の月別目標をロード
    const mSets = getMonthlySettings(y, m);
    
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
    document.getElementById('hist-target-avg').innerText = Math.floor(mSets.goal/mSets.days).toLocaleString();
    document.getElementById('hist-total-income').innerText = Math.floor(totalNet * (rate/100)).toLocaleString() + "円";
    const groups = {}; fHist.sort((a,b) => a.id - b.id).forEach(h => { if(!groups[h.date]) groups[h.date] = []; groups[h.date].push(h); });
    
    const selectedDate = getSelectedDateStr();
    const selectedGroup = groups[selectedDate];
    const detailsBox = document.getElementById('selected-day-details-box');
    
    if (detailsBox) {
        const [yPart, mPart, dPart] = selectedDate.split('-');
        if (selectedGroup && selectedGroup.length > 0) {
            const sumNet = selectedGroup.reduce((s, h) => s + h.net, 0);
            const sumGross = selectedGroup.reduce((s, h) => s + h.gross, 0);
            const itemsHtml = selectedGroup.map((h, i) => `
                <div class="detail-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div>
                        <div class="detail-label" style="font-size:0.75rem; color:var(--text-muted);">${i+1}件目</div>
                        <div class="detail-value" style="display: flex; gap: 10px; font-size: 0.95rem; align-items: baseline; margin-top: 2px;">
                            <span style="color: #FFD700; font-weight: 700;"><small style="font-size: 0.75rem; color: #8e8e93; font-weight: normal; margin-right: 2px;">税抜</small>${h.net.toLocaleString()}円</span>
                            <span style="color: var(--success); font-weight: 700;"><small style="font-size: 0.75rem; color: #8e8e93; font-weight: normal; margin-right: 2px;">税込</small>${h.gross.toLocaleString()}円</span>
                        </div>
                    </div>
                    <div class="detail-actions">
                        <button class="btn-pencil" onclick="editCalcData(${h.id})" style="background:none; border:none; font-size:1.1rem; cursor:pointer; padding:5px;">✏️</button>
                        <button class="btn-trash" onclick="deleteCalcData(${h.id})" style="background:none; border:none; font-size:1.1rem; cursor:pointer; padding:5px;">🗑️</button>
                    </div>
                </div>
            `).reverse().join('');
            
            detailsBox.innerHTML = `
                <section class="card" style="margin-bottom: 0; padding: 15px; border: 1px solid var(--accent); background: rgba(237, 180, 24, 0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px;">
                        <h3 style="margin: 0; font-size: 1rem; color: var(--accent);">📌 選択中の詳細 (${mPart}/${dPart})</h3>
                        <div style="text-align: right;">
                            <span style="font-size: 1.15rem; font-weight: 800; color: var(--success);">${Math.floor(sumGross).toLocaleString()}円 <small style="font-size:0.75rem; font-weight:normal; color:var(--text-muted);">(税込)</small></span>
                        </div>
                    </div>
                    <div class="day-details" style="display: block;">
                        ${itemsHtml}
                    </div>
                </section>
            `;
        } else {
            detailsBox.innerHTML = `
                <section class="card" style="margin-bottom: 0; padding: 15px; text-align: center; color: var(--text-muted); border: 1px solid var(--border);">
                    <h3 style="margin: 0 0 5px 0; font-size: 0.95rem; color: var(--text-muted);">📌 選択中 (${mPart}/${dPart})</h3>
                    <div style="font-size: 0.85rem;">この日の売上記録はありません</div>
                </section>
            `;
        }
    }

    // アコーディオン履歴表示（選択された日付 selectedDate は除外する）
    const sortedDates = Object.keys(groups).sort().reverse().filter(d => d !== selectedDate);
    
    document.getElementById('history-groups').innerHTML = sortedDates.map(date => {
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
    }).join('') || '<div style="text-align:center;padding:20px;color:#8e8e93;">過去のデータなし</div>';
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
    const workDateInput = document.getElementById('work-date');
    if (workDateInput) {
        workDateInput.value = dateStr;
        refreshCalc();
    }

    const el = document.getElementById(`group-${dateStr}`);
    if (el) {
        document.querySelectorAll('.day-group').forEach(g => g.classList.remove('open'));
        el.classList.add('open');
        const arrow = el.querySelector('.arrow');
        if (arrow) arrow.innerText = '▼';
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
function saveCalcSettings() {
    const sets = DB.load('taxi_v11_sets', {
        goal: CONFIG.DEFAULT_GOAL,
        days: CONFIG.DEFAULT_DAYS,
        baseStartTime: CONFIG.DEFAULT_START_TIME,
        standardWorkHours: CONFIG.DEFAULT_STANDARD_WORK_HOURS,
        standardWorkMinutes: CONFIG.DEFAULT_STANDARD_WORK_MINUTES
    });
    
    const sy = parseInt(document.getElementById('set-year').value);
    const sm = parseInt(document.getElementById('set-month').value);
    
    if (!isNaN(sy) && !isNaN(sm)) {
        const key = `${sy}-${String(sm).padStart(2, '0')}`;
        if (!sets.monthly) sets.monthly = {};
        sets.monthly[key] = {
            goal: parseFloat(document.getElementById('set-goal').value) || CONFIG.DEFAULT_GOAL,
            days: parseFloat(document.getElementById('set-days').value) || CONFIG.DEFAULT_DAYS,
            weekdayGoal: parseFloat(document.getElementById('set-weekday-goal').value) || 40000,
            weekendGoal: parseFloat(document.getElementById('set-weekend-goal').value) || 60000
        };
    }
    
    sets.baseStartTime = document.getElementById('set-base-start-time').value || CONFIG.DEFAULT_START_TIME;
    sets.standardWorkHours = parseFloat(document.getElementById('set-standard-work-hours').value) !== undefined ? parseFloat(document.getElementById('set-standard-work-hours').value) : CONFIG.DEFAULT_STANDARD_WORK_HOURS;
    sets.standardWorkMinutes = parseFloat(document.getElementById('set-standard-work-minutes').value) !== undefined ? parseFloat(document.getElementById('set-standard-work-minutes').value) : CONFIG.DEFAULT_STANDARD_WORK_MINUTES;
    
    DB.save('taxi_v11_sets', sets);
    refreshCalc();
}
function toggleCalcDay(dateStr) {
    const el = document.getElementById(`group-${dateStr}`);
    if (el) {
        el.classList.toggle('open');
        const arrow = el.querySelector('.arrow');
        if (arrow) {
            arrow.innerText = el.classList.contains('open') ? '▼' : '▶';
        }
    }
}
function copyBackup() { const h = localStorage.getItem('taxi_v11_hist') || '[]', s = localStorage.getItem('taxi_v11_sets') || '{}', b = btoa(unescape(encodeURIComponent(JSON.stringify({ h, s })))); navigator.clipboard.writeText(b).then(() => alert('コピー完了！')); }
function restoreBackup() {
    const s = prompt('コードを貼り付け：');
    if (!s) return;
    try {
        const d = JSON.parse(decodeURIComponent(escape(atob(s))));
        DB.save('taxi_v11_hist', d.h);
        DB.save('taxi_v11_sets', d.s);
        location.reload();
    } catch(e) {
        alert('失敗');
    }
}

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
    
    // 設定対象年月プルダウンの初期化
    const sy = UI.get('set-year'), sm = UI.get('set-month');
    if (sy && sm) {
        for(let y=new Date().getFullYear(); y>=2024; y--) { let o = document.createElement('option'); o.value=y; o.text=y+'年'; sy.add(o); }
        for(let m=1; m<=12; m++) { let o = document.createElement('option'); o.value=m; o.text=m+'月'; if(m === new Date().getMonth()+1) o.selected = true; sm.add(o); }
    }
    
    const setsInit = DB.load('taxi_v11_sets', { goal: 550000, days: 12, baseStartTime: "08:00", standardWorkHours: 19, standardWorkMinutes: 40 });
    const initY = new Date().getFullYear();
    const initM = new Date().getMonth() + 1;
    const mSetsInit = getMonthlySettings(initY, initM);
    
    if (UI.get('set-goal')) UI.get('set-goal').value = mSetsInit.goal;
    if (UI.get('set-days')) UI.get('set-days').value = mSetsInit.days;
    if (UI.get('set-weekday-goal')) UI.get('set-weekday-goal').value = mSetsInit.weekdayGoal !== undefined ? mSetsInit.weekdayGoal : 40000;
    if (UI.get('set-weekend-goal')) UI.get('set-weekend-goal').value = mSetsInit.weekendGoal !== undefined ? mSetsInit.weekendGoal : 60000;
    
    // 初回読み込み時に設定画面のカレンダーを描画
    loadMonthlySettings();

    if (UI.get('set-base-start-time')) UI.get('set-base-start-time').value = setsInit.baseStartTime || "08:00";
    if (UI.get('set-standard-work-hours')) UI.get('set-standard-work-hours').value = setsInit.standardWorkHours !== undefined ? setsInit.standardWorkHours : 19;
    if (UI.get('set-standard-work-minutes')) UI.get('set-standard-work-minutes').value = setsInit.standardWorkMinutes !== undefined ? setsInit.standardWorkMinutes : 40;
    refreshCalc();
    
    // 時給表示を最新化するためのタイマー（1分ごと）
    setInterval(refreshCalc, 60000);
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
function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const d = JSON.parse(evt.target.result);
                if (d.logs) state.logs = d.logs;
                if (d.moveLogs) state.moveLogs = d.moveLogs;
                if (d.taxiHist) DB.save('taxi_v11_hist', d.taxiHist);
                if (d.taxiSets) DB.save('taxi_v11_sets', d.taxiSets);
                DB.save('taxi_logs', state.logs);
                DB.save('move_logs', state.moveLogs);
                alert('読み込みが完了しました！');
                location.reload();
            } catch(err) {
                alert('データの読み込みに失敗しました。');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// --- 9. WORK STATE & BREAK TIMING FUNCTIONS ---
let activeBreakIntervalId = null;

function getSelectedDateStr() {
    const el = document.getElementById('work-date');
    return el ? el.value : new Date().toISOString().split('T')[0];
}

function loadWorkState(dateStr) {
    const states = DB.load('taxi_v11_work_states', {});
    const sets = DB.load('taxi_v11_sets', { goal: 550000, days: 12, baseStartTime: "08:00", standardWorkHours: 19, standardWorkMinutes: 40 });
    if (!states[dateStr]) {
        states[dateStr] = {
            startTime: sets.baseStartTime || "08:00",
            endTime: null,
            breakMinutes: CONFIG.DEFAULT_BREAK_MINUTES,
            activeBreakStarted: null,
            breaks: [],
            targetType: "auto"
        };
    }
    if (!states[dateStr].breaks) {
        states[dateStr].breaks = [];
    }
    if (!states[dateStr].targetType) {
        states[dateStr].targetType = "auto";
    }
    return states[dateStr];
}

function saveWorkState(dateStr, data) {
    const states = DB.load('taxi_v11_work_states', {});
    states[dateStr] = data;
    DB.save('taxi_v11_work_states', states);
}

function changeWorkStartTime() {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    const inputEl = document.getElementById('work-start-time');
    if (inputEl) {
        stateObj.startTime = inputEl.value;
        saveWorkState(dateStr, stateObj);
        refreshCalc();
    }
}

function changeWorkEndTime() {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    const inputEl = document.getElementById('work-end-time');
    if (inputEl) {
        stateObj.endTime = inputEl.value;
        saveWorkState(dateStr, stateObj);
        refreshCalc();
    }
}

function toggleWorkEnd() {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    const now = new Date();

    if (!stateObj.endTime) {
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        stateObj.endTime = `${hh}:${mm}`;
        if (stateObj.activeBreakStarted) {
            const start = new Date(stateObj.activeBreakStarted);
            const diffMs = now - start;
            const diffMinutes = Math.floor(diffMs / 60000);
            
            const formatTime = (d) => {
                const h = String(d.getHours()).padStart(2, '0');
                const m = String(d.getMinutes()).padStart(2, '0');
                return `${h}:${m}`;
            };
            
            stateObj.breakMinutes += diffMinutes;
            if (!stateObj.breaks) stateObj.breaks = [];
            stateObj.breaks.push({ start: formatTime(start), end: `${hh}:${mm}`, duration: diffMinutes });
            stateObj.activeBreakStarted = null;
            stopBreakTimer();
        }
        saveWorkState(dateStr, stateObj);
        alert(`退勤時刻を ${stateObj.endTime} で確定しました。`);
    } else {
        stateObj.endTime = null;
        saveWorkState(dateStr, stateObj);
        alert('リアルタイム乗務中に戻しました。');
    }
    refreshCalc();
}

function changeBreakMinutes() {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    const inputEl = document.getElementById('input-break-minutes');
    if (inputEl) {
        stateObj.breakMinutes = Math.max(0, parseInt(inputEl.value) || 0);
        saveWorkState(dateStr, stateObj);
        refreshCalc();
    }
}

function adjustBreakTime(delta) {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    stateObj.breakMinutes = Math.max(0, stateObj.breakMinutes + delta);
    saveWorkState(dateStr, stateObj);
    refreshCalc();
}

function toggleBreak() {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    const now = new Date();

    if (!stateObj.activeBreakStarted) {
        // 休憩開始
        stateObj.activeBreakStarted = now.toISOString();
        saveWorkState(dateStr, stateObj);
        startBreakTimer();
        alert('休憩計測を開始しました！');
    } else {
        // 休憩終了
        const start = new Date(stateObj.activeBreakStarted);
        const diffMs = now - start;
        const diffMinutes = Math.floor(diffMs / 60000); // 分に変換
        
        const formatTime = (d) => {
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${hh}:${mm}`;
        };
        const startStr = formatTime(start);
        const endStr = formatTime(now);

        stateObj.breakMinutes += diffMinutes;
        if (!stateObj.breaks) stateObj.breaks = [];
        stateObj.breaks.push({ start: startStr, end: endStr, duration: diffMinutes });
        stateObj.activeBreakStarted = null;
        
        saveWorkState(dateStr, stateObj);
        stopBreakTimer();
        alert(`休憩計測を終了しました。${startStr}〜${endStr} (${diffMinutes}分) 加算されました！`);
    }
    refreshCalc();
}

function startBreakTimer() {
    if (activeBreakIntervalId) clearInterval(activeBreakIntervalId);
    activeBreakIntervalId = setInterval(updateBreakTimerDisplay, 10000); // 10秒おきに表示更新
    updateBreakTimerDisplay();
}

function stopBreakTimer() {
    if (activeBreakIntervalId) {
        clearInterval(activeBreakIntervalId);
        activeBreakIntervalId = null;
    }
    const btn = document.getElementById('btn-toggle-break');
    if (btn) {
        btn.innerHTML = `<span>☕ 休憩に入る</span>`;
        btn.style.background = 'rgba(94, 92, 230, 0.15)';
        btn.style.color = '#5e5ce6';
    }
}

function updateBreakTimerDisplay() {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    const btn = document.getElementById('btn-toggle-break');
    if (!btn) return;

    if (stateObj.activeBreakStarted) {
        const start = new Date(stateObj.activeBreakStarted);
        const diffMs = new Date() - start;
        const diffMinutes = Math.floor(diffMs / 60000);
        
        btn.innerHTML = `<span>⏱️ 休憩終了 (${diffMinutes}分経過)</span>`;
        btn.style.background = 'var(--danger)';
        btn.style.color = '#fff';
    } else {
        btn.innerHTML = `<span>☕ 休憩に入る</span>`;
        btn.style.background = 'rgba(94, 92, 230, 0.15)';
        btn.style.color = '#5e5ce6';
    }
}

function editBreakSession(index) {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    if (!stateObj.breaks || !stateObj.breaks[index]) return;
    
    const b = stateObj.breaks[index];
    const newStart = prompt("開始時刻を修正 (例: 12:30)：", b.start);
    if (newStart === null || newStart === "") return;
    const newEnd = prompt("終了時刻を修正 (例: 13:30)：", b.end);
    if (newEnd === null || newEnd === "") return;
    
    const timeReg = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeReg.test(newStart) || !timeReg.test(newEnd)) {
        alert("時刻の形式が正しくありません。(例: 12:30)");
        return;
    }
    
    const calculateDuration = (startStr, endStr) => {
        const [sh, sm] = startStr.split(':').map(Number);
        const [eh, em] = endStr.split(':').map(Number);
        let diff = (eh * 60 + em) - (sh * 60 + sm);
        if (diff < 0) diff += 24 * 60;
        return diff;
    };
    
    const oldDuration = b.duration;
    const newDuration = calculateDuration(newStart, newEnd);
    
    b.start = newStart;
    b.end = newEnd;
    b.duration = newDuration;
    
    stateObj.breakMinutes = Math.max(0, stateObj.breakMinutes - oldDuration + newDuration);
    
    saveWorkState(dateStr, stateObj);
    refreshCalc();
}

function deleteBreakSession(index) {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    if (!stateObj.breaks || !stateObj.breaks[index]) return;
    
    if (confirm("この休憩記録を削除しますか？")) {
        const b = stateObj.breaks[index];
        stateObj.breakMinutes = Math.max(0, stateObj.breakMinutes - b.duration);
        stateObj.breaks.splice(index, 1);
        
        saveWorkState(dateStr, stateObj);
        refreshCalc();
    }
}

// --- 10. MONTHLY CALCULATOR SETTINGS ---
function getMonthlySettings(year, month) {
    const sets = DB.load('taxi_v11_sets', {
        goal: CONFIG.DEFAULT_GOAL,
        days: CONFIG.DEFAULT_DAYS,
        baseStartTime: CONFIG.DEFAULT_START_TIME,
        standardWorkHours: CONFIG.DEFAULT_STANDARD_WORK_HOURS,
        standardWorkMinutes: CONFIG.DEFAULT_STANDARD_WORK_MINUTES
    });
    
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!sets.monthly) {
        sets.monthly = {};
    }
    
    // データがない場合のフォールバックおよびマイグレーション
    if (!sets.monthly[key]) {
        sets.monthly[key] = {
            goal: sets.goal !== undefined ? sets.goal : CONFIG.DEFAULT_GOAL,
            days: sets.days !== undefined ? sets.days : CONFIG.DEFAULT_DAYS,
            weekdayGoal: 40000,
            weekendGoal: 60000,
            workDates: []
        };
    }
    if (sets.monthly[key].weekdayGoal === undefined) sets.monthly[key].weekdayGoal = 40000;
    if (sets.monthly[key].weekendGoal === undefined) sets.monthly[key].weekendGoal = 60000;
    if (!sets.monthly[key].workDates) sets.monthly[key].workDates = [];
    return sets.monthly[key];
}

function loadMonthlySettings() {
    const sy = parseInt(document.getElementById('set-year').value);
    const sm = parseInt(document.getElementById('set-month').value);
    if (isNaN(sy) || isNaN(sm)) return;
    
    const mSets = getMonthlySettings(sy, sm);
    if (UI.get('set-goal')) UI.get('set-goal').value = mSets.goal;
    if (UI.get('set-days')) UI.get('set-days').value = mSets.days;
    if (UI.get('set-weekday-goal')) UI.get('set-weekday-goal').value = mSets.weekdayGoal;
    if (UI.get('set-weekend-goal')) UI.get('set-weekend-goal').value = mSets.weekendGoal;
    
    // 設定カレンダーの描画
    renderSettingsCalendar(sy, sm, mSets.workDates);
}

function renderSettingsCalendar(year, month, activeDates) {
    const container = document.getElementById('settings-workdates-calendar');
    if (!container) return;
    container.innerHTML = '';
    
    const days = ['日','月','火','水','木','金','土'];
    days.forEach(d => container.innerHTML += `<div class="cal-day-label" style="font-size:0.7rem; color:var(--text-muted); font-weight:bold; padding:2px 0;">${d}</div>`);
    
    const first = new Date(year, month - 1, 1).getDay();
    const last = new Date(year, month, 0).getDate();
    
    for (let i = 0; i < first; i++) {
        container.innerHTML += '<div></div>';
    }
    
    for (let d = 1; d <= last; d++) {
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isActive = activeDates.includes(dateStr);
        container.innerHTML += `<div class="cal-cell ${isActive ? 'set-active' : ''}" style="aspect-ratio:1.2; font-size:0.8rem; border-radius:8px;" onclick="toggleSettingsWorkDate('${dateStr}')">${d}</div>`;
    }
    
    const countEl = document.getElementById('disp-settings-workdates-count');
    if (countEl) countEl.innerText = activeDates.length;
}

function toggleSettingsWorkDate(dateStr) {
    const sets = DB.load('taxi_v11_sets', {
        goal: CONFIG.DEFAULT_GOAL,
        days: CONFIG.DEFAULT_DAYS,
        baseStartTime: CONFIG.DEFAULT_START_TIME,
        standardWorkHours: CONFIG.DEFAULT_STANDARD_WORK_HOURS,
        standardWorkMinutes: CONFIG.DEFAULT_STANDARD_WORK_MINUTES
    });
    
    const [y, m] = dateStr.split('-').map(Number);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    
    if (!sets.monthly) sets.monthly = {};
    if (!sets.monthly[key]) {
        sets.monthly[key] = {
            goal: sets.goal !== undefined ? sets.goal : CONFIG.DEFAULT_GOAL,
            days: sets.days !== undefined ? sets.days : CONFIG.DEFAULT_DAYS,
            weekdayGoal: 40000,
            weekendGoal: 60000,
            workDates: []
        };
    }
    if (!sets.monthly[key].workDates) sets.monthly[key].workDates = [];
    
    const idx = sets.monthly[key].workDates.indexOf(dateStr);
    if (idx > -1) {
        sets.monthly[key].workDates.splice(idx, 1);
    } else {
        sets.monthly[key].workDates.push(dateStr);
    }
    
    // 全出勤日数を同期
    sets.monthly[key].days = sets.monthly[key].workDates.length;
    
    DB.save('taxi_v11_sets', sets);
    loadMonthlySettings();
    refreshCalc();
}

// --- 11. HOLIDAY & TARGET TYPE TOGGLE FUNCTIONS ---
function getJapaneseHolidayName(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    const w = d.getDay(); // 0:日, 6:土
    
    const getVernalEquinox = (year) => Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
    const getAutumnalEquinox = (year) => Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
    
    if (m === 1 && day === 1) return "元日";
    if (m === 2 && day === 11) return "建国記念の日";
    if (m === 2 && day === 23) return "天皇誕生日";
    if (m === 3 && day === getVernalEquinox(y)) return "春分の日";
    if (m === 4 && day === 29) return "昭和の日";
    if (m === 5 && day === 3) return "憲法記念日";
    if (m === 5 && day === 4) return "みどりの日";
    if (m === 5 && day === 5) return "こどもの日";
    if (m === 8 && day === 11) return "山の日";
    if (m === 9 && day === getAutumnalEquinox(y)) return "秋分の日";
    if (m === 11 && day === 3) return "文化の日";
    if (m === 11 && day === 23) return "勤労感謝の日";
    
    if (m === 1 && w === 1 && day >= 8 && day <= 14) return "成人の日";
    if (m === 7 && w === 1 && day >= 15 && day <= 21) return "海の日";
    if (m === 9 && w === 1 && day >= 15 && day <= 21) return "敬老の日";
    if (m === 10 && w === 1 && day >= 8 && day <= 14) return "スポーツの日";
    
    if (w === 1) {
        const prevDate = new Date(d);
        prevDate.setDate(day - 1);
        const prevDateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}-${String(prevDate.getDate()).padStart(2,'0')}`;
        if (getJapaneseHolidayName(prevDateStr)) return "振替休日";
    }
    return null;
}

function isDayBeforeHolidayOrWeekend(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    
    const w = d.getDay();
    if (w === 5 || w === 6) return true; // 金曜・土曜
    
    const nextDate = new Date(d);
    nextDate.setDate(d.getDate() + 1);
    const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,'0')}-${String(nextDate.getDate()).padStart(2,'0')}`;
    
    if (nextDate.getDay() === 0) return true; // 翌日が日曜日 ＝ 土曜日（すでに上で判定済だが念のため）
    if (getJapaneseHolidayName(nextDateStr)) return true; // 翌日が祝日 ＝ 祝前日
    
    return false;
}

function toggleTodayTargetType() {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    
    if (!stateObj.targetType || stateObj.targetType === "auto") {
        stateObj.targetType = "weekday";
    } else if (stateObj.targetType === "weekday") {
        stateObj.targetType = "weekend";
    } else {
        stateObj.targetType = "auto";
    }
    
    saveWorkState(dateStr, stateObj);
    refreshCalc();
}
