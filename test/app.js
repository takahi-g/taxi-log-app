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

const state = {};

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

// --- 8. ECO SYSTEM & EVENTS ---
function setupEventListeners() {
    ['calc', 'history', 'settings'].forEach(tab => {
        UI.get(`tab-${tab}`)?.addEventListener('click', () => {
            document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            UI.active(`view-${tab}`);
            UI.active(`tab-${tab}`);
            if (tab === 'calc' || tab === 'history') refreshCalc();
            window.scrollTo(0, 0);
        });
    });

    // 使い方モーダルの背景クリックで閉じる処理
    const handleHelpOutsideClick = (e) => {
        if (e.target === UI.get('help-modal')) {
            closeHelpModal();
        }
    };
    UI.get('help-modal')?.addEventListener('click', handleHelpOutsideClick);
    UI.get('help-modal')?.addEventListener('touchstart', handleHelpOutsideClick, { passive: true });
    initTheme();
}
function initTheme() {
    const darkmodeCheckbox = document.getElementById('setting-darkmode');
    const isDark = DB.load('taxi_v11_dark_mode', true);
    if (darkmodeCheckbox) {
        darkmodeCheckbox.checked = isDark;
        darkmodeCheckbox.addEventListener('change', (e) => {
            const dark = e.target.checked;
            DB.save('taxi_v11_dark_mode', dark);
            applyTheme(dark);
        });
    }
    applyTheme(isDark);
}
function applyTheme(isDark) {
    if (isDark) {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
    } else {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
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
        normGrossEl.innerText = Math.round(finalNorm * 1.1).toLocaleString();
    }
}

function refreshCalc(isSave = false) {
    const history = DB.load('taxi_v11_hist', []);
    const workDateEl = document.getElementById('work-date');
    if (!workDateEl) return;
    const selectedDate = workDateEl.value;
    if (!selectedDate) return;
    
    const dispDateTextEl = document.getElementById('disp-work-date-text');
    if (dispDateTextEl) {
        const [y, m, d] = selectedDate.split('-').map(Number);
        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];
        dispDateTextEl.innerText = `${y}年${String(m).padStart(2, '0')}月${String(d).padStart(2, '0')}日(${dayOfWeek})`;
    }
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
    const goalType = getDayGoalType(selectedDate);
    let todayTargetNet = mSets.weekdayGoal !== undefined ? mSets.weekdayGoal : 40000;
    if (goalType === 'fri') todayTargetNet = mSets.friGoal !== undefined ? mSets.friGoal : 60000;
    else if (goalType === 'sat') todayTargetNet = mSets.satGoal !== undefined ? mSets.satGoal : 60000;
    else if (goalType === 'sun') todayTargetNet = mSets.sunGoal !== undefined ? mSets.sunGoal : 60000;
    else if (goalType === 'holiday') todayTargetNet = mSets.holidayGoal !== undefined ? mSets.holidayGoal : 60000;
    else if (goalType === 'eve') todayTargetNet = mSets.eveGoal !== undefined ? mSets.eveGoal : 60000;
    
    const todayRecords = monthlyData.filter(h => h.date === selectedDate);
    const todayNetSum = todayRecords.reduce((sum, h) => sum + h.net, 0);
    
    const countBadge = document.getElementById('input-count-badge');
    if (countBadge) {
        countBadge.innerText = ` (${todayRecords.length + 1}件目)`;
    }
    const finalTodayNorm = Math.max(0, todayTargetNet - todayNetSum);
    
    const celebratedDates = DB.load('taxi_v11_celebrations', {});
    const isCelebrated = celebratedDates[selectedDate] === true;
    if (isSave && finalTodayNorm <= 0 && !isCelebrated && selectedDate === todayStr) {
        startCelebration();
        celebratedDates[selectedDate] = true;
        DB.save('taxi_v11_celebrations', celebratedDates);
    } else if (finalTodayNorm > 0 && isCelebrated) {
        delete celebratedDates[selectedDate];
        DB.save('taxi_v11_celebrations', celebratedDates);
    }
    const normEl = document.getElementById('disp-norm'); 
    const normGrossEl = document.getElementById('disp-norm-gross');
    if (normEl) {
        normEl.innerText = Math.floor(finalTodayNorm).toLocaleString();
        normEl.setAttribute('data-base-norm', finalTodayNorm + (isSave ? 0 : todayNetSum));
    }
    if (normGrossEl) {
        normGrossEl.innerText = Math.round(finalTodayNorm * 1.1).toLocaleString();
    }
    const progressEl = document.getElementById('disp-progress');
    if (progressEl) {
        let weekdayText = "平日目標";
        if (goalType === 'fri') weekdayText = "金曜目標";
        else if (goalType === 'sat') weekdayText = "土曜目標";
        else if (goalType === 'sun') weekdayText = "日曜目標";
        else if (goalType === 'holiday') weekdayText = "祝日目標";
        else if (goalType === 'eve') weekdayText = "祝前日目標";
        
        progressEl.innerText = `今月: ${workedCount} / ${curDays} 回出勤 (本日目標: 税抜${todayTargetNet.toLocaleString()}円 [${weekdayText}])`;
    }
    
    const todayGrossSum = todayRecords.reduce((s, h) => s + h.gross, 0);
    const todaySumEl = document.getElementById('disp-today-sum');
    if (todaySumEl) {
        todaySumEl.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; width: 100%; padding: 5px 0;">
                <div style="font-size: 0.85rem; color: #aaa; font-weight: 600;">今日の合計売上</div>
                <div style="display: flex; gap: 20px; align-items: baseline; justify-content: center; flex-wrap: wrap;">
                    <div style="color: #FFD700; font-size: 1.8rem; font-weight: 900;">
                        <small style="font-size: 0.8rem; color: #aaa; margin-right: 4px; font-weight: normal;">税抜</small>${Math.round(todayGrossSum / 1.1).toLocaleString()}<small style="font-size: 0.9rem; margin-left: 2px;">円</small>
                    </div>
                    <div style="color: var(--success); font-size: 1.8rem; font-weight: 900;">
                        <small style="font-size: 0.8rem; color: #aaa; margin-right: 4px; font-weight: normal;">税込</small>${Math.floor(todayGrossSum).toLocaleString()}<small style="font-size: 0.9rem; margin-left: 2px;">円</small>
                    </div>
                </div>
            </div>
        `;
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
        breakHistoryList.style.display = 'block';
        let listHtml = '';
        if (workState.breaks && workState.breaks.length > 0) {
            listHtml = workState.breaks.map((b, i) => `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 4px;">
                    <span>☕ 休憩${i+1}: ${b.start} 〜 ${b.end}</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-weight:bold; color:var(--accent); margin-right:4px;">${b.duration}分</span>
                        <button onclick="editBreakSession(${i})" style="background:none; border:none; font-size:1rem; cursor:pointer; padding:2px;">✏️</button>
                        <button onclick="deleteBreakSession(${i})" style="background:none; border:none; font-size:1rem; cursor:pointer; padding:2px;">🗑️</button>
                    </div>
                </div>
            `).join('');
            listHtml = `<div style="font-weight:bold; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; color:var(--text-main); font-size:0.85rem;">⏱️ 休憩時間セッション履歴</div>` + listHtml;
        }
        
        const addBtnHtml = `
            <div style="margin-top:10px; display:flex; justify-content:flex-end;">
                <button onclick="addManualBreakSession()" style="background: var(--bg-main); border:1px solid var(--border); color: var(--text-main); padding:6px 12px; border-radius:8px; font-size:0.8rem; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:4px; -webkit-tap-highlight-color: transparent;">➕ 休憩を手動追加</button>
            </div>
        `;
        breakHistoryList.innerHTML = listHtml + addBtnHtml;
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
            btnActionEndTime.style.background = 'var(--accent)';
            btnActionEndTime.style.color = '#000';
            btnActionEndTime.style.border = 'none';
            btnActionEndTime.style.fontWeight = 'bold';
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
    
    let actualWorkHours = actualWorkMinutes / 60;
    const isManual = workState.manualWorkHours !== null && workState.manualWorkHours !== undefined;
    if (isManual) {
        actualWorkHours = workState.manualWorkHours;
    }

    const inputWorkHours = document.getElementById('input-work-hours');
    const btnResetWorkHours = document.getElementById('btn-reset-work-hours');
    if (inputWorkHours && document.activeElement !== inputWorkHours) {
        inputWorkHours.value = actualWorkHours.toFixed(1);
    }
    if (btnResetWorkHours) {
        btnResetWorkHours.style.display = isManual ? 'inline-block' : 'none';
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
    updateAnalytics();
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
    
    // 累積目標（出勤した日それぞれの目標の合計）の算出
    const workedDates = [...new Set(fHist.map(h => h.date))];
    let accumulatedTargetNet = 0;
    workedDates.forEach(dateStr => {
        const goalType = getDayGoalType(dateStr);
        let dayTargetNet = mSets.weekdayGoal !== undefined ? mSets.weekdayGoal : 40000;
        if (goalType === 'fri') dayTargetNet = mSets.friGoal !== undefined ? mSets.friGoal : 60000;
        else if (goalType === 'sat') dayTargetNet = mSets.satGoal !== undefined ? mSets.satGoal : 60000;
        else if (goalType === 'sun') dayTargetNet = mSets.sunGoal !== undefined ? mSets.sunGoal : 60000;
        else if (goalType === 'holiday') dayTargetNet = mSets.holidayGoal !== undefined ? mSets.holidayGoal : 60000;
        else if (goalType === 'eve') dayTargetNet = mSets.eveGoal !== undefined ? mSets.eveGoal : 60000;
        accumulatedTargetNet += dayTargetNet;
    });

    const diffNet = totalNet - accumulatedTargetNet;
    const diffEl = document.getElementById('hist-target-diff');
    if (diffEl) {
        if (workedDates.length === 0) {
            diffEl.style.display = 'none';
        } else {
            diffEl.style.display = 'inline-block';
            if (diffNet >= 0) {
                diffEl.style.background = 'rgba(52, 199, 89, 0.15)'; // 薄い緑
                diffEl.style.color = '#34c759'; // iOSの緑
                diffEl.innerText = `目標比: +${Math.floor(diffNet).toLocaleString()}円`;
            } else {
                diffEl.style.background = 'rgba(255, 69, 58, 0.15)'; // 薄い赤
                diffEl.style.color = '#ff453a'; // iOSの赤
                diffEl.innerText = `目標比: -${Math.floor(Math.abs(diffNet)).toLocaleString()}円`;
            }
        }
    }
    const groups = {}; fHist.sort((a,b) => a.id - b.id).forEach(h => { if(!groups[h.date]) groups[h.date] = []; groups[h.date].push(h); });
    
    const selectedDate = getSelectedDateStr();
    const selectedGroup = groups[selectedDate];
    const detailsBox = document.getElementById('selected-day-details-box');
    
    if (detailsBox) {
        const [yPart, mPart, dPart] = selectedDate.split('-');
        if (selectedGroup && selectedGroup.length > 0) {
            const sumNet = selectedGroup.reduce((s, h) => s + h.net, 0);
            const sumGross = selectedGroup.reduce((s, h) => s + h.gross, 0);
            const itemsHtml = selectedGroup.map((h, i) => {
                if (h.isCancel) {
                    return `
                        <div class="detail-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); opacity: 0.8;">
                            <div>
                                <div class="detail-label" style="font-size:0.95rem; font-weight:700; color:var(--ios-blue); margin-bottom: 2px;">${i+1}件目</div>
                                <div class="detail-value" style="font-size: 1.15rem; font-weight: 700; color: #ff453a; text-decoration: line-through;">キャンセル</div>
                            </div>
                            <div class="detail-actions">
                                <button class="btn-trash" onclick="deleteCalcData(${h.id})" style="background:none; border:none; font-size:1.1rem; cursor:pointer; padding:5px;">🗑️</button>
                            </div>
                        </div>
                    `;
                }
                return `
                    <div class="detail-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div>
                            <div class="detail-label" style="font-size:0.95rem; font-weight:700; color:var(--ios-blue); margin-bottom: 2px;">${i+1}件目</div>
                            <div class="detail-value" style="display: flex; gap: 10px; font-size: 1.15rem; align-items: baseline; margin-top: 2px; flex-wrap: nowrap; white-space: nowrap;">
                                <span style="color: #FFD700; font-weight: 700; white-space: nowrap;">${h.net.toLocaleString()}円<small style="font-size: 0.75rem; color: #8e8e93; font-weight: normal; margin-left: 2px;">抜</small></span>
                                <span style="color: var(--success); font-weight: 700; white-space: nowrap;">${h.gross.toLocaleString()}円<small style="font-size: 0.75rem; color: #8e8e93; font-weight: normal; margin-left: 2px;">込</small></span>
                            </div>
                        </div>
                        <div class="detail-actions">
                            <button class="btn-pencil" onclick="editCalcData(${h.id})" style="background:none; border:none; font-size:1.1rem; cursor:pointer; padding:5px;">✏️</button>
                            <button class="btn-trash" onclick="deleteCalcData(${h.id})" style="background:none; border:none; font-size:1.1rem; cursor:pointer; padding:5px;">🗑️</button>
                        </div>
                    </div>
                `;
            }).reverse().join('');
            
            detailsBox.innerHTML = `
                <section class="card" style="margin-bottom: 0; padding: 15px; border: 1px solid var(--accent); background: rgba(237, 180, 24, 0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px;">
                        <h3 style="margin: 0; font-size: 1rem; color: var(--accent);">📌 選択中の詳細 (${mPart}/${dPart})</h3>
                        <div style="text-align: right; display: flex; flex-direction: column; gap: 2px; line-height: 1.2; flex-shrink: 0; white-space: nowrap;">
                            <span style="font-size: 1.05rem; font-weight: 800; color: #FFD700; white-space: nowrap;"><small style="font-size:0.75rem; font-weight:normal; color:var(--text-muted); margin-right:2px;">税抜</small>${Math.floor(sumNet).toLocaleString()}円</span>
                            <span style="font-size: 1.15rem; font-weight: 900; color: var(--success); white-space: nowrap;"><small style="font-size:0.75rem; font-weight:normal; color:var(--text-muted); margin-right:2px;">税込</small>${Math.floor(sumGross).toLocaleString()}円</span>
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
        const dayHtml = groups[date].map((h, i) => {
            if (h.isCancel) {
                return `
                    <div class="detail-item" style="opacity: 0.8;">
                        <div>
                            <div class="detail-label" style="font-size:0.95rem; font-weight:700; color:var(--ios-blue); margin-bottom: 2px;">${i+1}件目</div>
                            <div class="detail-value" style="font-size: 1.15rem; font-weight: 700; color: #ff453a; text-decoration: line-through;">キャンセル</div>
                        </div>
                        <div class="detail-actions">
                            <button class="btn-trash" onclick="deleteCalcData(${h.id})">🗑️</button>
                        </div>
                    </div>
                `;
            }
            return `
                <div class="detail-item">
                    <div>
                        <div class="detail-label" style="font-size:0.95rem; font-weight:700; color:var(--ios-blue); margin-bottom: 2px;">${i+1}件目</div>
                        <div class="detail-value" style="display: flex; gap: 10px; font-size: 1.15rem; align-items: baseline; margin-top: 4px; flex-wrap: nowrap; white-space: nowrap;">
                            <span style="color: #FFD700; font-weight: 700; white-space: nowrap;">${h.net.toLocaleString()}円<small style="font-size: 0.75rem; color: #8e8e93; font-weight: normal; margin-left: 2px;">抜</small></span>
                            <span style="color: var(--success); font-weight: 700; white-space: nowrap;">${h.gross.toLocaleString()}円<small style="font-size: 0.75rem; color: #8e8e93; font-weight: normal; margin-left: 2px;">込</small></span>
                        </div>
                    </div>
                    <div class="detail-actions">
                        <button class="btn-pencil" onclick="editCalcData(${h.id})">✏️</button>
                        <button class="btn-trash" onclick="deleteCalcData(${h.id})">🗑️</button>
                    </div>
                </div>
            `;
        });
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

// --- 📅 日付選択用カレンダーポップアップの制御 ---
let datePickerYear = new Date().getFullYear();
let datePickerMonth = new Date().getMonth() + 1;

function openDatePickerModal() {
    const curDate = document.getElementById('work-date').value || new Date().toISOString().split('T')[0];
    const [y, m] = curDate.split('-').map(Number);
    datePickerYear = y;
    datePickerMonth = m;
    
    renderDatePickerCalendar(datePickerYear, datePickerMonth);
    document.getElementById('date-picker-modal').style.display = 'flex';
}

function closeDatePickerModal() {
    document.getElementById('date-picker-modal').style.display = 'none';
}

function changeDatePickerMonth(offset) {
    datePickerMonth += offset;
    if (datePickerMonth < 1) {
        datePickerMonth = 12;
        datePickerYear--;
    } else if (datePickerMonth > 12) {
        datePickerMonth = 1;
        datePickerYear++;
    }
    renderDatePickerCalendar(datePickerYear, datePickerMonth);
}

function selectDatePickerDate(dateStr) {
    document.getElementById('work-date').value = dateStr;
    closeDatePickerModal();
    refreshCalc();
}

function renderDatePickerCalendar(year, month) {
    document.getElementById('date-picker-month-label').innerText = `${year}年${String(month).padStart(2, '0')}月`;
    const container = document.getElementById('date-picker-calendar-container');
    container.innerHTML = '';
    
    const days = ['日','月','火','水','木','金','土'];
    days.forEach(d => {
        container.innerHTML += `<div class="cal-day-label" style="font-size:0.85rem; font-weight:bold; color:var(--text-muted); padding:5px 0;">${d}</div>`;
    });
    
    const first = new Date(year, month - 1, 1).getDay();
    const last = new Date(year, month, 0).getDate();
    
    for (let i = 0; i < first; i++) {
        container.innerHTML += '<div></div>';
    }
    
    const history = DB.load('taxi_v11_hist', []);
    const selectedDate = document.getElementById('work-date').value;
    
    for (let d = 1; d <= last; d++) {
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const hasData = history.some(h => h.date === dateStr);
        const isSelected = dateStr === selectedDate;
        const isToday = dateStr === new Date().toISOString().split('T')[0];
        
        let cellStyle = `
            position: relative;
            padding: 8px 0;
            font-size: 1.05rem;
            font-weight: bold;
            border-radius: 10px;
            cursor: pointer;
            color: var(--text-main);
            background: transparent;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 40px;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
        `;
        
        if (isSelected) {
            cellStyle += 'border: 2px solid var(--ios-blue); background: rgba(0, 122, 255, 0.1);';
        } else if (isToday) {
            cellStyle += 'background: rgba(255,255,255,0.08);';
        }
        
        let dotHtml = '';
        if (hasData) {
            dotHtml = `<span style="position: absolute; bottom: 3px; width: 5px; height: 5px; background-color: var(--accent); border-radius: 50%;"></span>`;
            cellStyle += 'color: var(--accent);';
        }
        
        container.innerHTML += `
            <div style="${cellStyle}" onclick="selectDatePickerDate('${dateStr}')">
                ${d}
                ${dotHtml}
            </div>
        `;
    }
}

function saveCalcData(isCancel = false) { 
    const date = document.getElementById('work-date').value;
    const h = DB.load('taxi_v11_hist', []);
    
    if (isCancel) {
        // 現在の件数を取得して確認メッセージを表示
        const todayRecords = h.filter(x => x.date === date);
        const nextCount = todayRecords.length + 1;
        if (!confirm(`${nextCount}件目をキャンセル扱いにしますか？`)) {
            return;
        }
        
        h.push({ id: Date.now(), date, gross: 0, net: 0, isCancel: true });
        DB.save('taxi_v11_hist', h);
        refreshCalc(true);
    } else {
        const gross = parseFloat(document.getElementById('input-gross').value);
        if (!gross) return;
        h.push({ id: Date.now(), date, gross, net: Math.floor(gross/1.1) });
        DB.save('taxi_v11_hist', h);
        document.getElementById('input-gross').value = '';
        refreshCalc(true);
    }
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
        sets.monthly[key] = {
            goal: parseFloat(document.getElementById('set-goal').value) || CONFIG.DEFAULT_GOAL,
            days: parseFloat(document.getElementById('set-days').value) || CONFIG.DEFAULT_DAYS,
            weekdayGoal: parseFloat(document.getElementById('set-weekday-goal').value) || 40000,
            friGoal: parseFloat(document.getElementById('set-fri-goal').value) || 60000,
            satGoal: parseFloat(document.getElementById('set-sat-goal').value) || 60000,
            sunGoal: parseFloat(document.getElementById('set-sun-goal').value) || 60000,
            holidayGoal: parseFloat(document.getElementById('set-holiday-goal').value) || 60000,
            eveGoal: parseFloat(document.getElementById('set-eve-goal').value) || 60000,
            workDates: (sets.monthly[key] && sets.monthly[key].workDates) ? sets.monthly[key].workDates : []
        };
        syncGoalWithMonthlyRates(sets, key);
    }
    
    sets.baseStartTime = document.getElementById('set-base-start-time').value || CONFIG.DEFAULT_START_TIME;
    sets.standardWorkHours = parseFloat(document.getElementById('set-standard-work-hours').value) !== undefined ? parseFloat(document.getElementById('set-standard-work-hours').value) : CONFIG.DEFAULT_STANDARD_WORK_HOURS;
    sets.standardWorkMinutes = parseFloat(document.getElementById('set-standard-work-minutes').value) !== undefined ? parseFloat(document.getElementById('set-standard-work-minutes').value) : CONFIG.DEFAULT_STANDARD_WORK_MINUTES;
    
    DB.save('taxi_v11_sets', sets);
    refreshCalc();
}

function applyQuickGoal(type) {
    if (type === 'other') {
        const val = document.getElementById('quick-other').value;
        if (val === '') return;
        ['set-fri-goal', 'set-sat-goal', 'set-sun-goal', 'set-holiday-goal', 'set-eve-goal'].forEach(id => {
            const target = document.getElementById(id);
            if (target) target.value = val;
        });
        saveCalcSettings();
    }
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
function copyBackup() {
    const h = localStorage.getItem('taxi_v11_hist') || '[]';
    const s = localStorage.getItem('taxi_v11_sets') || '{}';
    const w = localStorage.getItem('taxi_v11_work_states') || '{}';
    const b = btoa(unescape(encodeURIComponent(JSON.stringify({ h, s, w }))));
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(b).then(() => {
            alert('バックアップコードをクリップボードにコピーしました！そのまま貼り付けて復元してください。');
        }).catch(err => {
            prompt('コピーに失敗しました。お手数ですが以下のコードを全選択してコピーしてください：', b);
        });
    } else {
        prompt('以下のバックアップコードを全選択してコピーしてください：', b);
    }
}
function restoreBackup() {
    const s = prompt('復元するバックアップコードを貼り付けてください：');
    if (!s) return;
    try {
        const decoded = atob(s.trim());
        const parsed = JSON.parse(decodeURIComponent(escape(decoded)));
        
        const histData = typeof parsed.h === 'string' ? JSON.parse(parsed.h) : parsed.h;
        const setsData = typeof parsed.s === 'string' ? JSON.parse(parsed.s) : parsed.s;
        const workData = parsed.w ? (typeof parsed.w === 'string' ? JSON.parse(parsed.w) : parsed.w) : null;
        
        DB.save('taxi_v11_hist', histData);
        DB.save('taxi_v11_sets', setsData);
        if (workData) {
            DB.save('taxi_v11_work_states', workData);
        }
        
        const histCount = Array.isArray(histData) ? histData.length : 0;
        alert(`データを正常に復元しました！\n(売上履歴: ${histCount}件を取り込みました)`);
        location.reload();
    } catch(e) {
        alert('データの復元に失敗しました。正しいコードを入力してください。\nエラー詳細: ' + e.message);
    }
}

function exportCSV() {
    const hist = DB.load('taxi_v11_hist', []);
    if (hist.length === 0) {
        alert("書き出す売上データがありません。");
        return;
    }

    // 日付順にソート (古い順)
    hist.sort((a, b) => a.date.localeCompare(b.date));

    const workStates = DB.load('taxi_v11_work_states', {});

    // CSVヘッダー
    let csvContent = "日付,曜日,売上金額(税抜),売上金額(税込),休憩時間(分),乗務開始時刻,乗務終了時刻\r\n";

    const weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];

    hist.forEach(item => {
        const dateStr = item.date;
        const d = new Date(dateStr);
        const dayOfWeek = weekdayNames[isNaN(d.getTime()) ? 0 : d.getDay()];
        
        const stateObj = workStates[dateStr] || {};
        const startTime = stateObj.startTime || "";
        const endTime = stateObj.endTime || "";
        const breakMin = stateObj.breakMinutes !== undefined ? stateObj.breakMinutes : "";

        const row = [
            dateStr,
            dayOfWeek,
            item.net,
            item.gross,
            breakMin,
            startTime,
            endTime
        ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(",");

        csvContent += row + "\r\n";
    });

    // Excelの文字化けを防ぐためにBOM（\uFEFF）を付与してUTF-8として出力
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    const today = new Date().toISOString().split('T')[0].replace(/-/g, "");
    a.href = url;
    a.download = `taxi_sales_history_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function openHelpModal() {
    UI.show('help-modal', true);
}

function closeHelpModal() {
    UI.show('help-modal', false);
}

const APP_UPDATE_INFO = {
    version: "20260723_0305",
    date: "07/23 03:05",
    title: "🎉 アップデートのお知らせ (Ver: 07/23 03:05)",
    details: [
        "📊 今日の合計売上表示において、個別計算の端数累積による税抜と税込の金額ズレを解消しました！"
    ],
    history: [
        {
            date: "07/17 13:22",
            details: [
                "☕ 休憩時間の手動追加に、5分単位の微調整やクイック設定ができる専用モーダルを導入しました！",
                "❌ 売上入力の横に『キャンセル』ボタンを配置しました！無線やGOアプリでキャンセルになった際、車内タブレットと件数表示を合わせるためのキャンセル登録に対応しました！"
            ]
        },
        {
            date: "07/13 12:08",
            details: [
                "📝 売上入力の横に、現在何件目の入力かが一目でわかる『(◯件目)』バッジを追加しました！",
                "📊 詳細履歴タブに、今現在の出勤日数に応じた目標との差額を示す『目標比 (＋ー金額)』の表示機能を追加しました！"
            ]
        },
        {
            date: "07/09 18:53",
            details: [
                "📊 売上目標を曜日・祝日（平日/金/土/日/祝/祝前日）ごとに個別設定できるようになりました！",
                "⚡ 金〜日や祝日などの『平日以外』の目標金額を、まとめて一括入力できるコピー機能を追加！",
                "📱 画面全体の文字サイズを約15%大きくし、数字やテキストがより見やすくなりました！"
            ]
        },
        {
            date: "07/07 16:43",
            details: [
                "✍️ 実稼働時間の手動入力・編集に対応しました！(「自動に戻す」ボタンでリセットも可能)",
                "✨ アプリアイコンのデザインを高級感あるゴールド仕様にリニューアルしました！",
                "📦 バックアップ・復元処理で、休憩時間や乗務詳細も完璧に引き継げるよう機能を改善しました！"
            ]
        },
        {
            date: "07/02 17:25",
            details: [
                "☕ 休憩時間の手動追加に対応しました！(売上計算の履歴エリアから追加できます)",
                "📊 Excelやスプレッドシート用CSV書き出しに対応しました！(設定から出力できます)",
                "⚙️ 設定の目標入力の順序を整理し、平日・週末の目標を上に変更しました！",
                "📖 アプリ内に『使い方ガイド』を新設しました！"
            ]
        }
    ]
};

function checkAndShowUpdateModal() {
    const infoList = document.getElementById('update-info-list');
    if (infoList) {
        infoList.innerHTML = `
            <div style="font-weight:bold; color:var(--text-main); margin-bottom:4px;">最新 Ver: ${APP_UPDATE_INFO.date}</div>
            ${APP_UPDATE_INFO.details.map(d => `<div style="display:flex; gap:6px; align-items:flex-start;"><span>•</span><span>${d}</span></div>`).join('')}
            
            <details style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
                <summary style="cursor: pointer; font-size: 0.75rem; color: var(--ios-blue); font-weight: bold; outline: none; -webkit-tap-highlight-color: transparent;">📜 過去のアップデート履歴を表示</summary>
                <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px; padding-left: 4px;">
                    ${APP_UPDATE_INFO.history.map(h => `
                        <div style="border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; margin-bottom: 4px;">
                            <div style="font-weight: bold; color: var(--text-main); font-size: 0.75rem; margin-bottom: 2px;">Ver: ${h.date}</div>
                            ${h.details.map(d => `<div style="display:flex; gap:6px; align-items:flex-start; font-size: 0.75rem;"><span>•</span><span>${d}</span></div>`).join('')}
                        </div>
                    `).join('')}
                </div>
            </details>
        `;
    }

    const lastSeen = localStorage.getItem('taxi_last_seen_version');
    if (lastSeen !== APP_UPDATE_INFO.version) {
        const titleEl = document.getElementById('update-modal-title');
        const detailsEl = document.getElementById('update-modal-details');
        if (titleEl && detailsEl) {
            titleEl.innerText = APP_UPDATE_INFO.title;
            detailsEl.innerHTML = APP_UPDATE_INFO.details.map(d => `<div style="display:flex; gap:6px; align-items:flex-start;"><span>•</span><span>${d}</span></div>`).join('');
            UI.show('update-modal', true);
        }
    }
}

function confirmUpdateViewed() {
    localStorage.setItem('taxi_last_seen_version', APP_UPDATE_INFO.version);
    UI.show('update-modal', false);
}

const APP_VERSION_INFO = {
    test: "07/23 03:05", // テスト用の日付時間
    prod: "3.2.1"       // 本番用のバージョン番号 (メジャー.新機能.修正)
};

function applyEnvironmentBranding() {
    const isTestEnv = window.location.pathname.includes('/test/');
    const versionEl = document.querySelector('.app-version');
    
    if (isTestEnv) {
        // ヘッダーロゴの書き換え
        const logoTitle = document.querySelector('.logo h1');
        if (logoTitle) {
            logoTitle.innerHTML = 'TAXI Log <span>Pro (TEST)</span>';
        }
        // ブラウザのタブタイトル書き換え
        document.title = "TAXI Log Pro (TEST)";
        
        // アプリケーションアイコンの動的書き換え
        const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
        const favicon = document.querySelector('link[rel="icon"]');
        if (appleIcon) appleIcon.href = "test-icon.png";
        if (favicon) favicon.href = "test-icon.png";
        
        // バージョン表示をテスト時間にする
        if (versionEl) versionEl.innerText = `Ver: ${APP_VERSION_INFO.test}`;
    } else {
        // 本番環境ではバージョン番号を表示する
        if (versionEl) versionEl.innerText = `Ver: ${APP_VERSION_INFO.prod}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    applyEnvironmentBranding();
    setInterval(() => UI.render('live-clock', new Date().toLocaleTimeString('ja-JP', { hour12: false })), 1000);
    setupEventListeners();

    // Initialize TAXI App calculator inputs
    const workDateInput = UI.get('work-date');
    if (workDateInput) {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        workDateInput.value = `${y}-${m}-${d}`;
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

    // アップデート情報の確認・ポップアップ表示
    checkAndShowUpdateModal();
});

function clearData() { if (confirm("すべての設定および履歴データを完全に消去しますか？")) { localStorage.clear(); location.reload(); } }

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
            targetType: "auto",
            manualWorkHours: null
        };
    }
    if (!states[dateStr].breaks) {
        states[dateStr].breaks = [];
    }
    if (!states[dateStr].targetType) {
        states[dateStr].targetType = "auto";
    }
    if (states[dateStr].manualWorkHours === undefined) {
        states[dateStr].manualWorkHours = null;
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

// --- 休憩時間モーダル制御用関数 ---
function getRoundedTime(minutesOffset = 0) {
    const now = new Date();
    if (minutesOffset !== 0) {
        now.setMinutes(now.getMinutes() + minutesOffset);
    }
    const m = now.getMinutes();
    const roundedM = Math.round(m / 5) * 5;
    now.setMinutes(roundedM);
    
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function adjustBreakModalTime(type, diffMinutes) {
    const inputId = type === 'start' ? 'break-start-time' : 'break-end-time';
    const input = document.getElementById(inputId);
    if (!input || !input.value) return;
    
    const [h, m] = input.value.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    date.setMinutes(date.getMinutes() + diffMinutes);
    
    // 5分単位に丸める
    const roundedM = Math.round(date.getMinutes() / 5) * 5;
    date.setMinutes(roundedM);
    
    const newH = String(date.getHours()).padStart(2, '0');
    const newM = String(date.getMinutes()).padStart(2, '0');
    input.value = `${newH}:${newM}`;
}

function setQuickBreakDuration(durationMinutes) {
    const startInput = document.getElementById('break-start-time');
    const endInput = document.getElementById('break-end-time');
    if (!startInput || !startInput.value || !endInput) return;
    
    const [h, m] = startInput.value.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    date.setMinutes(date.getMinutes() + durationMinutes);
    
    // 5分単位に丸める
    const roundedM = Math.round(date.getMinutes() / 5) * 5;
    date.setMinutes(roundedM);
    
    const newH = String(date.getHours()).padStart(2, '0');
    const newM = String(date.getMinutes()).padStart(2, '0');
    endInput.value = `${newH}:${newM}`;
}

function addManualBreakSession() {
    const modal = document.getElementById('break-modal');
    if (!modal) return;
    
    document.getElementById('break-modal-title').innerText = "☕ 休憩時間の追加";
    document.getElementById('break-edit-index').value = "-1";
    document.getElementById('btn-save-break').innerText = "追加する";
    
    // デフォルト値: 終了は現在時刻の5分丸め、開始はその30分前
    document.getElementById('break-end-time').value = getRoundedTime(0);
    document.getElementById('break-start-time').value = getRoundedTime(-30);
    
    modal.style.display = 'flex';
}

function editBreakSession(index) {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    if (!stateObj.breaks || !stateObj.breaks[index]) return;
    
    const b = stateObj.breaks[index];
    const modal = document.getElementById('break-modal');
    if (!modal) return;
    
    document.getElementById('break-modal-title').innerText = "☕ 休憩時間の編集";
    document.getElementById('break-edit-index').value = index;
    document.getElementById('btn-save-break').innerText = "保存する";
    
    document.getElementById('break-start-time').value = b.start;
    document.getElementById('break-end-time').value = b.end;
    
    modal.style.display = 'flex';
}

function closeBreakModal() {
    const modal = document.getElementById('break-modal');
    if (modal) modal.style.display = 'none';
}

function saveManualBreak() {
    const startStr = document.getElementById('break-start-time').value;
    const endStr = document.getElementById('break-end-time').value;
    const editIndex = parseInt(document.getElementById('break-edit-index').value);
    
    if (!startStr || !endStr) {
        alert("開始時刻と終了時刻を入力してください。");
        return;
    }
    
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    
    const calculateDuration = (s, e) => {
        const [sh, sm] = s.split(':').map(Number);
        const [eh, em] = e.split(':').map(Number);
        let diff = (eh * 60 + em) - (sh * 60 + sm);
        if (diff < 0) diff += 24 * 60; // 日またぎ対応
        return diff;
    };
    
    const duration = calculateDuration(startStr, endStr);
    
    if (duration === 0) {
        alert("休憩時間が0分になっています。正しい時間を選択してください。");
        return;
    }
    
    if (!stateObj.breaks) stateObj.breaks = [];
    
    if (editIndex === -1) {
        // 新規追加
        stateObj.breaks.push({ start: startStr, end: endStr, duration: duration });
    } else {
        // 編集保存
        if (stateObj.breaks[editIndex]) {
            stateObj.breaks[editIndex] = { start: startStr, end: endStr, duration: duration };
        }
    }
    
    // 合計休憩時間の再計算
    stateObj.breakMinutes = stateObj.breaks.reduce((sum, b) => sum + b.duration, 0);
    
    saveWorkState(dateStr, stateObj);
    refreshCalc();
    closeBreakModal();
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
    
    const m = sets.monthly[key];
    if (m.friGoal === undefined) m.friGoal = m.weekendGoal !== undefined ? m.weekendGoal : 60000;
    if (m.satGoal === undefined) m.satGoal = m.weekendGoal !== undefined ? m.weekendGoal : 60000;
    if (m.sunGoal === undefined) m.sunGoal = m.weekendGoal !== undefined ? m.weekendGoal : 60000;
    if (m.holidayGoal === undefined) m.holidayGoal = m.weekendGoal !== undefined ? m.weekendGoal : 60000;
    if (m.eveGoal === undefined) m.eveGoal = m.weekendGoal !== undefined ? m.weekendGoal : 60000;
    
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
    if (UI.get('set-fri-goal')) UI.get('set-fri-goal').value = mSets.friGoal;
    if (UI.get('set-sat-goal')) UI.get('set-sat-goal').value = mSets.satGoal;
    if (UI.get('set-sun-goal')) UI.get('set-sun-goal').value = mSets.sunGoal;
    if (UI.get('set-holiday-goal')) UI.get('set-holiday-goal').value = mSets.holidayGoal;
    if (UI.get('set-eve-goal')) UI.get('set-eve-goal').value = mSets.eveGoal;
    
    // 一括コピー用の入力フォームをリセット
    if (UI.get('quick-weekday')) UI.get('quick-weekday').value = '';
    if (UI.get('quick-other')) UI.get('quick-other').value = '';
    
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
    
    // 目標売上（税抜）を自動再計算して同期
    syncGoalWithMonthlyRates(sets, key);
    
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

function getDayGoalType(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'weekday';
    
    // 1. その日自身が祝日
    if (getJapaneseHolidayName(dateStr)) return 'holiday';
    
    const w = d.getDay();
    
    // 2. 日曜日
    if (w === 0) return 'sun';
    // 3. 土曜日
    if (w === 6) return 'sat';
    // 4. 金曜日
    if (w === 5) return 'fri';
    
    // 5. 祝前日 (翌日が祝日の月〜木曜日)
    const nextDate = new Date(d);
    nextDate.setDate(d.getDate() + 1);
    const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,'0')}-${String(nextDate.getDate()).padStart(2,'0')}`;
    if (getJapaneseHolidayName(nextDateStr)) {
        return 'eve';
    }
    
    // 6. 平日 (月〜木)
    return 'weekday';
}

function syncGoalWithMonthlyRates(sets, key) {
    const m = sets.monthly[key];
    if (!m) return;
    
    let total = 0;
    const workDates = m.workDates || [];
    workDates.forEach(dateStr => {
        const type = getDayGoalType(dateStr);
        if (type === 'weekday') total += m.weekdayGoal !== undefined ? m.weekdayGoal : 40000;
        else if (type === 'fri') total += m.friGoal !== undefined ? m.friGoal : 60000;
        else if (type === 'sat') total += m.satGoal !== undefined ? m.satGoal : 60000;
        else if (type === 'sun') total += m.sunGoal !== undefined ? m.sunGoal : 60000;
        else if (type === 'holiday') total += m.holidayGoal !== undefined ? m.holidayGoal : 60000;
        else if (type === 'eve') total += m.eveGoal !== undefined ? m.eveGoal : 60000;
    });
    
    m.goal = total;
    const goalInput = document.getElementById('set-goal');
    if (goalInput) {
        goalInput.value = total;
    }
}
function changeWorkHours() {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    const inputEl = document.getElementById('input-work-hours');
    if (inputEl) {
        const val = parseFloat(inputEl.value);
        if (!isNaN(val) && val >= 0) {
            stateObj.manualWorkHours = Math.round(val * 10) / 10;
        } else {
            stateObj.manualWorkHours = null;
        }
        saveWorkState(dateStr, stateObj);
        refreshCalc();
    }
}
function resetWorkHours() {
    const dateStr = getSelectedDateStr();
    const stateObj = loadWorkState(dateStr);
    stateObj.manualWorkHours = null;
    saveWorkState(dateStr, stateObj);
    refreshCalc();
}
function updateAnalytics() {
    const el = document.getElementById('analytics-content');
    const periodSelect = document.getElementById('analytics-period');
    if (!el) return;

    const history = DB.load('taxi_v11_hist', []);
    if (history.length === 0) {
        el.innerHTML = '<div style="text-align: center; padding: 10px 0;">売上データがありません。分析を開始するには売上を記録してください。</div>';
        if (periodSelect) periodSelect.style.display = 'none';
        return;
    }
    if (periodSelect) periodSelect.style.display = 'inline-block';

    // 期間選択肢の動的生成
    if (periodSelect) {
        const dates = history.map(h => h.date).filter(Boolean);
        const months = [...new Set(dates.map(d => d.substring(0, 7)))].sort().reverse();
        const years = [...new Set(dates.map(d => d.substring(0, 4)))].sort().reverse();

        let optionsHtml = '<option value="all">全期間</option>';
        
        // 年別グループ
        optionsHtml += '<optgroup label="年別">';
        years.forEach(y => {
            optionsHtml += `<option value="${y}">${y}年 (年間)</option>`;
        });
        optionsHtml += '</optgroup>';

        // 月別グループ
        optionsHtml += '<optgroup label="月別">';
        months.forEach(m => {
            const [y, mm] = m.split('-');
            optionsHtml += `<option value="${m}">${y}年${mm}月</option>`;
        });
        optionsHtml += '</optgroup>';

        const prevVal = periodSelect.value;
        periodSelect.innerHTML = optionsHtml;
        if (prevVal && [...periodSelect.options].some(opt => opt.value === prevVal)) {
            periodSelect.value = prevVal;
        } else {
            periodSelect.value = 'all';
        }
    }

    const period = periodSelect ? periodSelect.value : 'all';
    let filteredHistory = history;
    if (period !== 'all') {
        filteredHistory = history.filter(h => h.date.startsWith(period));
    }

    if (filteredHistory.length === 0) {
        el.innerHTML = '<div style="text-align: center; padding: 10px 0;">指定期間の売上データがありません。</div>';
        return;
    }

    const workStates = DB.load('taxi_v11_work_states', {});
    const sets = DB.load('taxi_v11_sets', { standardWorkHours: 19, standardWorkMinutes: 40 });
    const stdHours = (sets.standardWorkHours !== undefined ? sets.standardWorkHours : 19) + (sets.standardWorkMinutes !== undefined ? sets.standardWorkMinutes : 40) / 60;

    const daysData = {
        0: { name: '日', color: '#ff453a', netSum: 0, grossSum: 0, workedDays: new Set(), totalHours: 0 },
        1: { name: '月', color: 'var(--text-main)', netSum: 0, grossSum: 0, workedDays: new Set(), totalHours: 0 },
        2: { name: '火', color: 'var(--text-main)', netSum: 0, grossSum: 0, workedDays: new Set(), totalHours: 0 },
        3: { name: '水', color: 'var(--text-main)', netSum: 0, grossSum: 0, workedDays: new Set(), totalHours: 0 },
        4: { name: '木', color: 'var(--text-main)', netSum: 0, grossSum: 0, workedDays: new Set(), totalHours: 0 },
        5: { name: '金', color: 'var(--text-main)', netSum: 0, grossSum: 0, workedDays: new Set(), totalHours: 0 },
        6: { name: '土', color: '#30d158', netSum: 0, grossSum: 0, workedDays: new Set(), totalHours: 0 }
    };

    filteredHistory.forEach(item => {
        const d = new Date(item.date);
        if (isNaN(d.getTime())) return;
        const wday = d.getDay();

        daysData[wday].netSum += item.net;
        daysData[wday].grossSum += item.gross;
        daysData[wday].workedDays.add(item.date);
    });

    Object.keys(daysData).forEach(wkey => {
        const wday = parseInt(wkey);
        const data = daysData[wday];
        data.workedDays.forEach(dateStr => {
            const state = workStates[dateStr];
            let hours = stdHours;
            if (state) {
                if (state.manualWorkHours !== null && state.manualWorkHours !== undefined) {
                    hours = state.manualWorkHours;
                } else if (state.endTime) {
                    const [sh, sm] = state.startTime.split(':').map(Number);
                    const [eh, em] = state.endTime.split(':').map(Number);
                    let start = new Date(dateStr);
                    start.setHours(sh, sm, 0, 0);
                    let end = new Date(dateStr);
                    end.setHours(eh, em, 0, 0);
                    if (end <= start) {
                        end.setDate(end.getDate() + 1);
                    }
                    const diffMin = (end - start) / 60000;
                    const breakMin = state.breakMinutes || 0;
                    hours = Math.max(6, diffMin - breakMin) / 60;
                }
            }
            data.totalHours += hours;
        });
    });

    let rowsHtml = '';
    const weekdays = [1, 2, 3, 4, 5, 6, 0];
    weekdays.forEach(wday => {
        const data = daysData[wday];
        const daysCount = data.workedDays.size;
        
        const avgNet = daysCount > 0 ? Math.round(data.netSum / daysCount) : 0;
        const avgGross = daysCount > 0 ? Math.round(data.grossSum / daysCount) : 0;
        const hourlyNet = data.totalHours > 0 ? Math.round(data.netSum / data.totalHours) : 0;

        rowsHtml += `
            <tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 10px 6px; font-weight: bold; color: ${data.color}; font-size: 0.9rem;">${data.name}</td>
                <td style="padding: 10px 6px; text-align: center; color: var(--text-main); font-weight: 600;">${daysCount}回</td>
                <td style="padding: 10px 6px; text-align: right; color: #FFE596; font-weight: 700;">¥${avgNet.toLocaleString()}</td>
                <td style="padding: 10px 6px; text-align: right; color: var(--success); font-weight: 700;">¥${avgGross.toLocaleString()}</td>
                <td style="padding: 10px 6px; text-align: right; color: #5e5ce6; font-weight: bold;">¥${hourlyNet.toLocaleString()}/h</td>
            </tr>
        `;
    });

    el.innerHTML = `
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 10px; line-height: 1.4;">
            ※ 指定期間の売上履歴・勤務時間データを集計した、曜日別の平均値（手取り歩合除く）です。
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
            <thead>
                <tr style="border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.75rem;">
                    <th style="padding: 6px; text-align: left;">曜日</th>
                    <th style="padding: 6px; text-align: center;">出勤</th>
                    <th style="padding: 6px; text-align: right; color: #FFE596;">平均(税抜)</th>
                    <th style="padding: 6px; text-align: right; color: var(--success);">平均(税込)</th>
                    <th style="padding: 6px; text-align: right; color: #5e5ce6;">平均時給</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;
}
