const API_URL = 'https://khmerservice.online/math/api.php';

// ================= TELEGRAM =================
const tg = window.Telegram?.WebApp || { expand:()=>{}, ready:()=>{}, initDataUnsafe:{}, HapticFeedback:null, showAlert: alert, onEvent:()=>{} };
tg.expand();
tg.ready();

// ================= STATE =================
const state = {
    telegramId: null,
    user: null,
    questions: [],
    currentQuestionIndex: 0,
    selectedOption: null,
    hasAnswered: false,
    loading: false,
    correctAnswers: 0,
    wrongAnswers: 0,
    currentTopic: null,
    userStats: null,
    quizTimer: null,
    timerSeconds: 30,
    leaderboardTab: 'xp',
    quizSessionId: null,      // anti-cheat: track active quiz on server
    quizStartSaved: false     // anti-cheat: whether we've saved the session start
};

// ================= CHAT STATE =================
let isChatReady = false;
let chatInterval = null;
let chatLastId = 0;
let chatMessagesCache = [];
let hasChatLoadedOnce = false;
let unreadChatCount = 0;
let isChatLocked = true;
let isChatInitialized = false;
const MAX_CHAT_MESSAGES = 50;

// ================= LEVEL SYSTEM =================
const LEVELS = [
    { level: 1, name: 'Beginner',     minXp: 0    },
    { level: 2, name: 'Learner',      minXp: 100  },
    { level: 3, name: 'Explorer',     minXp: 250  },
    { level: 4, name: 'Practitioner', minXp: 500  },
    { level: 5, name: 'Solver',       minXp: 900  },
    { level: 6, name: 'Analyst',      minXp: 1400 },
    { level: 7, name: 'Expert',       minXp: 2000 },
    { level: 8, name: 'Master',       minXp: 3000 },
    { level: 9, name: 'Sage',         minXp: 4500 },
    { level:10, name: 'Legend',       minXp: 6000 }
];

function getLevelInfo(xp) {
    let current = LEVELS[0], next = LEVELS[1];
    for (let i = LEVELS.length - 1; i >= 0; i--) {
        if (xp >= LEVELS[i].minXp) {
            current = LEVELS[i];
            next = LEVELS[i + 1] || null;
            break;
        }
    }
    const progress = next
        ? Math.round(((xp - current.minXp) / (next.minXp - current.minXp)) * 100)
        : 100;
    return { current, next, progress };
}

// ================= ACHIEVEMENTS =================
const ALL_ACHIEVEMENTS = [
    { id: 'first_quiz',   icon: '🎓', name: 'First Quiz',     desc: 'Complete your first quiz',          check: (u, data) => (u.total_quizzes || 0) >= 1 },
    { id: 'quiz_10',      icon: '📚', name: 'Quiz Taker',     desc: 'Complete 10 quizzes',               check: (u, data) => (u.total_quizzes || 0) >= 10 },
    { id: 'quiz_50',      icon: '🏫', name: 'Dedicated',      desc: 'Complete 50 quizzes',               check: (u, data) => (u.total_quizzes || 0) >= 50 },
    { id: 'streak_3',     icon: '🔥', name: 'On Fire',        desc: '3-day streak',                      check: (u, data) => (u.streak || 0) >= 3 },
    { id: 'streak_7',     icon: '⚡', name: 'Week Warrior',   desc: '7-day streak',                      check: (u, data) => (u.streak || 0) >= 7 },
    { id: 'streak_30',    icon: '📅', name: 'Monthly Master', desc: '30-day streak',                     check: (u, data) => (u.streak || 0) >= 30 },
    { id: 'accuracy_90',  icon: '🎯', name: 'Sharp Shooter',  desc: '90%+ accuracy overall',             check: (u, data) => (data.accuracy || 0) >= 90 },
    { id: 'accuracy_100', icon: '💯', name: 'Perfectionist',  desc: 'Get 100% on a quiz',                check: (u, data) => data.perfectQuiz },
    { id: 'xp_500',       icon: '⭐', name: 'Rising Star',    desc: 'Earn 500 XP',                       check: (u, data) => (u.xp || 0) >= 500 },
    { id: 'xp_1000',      icon: '💎', name: 'Point Hoarder',  desc: 'Earn 1000 XP',                      check: (u, data) => (u.xp || 0) >= 1000 },
    { id: 'xp_5000',      icon: '👑', name: 'XP King',        desc: 'Earn 5000 XP',                      check: (u, data) => (u.xp || 0) >= 5000 },
    { id: 'topics_all',   icon: '🌐', name: 'All Rounder',    desc: 'Complete all 4 topics',             check: (u, data) => (data.topics_completed || 0) >= 4 },
    { id: 'correct_50',   icon: '✅', name: 'Answer Machine', desc: 'Answer 50 questions correctly',     check: (u, data) => (u.total_correct || 0) >= 50 },
    { id: 'level_5',      icon: '🚀', name: 'High Flyer',     desc: 'Reach Level 5',                     check: (u, data) => getLevelInfo(u.xp || 0).current.level >= 5 },
    { id: 'level_10',     icon: '🏆', name: 'Math Legend',    desc: 'Reach Level 10 (Max)',              check: (u, data) => getLevelInfo(u.xp || 0).current.level >= 10 },
];

function computeAchievements(user, extraData = {}) {
    return ALL_ACHIEVEMENTS.map(a => ({
        ...a,
        unlocked: a.check(user, extraData)
    }));
}

// Stored unlocked IDs in localStorage
function getUnlockedIds() {
    try { return JSON.parse(localStorage.getItem('mb_unlocked') || '[]'); } catch { return []; }
}
function saveUnlockedIds(ids) {
    try { localStorage.setItem('mb_unlocked', JSON.stringify(ids)); } catch {}
}

function checkNewAchievements(user, extraData = {}) {
    const all = computeAchievements(user, extraData);
    const prev = new Set(getUnlockedIds());
    const newOnes = all.filter(a => a.unlocked && !prev.has(a.id));
    if (newOnes.length > 0) {
        const ids = all.filter(a => a.unlocked).map(a => a.id);
        saveUnlockedIds(ids);
        newOnes.forEach((a, i) => setTimeout(() => showAchievementToast(a), i * 4500));
    }
    return newOnes;
}

function showAchievementToast(achievement) {
    const toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.innerHTML = `
        <div class="achievement-toast-icon">${achievement.icon}</div>
        <div style="flex:1;min-width:0;">
            <p style="font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Achievement Unlocked</p>
            <p style="font-size:13px;font-weight:700;color:#111827;margin:2px 0;">${achievement.name}</p>
            <p style="font-size:11px;color:#6B7280;">${achievement.desc}</p>
            <div class="achievement-toast-bar"></div>
        </div>
    `;
    document.body.appendChild(toast);
    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    setTimeout(() => toast.remove(), 4200);
}

// ================= HELPERS =================
function qs(id) { return document.getElementById(id); }

function toggleMathHelper() {
    const el = qs('mathHelper');
    if (el) el.classList.toggle('hidden');
}

function insertMath(latex) {
    const input = qs('chatInput');
    if (!input) return;
    const before = input.value.slice(0, input.selectionStart);
    const after = input.value.slice(input.selectionEnd);
    const wrapper = before.endsWith(' ') || before === '' ? '' : ' ';
    input.value = before + wrapper + '$' + latex + '$ ' + after;
    input.focus();
    const newPos = (before + wrapper + '$' + latex + '$ ').length;
    input.setSelectionRange(newPos, newPos);
}

function updateLoadingProgress(percent) {
    const bar = qs('loadingBar'), text = qs('loadingPercent');
    if (bar) bar.style.width = percent + '%';
    if (text) text.textContent = percent + '%';
}

function showError(msg) {
    console.error('Error:', msg);
    tg.showAlert ? tg.showAlert(msg || 'Something went wrong') : alert(msg || 'Something went wrong');
}

function setLoading(val) {
    state.loading = val;
    const el = qs('loadingView');
    if (el) el.classList.toggle('hidden', !val);
}

function forceShowApp() {
    setLoading(false);
    const mc = qs('mainContent');
    if (mc) mc.classList.remove('hidden');
    switchView('home');
}

// ================= API =================
async function api(action, data = {}) {
    try {
        const payload = { action, telegram_id: state.telegramId, ...data };
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (e) {
        console.error('API Error:', action, e);
        return { success: false, error: 'Network error' };
    }
}

// ================= XP / LEVEL DISPLAY =================
function updateUserDisplay(u) {
    state.userStats = u;
    // Cache photo_url so other parts of the UI can use it
    if (u.photo_url) state.photoUrl = u.photo_url;

    // Update header avatar with real photo
    const headerAvatar = qs('headerAvatar');
    if (headerAvatar && u.photo_url) {
        headerAvatar.innerHTML = `<img src="${escapeHtml(u.photo_url)}" alt="me"
            class="w-full h-full object-cover"
            onerror="this.parentElement.innerHTML='∑'">`;
    }

    const xp = u.xp || 0;
    const streak = u.streak || 0;
    const lvInfo = getLevelInfo(xp);

    // Header
    const streakEl = qs('streakCount');
    const levelEl = qs('levelDisplay');
    if (streakEl) streakEl.textContent = streak;
    if (levelEl) levelEl.textContent = 'Lv ' + lvInfo.current.level;

    // XP bar under header
    const xpLabel = qs('xpLabel');
    const xpNextLabel = qs('xpNextLabel');
    const xpFill = qs('xpBarFill');
    if (xpLabel) xpLabel.textContent = xp + ' XP';
    if (xpNextLabel) {
        xpNextLabel.textContent = lvInfo.next
            ? 'Next: ' + lvInfo.next.minXp + ' XP'
            : 'MAX LEVEL';
    }
    if (xpFill) xpFill.style.width = lvInfo.progress + '%';
}

// ================= STREAK DOTS =================
function renderStreakDots(currentStreak) {
    const container = qs('streakDots');
    if (!container) return;
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const today = new Date().getDay(); // 0=Sun, 1=Mon...
    const todayIdx = today === 0 ? 6 : today - 1; // Mon=0

    container.innerHTML = days.map((d, i) => {
        let cls = 'inactive', emoji = d;
        if (i < Math.min(currentStreak, todayIdx + 1) && i <= todayIdx) cls = 'done';
        if (i === todayIdx && currentStreak > 0) { cls = 'active'; emoji = '🔥'; }
        return `<div class="streak-dot ${cls}"><span style="font-size:${cls==='active'?'14px':'11px'}">${emoji}</span></div>`;
    }).join('');
}

// ================= CHAT HELPERS =================
function getUserColor(id) {
    const colors = [
        'from-blue-500 to-blue-600','from-purple-500 to-purple-600',
        'from-orange-500 to-orange-600','from-pink-500 to-pink-600',
        'from-indigo-500 to-indigo-600','from-teal-500 to-teal-600',
        'from-red-500 to-red-600','from-green-500 to-green-600'
    ];
    return 'bg-gradient-to-br ' + colors[Math.abs(parseInt(id) || 0) % colors.length];
}

// Renders an avatar: photo if available, else colored initial fallback.
// size     = Tailwind size string e.g. 'w-9 h-9'
// rounded  = Tailwind radius e.g. 'rounded-full' or 'rounded-2xl'
// extra    = any extra classes (ring, shadow, etc.)
function avatarHtml(photoUrl, name, telegramId, size, rounded, extra = '') {
    const initial = (name || 'U').charAt(0).toUpperCase();
    const colorClass = getUserColor(telegramId);
    if (photoUrl) {
        return `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}"
                    class="${size} ${rounded} object-cover flex-shrink-0 ${extra}"
                    onerror="this.outerHTML='<div class=\'${size} ${rounded} ${colorClass} flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${extra}\'>${initial}</div>'"
                >`;
    }
    return `<div class="${size} ${rounded} ${colorClass} flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${extra}">${initial}</div>`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let selectedUser = null;

function tapUsername(el, name, userId) {
    document.querySelectorAll('.username-tapped').forEach(e => {
        if (e !== el) e.classList.remove('username-tapped');
    });
    el.classList.add('username-tapped');
    selectedUser = { id: userId, name };
    openUserProfile(selectedUser);
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

async function openUserProfile(user) {
    const modal = qs('userProfileModal');
    modal.classList.remove('hidden');

    const avatarEl = qs('profileAvatarModal');
    // photo_url may be on user object if called from leaderboard; try to fetch otherwise
    avatarEl.className = 'w-14 h-14 flex-shrink-0 glow-ring';
    avatarEl.innerHTML = avatarHtml(user.photo_url || null, user.name, user.id, 'w-14 h-14', 'rounded-full', 'glow-ring');
    qs('profileUsernameModal').textContent = user.name;

    // Try fetch real data for user
    try {
        const data = await api('get_profile', { telegram_id: user.id });
        if (data.success && data.user) {
            const u = data.user;
            const lvl = getLevelInfo(u.xp || 0);
            // Update avatar with real photo_url from server
            const avatarEl2 = qs('profileAvatarModal');
            if (avatarEl2) avatarEl2.innerHTML = avatarHtml(u.photo_url || null, user.name, user.id, 'w-14 h-14', 'rounded-full', 'glow-ring');
            qs('profileLevelModal').textContent = 'Lv ' + lvl.current.level;
            qs('profilePointsMiniModal').textContent = u.xp || 0;
            qs('profileStreakMiniModal').textContent = u.streak || 0;
            // Rank from leaderboard
            const lb = await api('get_leaderboard');
            if (lb.success) {
                const idx = (lb.leaderboard || []).findIndex(u2 => String(u2.telegram_id) === String(user.id));
                qs('profileRankMiniModal').textContent = idx >= 0 ? '#' + (idx+1) : '--';
            }
            qs('profileSubModal').textContent = lvl.current.name;
        }
    } catch (e) {
        qs('profilePointsMiniModal').textContent = '...';
        qs('profileStreakMiniModal').textContent = '...';
        qs('profileRankMiniModal').textContent = '--';
    }
}

// ================= OPEN TELEGRAM PROFILE =================
// Opens the user's real Telegram profile.
// Priority: 1) tg.openTelegramLink with username  2) in-app modal fallback
function openTelegramProfile(telegramId, firstName, username, photoUrl) {
    if (tg.openTelegramLink && username) {
        tg.openTelegramLink('https://t.me/' + username);
    } else {
        openUserProfile({ id: telegramId, name: firstName || 'User', photo_url: photoUrl || null });
    }
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function closeProfile() {
    qs('userProfileModal').classList.add('hidden');
    selectedUser = null;
}

function mentionUser() {
    if (!selectedUser) return;
    const input = qs('chatInput');
    input.value += '@' + selectedUser.name.replace(/\s+/g, '_') + ' ';
    input.focus();
    closeProfile();
}

function openFullProfile() {
    switchView('profile');
    closeProfile();
}

// ================= MATH RENDER =================
function renderMathText(text) {
    if (!text || typeof window.katex === 'undefined') return escapeHtml(text).replace(/\n/g, '<br>');
    const segments = [];
    let remaining = text, lastIndex = 0;
    const displayRegex = /\$\$([\s\S]+?)\$\$/g;
    let match;
    while ((match = displayRegex.exec(text)) !== null) {
        if (match.index > lastIndex) segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
        segments.push({ type: 'display', content: match[1].trim() });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) segments.push({ type: 'text', content: text.slice(lastIndex) });

    const final = [];
    segments.forEach(seg => {
        if (seg.type !== 'text') { final.push(seg); return; }
        const inlineRegex = /\$((?:\\\$|[^\$])+?)\$/g;
        let txt = seg.content, idx = 0, m;
        while ((m = inlineRegex.exec(txt)) !== null) {
            if (m.index > idx) final.push({ type: 'text', content: txt.slice(idx, m.index) });
            final.push({ type: 'inline', content: m[1].trim() });
            idx = m.index + m[0].length;
        }
        if (idx < txt.length) final.push({ type: 'text', content: txt.slice(idx) });
    });

    return final.map(seg => {
        if (seg.type === 'text') return escapeHtml(seg.content).replace(/\n/g, '<br>');
        try {
            return window.katex.renderToString(seg.content, { throwOnError: false, displayMode: seg.type === 'display', strict: false });
        } catch (e) {
            return escapeHtml(seg.type === 'display' ? '$$' + seg.content + '$$' : '$' + seg.content + '$');
        }
    }).join('');
}

// ================= CHAT FUNCTIONS =================
function formatChatTime(dateString) {
    return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatChatDate(dateString) {
    const d = new Date(dateString), today = new Date(), yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fakeChatLoading() {
    const overlay = qs('chatLoading'), bar = qs('chatLoadingBar'), text = qs('chatLoadingText');
    if (!overlay) return;
    overlay.style.display = 'flex';
    setChatLocked(true);
    let progress = 0;
    const interval = setInterval(() => {
        progress += 2;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            setTimeout(() => {
                overlay.style.display = 'none';
                setChatLocked(false);
                hasChatLoadedOnce = true;
            }, 200);
        }
        if (bar) bar.style.width = progress + '%';
        if (text) text.textContent = progress + '%';
    }, 80);
    setChatLocked(false);
    hasChatLoadedOnce = true;
}

async function initChat() {
    if (!isChatInitialized) {
        await loadChatMessages();
        await loadChatStats();
        isChatInitialized = true;
    }
    if (!hasChatLoadedOnce) return;
    unreadChatCount = 0;
    const badge = qs('chatBadge');
    if (badge) badge.classList.add('hidden');
    if (chatInterval) clearInterval(chatInterval);
    chatInterval = setInterval(() => {
        const chatView = qs('chatView');
        if (chatView && !chatView.classList.contains('hidden')) pollChatMessages();
    }, 3000);
}

async function loadChatMessages() {
    try {
        const data = await api('get_chat_messages', { limit: 50 });
        if (data.success && Array.isArray(data.messages)) {
            chatMessagesCache = data.messages.slice(-MAX_CHAT_MESSAGES);
            renderChatMessages();
        }
    } catch (e) { console.error('loadChatMessages error:', e); }
}

async function pollChatMessages() {
    try {
        const data = await api('get_chat_messages', { limit: 50, after_id: chatLastId });
        if (!data.success || !Array.isArray(data.messages)) return;
        const existing = new Set(chatMessagesCache.map(m => parseInt(m.id)));
        const newMsgs = data.messages.filter(m => !existing.has(parseInt(m.id)));
        if (newMsgs.length > 0) {
            chatMessagesCache.push(...newMsgs);
            if (chatMessagesCache.length > MAX_CHAT_MESSAGES) chatMessagesCache = chatMessagesCache.slice(-MAX_CHAT_MESSAGES);
            renderChatMessages();
            const hasOthers = newMsgs.some(m => m.telegram_id != state.telegramId);
            if (hasOthers && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            if (qs('chatView')?.classList.contains('hidden')) {
                unreadChatCount += newMsgs.length;
                const badge = qs('chatBadge');
                if (badge) badge.classList.remove('hidden');
            }
        }
    } catch (e) { console.error('pollChatMessages error:', e); }
}

function renderChatMessages() {
    const container = qs('chatMessages');
    if (!container) return;

    if (!chatMessagesCache || chatMessagesCache.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-400 fade-in">
                <div class="text-4xl mb-3">💬</div>
                <p class="text-sm font-semibold">No messages yet</p>
                <p class="text-xs mt-1">Be the first to say hello!</p>
            </div>`;
        return;
    }

    let html = '', lastDate = null, lastSender = null;

    chatMessagesCache.forEach(msg => {
        const msgDate = formatChatDate(msg.created_at);
        if (msgDate !== lastDate) {
            html += `<div class="flex items-center gap-3 my-4 px-2">
                <div class="flex-1 h-px bg-gray-200"></div>
                <span class="text-[10px] font-bold text-gray-400 bg-white border border-gray-200 px-3 py-1 rounded-full shadow-sm flex-shrink-0">${msgDate}</span>
                <div class="flex-1 h-px bg-gray-200"></div>
            </div>`;
            lastDate = msgDate;
            lastSender = null;
        }
        if (msg.type === 'system') {
            html += `<div class="flex justify-center my-2 message-bubble"><span class="text-[11px] text-gray-400 italic bg-white/80 px-3 py-1 rounded-full border border-gray-100">${escapeHtml(msg.message)}</span></div>`;
            return;
        }

        const isMe = String(msg.telegram_id) === String(state.telegramId);
        const time = formatChatTime(msg.created_at);
        const showAvatar = !isMe && lastSender !== msg.telegram_id;
        const xp = msg.xp || 0;
        const streak = msg.streak || 0;
        const badge = streak >= 7 ? '⚡' : streak >= 3 ? '🔥' : xp >= 1000 ? '💎' : xp >= 500 ? '⭐' : '';
        const nameStyle = xp >= 1000 ? 'name-gradient' : 'name-clean';
        const lvl = getLevelInfo(xp).current.level;

        const userNameHtml = showAvatar ? `
            <div class="flex items-center gap-1.5 mb-1">
                <p class="username-tap ${nameStyle} text-xs leading-none"
                   onclick="tapUsername(this,'${escapeHtml(msg.first_name || 'User')}','${msg.telegram_id}')">
                    ${badge ? '<span class="mr-0.5">' + badge + '</span>' : ''}${escapeHtml(msg.first_name || 'User')}
                </p>
                <span class="text-[9px] font-bold text-teal-600 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded-full leading-none">Lv${lvl}</span>
            </div>` : '';

        html += `
            <div class="flex ${isMe ? 'justify-end' : 'justify-start'} message-bubble mb-0.5 items-end gap-2">
                ${!isMe && showAvatar ? avatarHtml(msg.photo_url, msg.first_name, msg.telegram_id, 'w-8 h-8', 'rounded-2xl', 'shadow-sm mb-5 text-xs') : ''}
                ${!isMe && !showAvatar ? '<div class="w-8 flex-shrink-0"></div>' : ''}
                <div class="max-w-[75%] min-w-0">
                    ${userNameHtml}
                    <div class="${isMe
                        ? 'bg-gradient-to-br from-teal-500 to-teal-600 text-white rounded-2xl rounded-br-sm shadow-md shadow-teal-200/50'
                        : 'bg-white text-gray-800 rounded-2xl rounded-bl-sm shadow-sm border border-gray-100'
                    } px-3.5 py-2.5 break-words">
                        <p class="text-[13px] leading-relaxed katex-chat">${renderMathText(msg.message)}</p>
                    </div>
                    <p class="text-[10px] text-gray-400 mt-1 ${isMe ? 'text-right pr-1' : 'pl-1'}">${time}</p>
                </div>
            </div>`;
        lastSender = msg.telegram_id;
    });

    container.innerHTML = html;
    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
    if (chatMessagesCache.length > 0) {
        chatLastId = Math.max(...chatMessagesCache.map(m => parseInt(m.id) || 0));
    }
}

async function sendChatMessage() {
    const input = qs('chatInput');
    const text = input ? input.value.trim() : '';
    if (!text || text.length > 500 || !state.telegramId) return;

    input.value = '';
    const btn = qs('sendBtn');
    if (btn) btn.disabled = true;

    const tempId = 'temp_' + Date.now();
    chatMessagesCache.push({
        id: tempId, telegram_id: state.telegramId,
        first_name: state.user?.first_name || 'You', message: text,
        created_at: new Date().toISOString(), type: 'text',
        xp: state.userStats?.xp || 0, streak: state.userStats?.streak || 0
    });
    if (chatMessagesCache.length > MAX_CHAT_MESSAGES) chatMessagesCache = chatMessagesCache.slice(-MAX_CHAT_MESSAGES);
    renderChatMessages();

    try {
        const data = await api('send_chat_message', {
            telegram_id: state.telegramId, message: text,
            first_name: state.user?.first_name || 'User',
            username: state.user?.username || null
        });
        if (data.success) {
            await loadChatMessages();
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        } else {
            chatMessagesCache = chatMessagesCache.filter(m => String(m.id) !== tempId);
            renderChatMessages();
            showError(data.error || 'Failed to send');
        }
    } catch (e) {
        chatMessagesCache = chatMessagesCache.filter(m => String(m.id) !== tempId);
        renderChatMessages();
    }
    if (btn) btn.disabled = false;
    if (input) input.focus();
}

async function loadChatStats() {
    try {
        const data = await api('get_chat_stats');
        if (data.success && data.stats) {
            const el = qs('chatUserCount');
            if (el) el.textContent = data.stats.users || 0;
        }
    } catch (e) {}
}

function setChatLocked(locked) {
    isChatLocked = locked;
    const input = qs('chatInput'), btn = qs('sendBtn');
    if (input) { input.disabled = locked; if (locked) input.blur(); }
    if (btn) btn.disabled = locked;
}

// ================= INIT =================
async function init() {
    updateLoadingProgress(5);
    setTimeout(() => {
        if (qs('loadingView') && !qs('loadingView').classList.contains('hidden')) forceShowApp();
    }, 5000);

    try {
        updateLoadingProgress(15);
        if (tg.initDataUnsafe?.user) {
            state.user = tg.initDataUnsafe.user;
            state.telegramId = state.user.id;
            const name = state.user.first_name;
            qs('userName').textContent = name;
            qs('profileName').textContent = name + (state.user.last_name ? ' ' + state.user.last_name : '');
            qs('profileInitial').textContent = name.charAt(0).toUpperCase();
        } else {
            state.telegramId = 'demo_' + Date.now();
            state.user = { id: state.telegramId, first_name: 'Demo User', username: 'demo' };
            qs('userName').textContent = 'Demo User';
            qs('profileName').textContent = 'Demo User';
            qs('profileInitial').textContent = 'D';
        }

        updateLoadingProgress(30);
        try {
            const auth = await api('auth', { user: state.user });
            if (auth.success && auth.user) updateUserDisplay(auth.user);
        } catch (e) {}

        updateLoadingProgress(55);
        try { await loadTopics(); } catch (e) {}

        updateLoadingProgress(75);
        try {
            const chatContainer = qs('chatMessages');
            if (chatContainer) {
                chatContainer.innerHTML = `<div class="space-y-2 p-4">
                    <div class="h-8 bg-gray-200 rounded-xl skeleton"></div>
                    <div class="h-8 bg-gray-200 rounded-xl skeleton w-3/4"></div>
                    <div class="h-8 bg-gray-200 rounded-xl skeleton w-1/2"></div>
                </div>`;
            }
            await loadChatMessages();
            await loadChatStats();
            isChatReady = true;
        } catch (e) {}

        updateLoadingProgress(100);
    } catch (e) { console.error('Init error:', e); }

    setTimeout(() => {
        setLoading(false);
        qs('mainContent').classList.remove('hidden');
        switchView('home');
        renderStreakDots(state.userStats?.streak || 0);
    }, 400);

    setupChatViewport();
}

// ================= VIEWPORT FIX =================
function setupChatViewport() {
    tg.onEvent('viewportChanged', () => {
        setTimeout(() => { const cm = qs('chatMessages'); if (cm) cm.scrollTop = cm.scrollHeight; }, 100);
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            setTimeout(() => {
                const cm = qs('chatMessages'); if (cm) cm.scrollTop = cm.scrollHeight;
                const input = qs('chatInput');
                if (input && document.activeElement === input) input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, 100);
        });
    }
    const chatInput = qs('chatInput');
    if (chatInput) {
        chatInput.addEventListener('focus', () => {
            setTimeout(() => {
                const cm = qs('chatMessages');
                if (cm) cm.scrollTo({ top: cm.scrollHeight, behavior: 'smooth' });
                chatInput.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, 300);
        });
        chatInput.addEventListener('blur', () => {
            setTimeout(() => { const cm = qs('chatMessages'); if (cm) cm.scrollTop = cm.scrollHeight; }, 100);
        });
    }
}

// ================= TOPICS =================
async function loadTopics() {
    try {
        const data = await api('get_questions_admin', {});
        if (!data.success || !Array.isArray(data.questions)) {
            qs('questionCount').textContent = '0 questions';
            return;
        }
        const topics = {};
        data.questions.forEach(q => { if (q.topic) topics[q.topic] = (topics[q.topic] || 0) + 1; });

        const topicConfig = [
            { id: 'Algebra',       name: 'Algebra',       icon: '📐', color: 'from-blue-500 to-blue-600',   desc: 'Equations & polynomials' },
            { id: 'Geometry',      name: 'Geometry',      icon: '📏', color: 'from-teal-500 to-teal-600',   desc: 'Shapes & theorems' },
            { id: 'Arithmetic',    name: 'Arithmetic',    icon: '🔢', color: 'from-purple-500 to-purple-600', desc: 'Numbers & operations' },
            { id: 'Trigonometry',  name: 'Trigonometry',  icon: '📊', color: 'from-orange-500 to-orange-600', desc: 'Sin, Cos, Tan' }
        ];

        const total = Object.values(topics).reduce((a, b) => a + b, 0);
        qs('questionCount').textContent = total + ' questions';

        const grid = qs('topicsGrid');
        if (grid) {
            grid.innerHTML = topicConfig.map(t => `
                <div class="topic-card bg-white rounded-2xl p-4 card-shadow" onclick="startQuiz('${t.id}')">
                    <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${t.color} flex items-center justify-center text-2xl mb-3 shadow-sm">${t.icon}</div>
                    <h4 class="font-bold text-gray-900 text-sm">${t.name}</h4>
                    <p class="text-[11px] text-gray-400 mt-1">${topics[t.id] || 0} questions</p>
                    <p class="text-[11px] text-gray-300 mt-0.5">${t.desc}</p>
                </div>`).join('');
        }
    } catch (e) { console.error('loadTopics error:', e); }
}

function checkAdminMessage() {}
function dismissBanner() {
    const b = qs('adminBanner'); if (b) b.classList.add('hidden');
}

// ================= QUIZ TIMER =================
function startTimer(seconds) {
    clearTimer();
    state.timerSeconds = seconds;
    const ring = qs('timerRing'), text = qs('timerText');
    const circumference = 97.4;

    state.quizTimer = setInterval(() => {
        state.timerSeconds--;
        if (text) text.textContent = state.timerSeconds;
        if (ring) {
            const offset = circumference - (state.timerSeconds / seconds) * circumference;
            ring.style.strokeDashoffset = offset;
            ring.style.stroke = state.timerSeconds <= 5 ? '#EF4444' : '#0D7377';
        }
        if (state.timerSeconds <= 0) {
            clearTimer();
            if (!state.hasAnswered) {
                state.hasAnswered = true;
                state.wrongAnswers++;
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
                // Highlight correct
                const q = state.questions[state.currentQuestionIndex];
                document.querySelectorAll('.option-btn').forEach((btn, idx) => {
                    btn.disabled = true;
                    if (idx === parseInt(q.correct)) btn.classList.add('correct');
                });
                const checkBtn = qs('checkBtn');
                checkBtn.textContent = '⏰ Time Up!';
                checkBtn.disabled = false;
                checkBtn.onclick = nextQuestion;
            }
        }
    }, 1000);
}

function clearTimer() {
    if (state.quizTimer) { clearInterval(state.quizTimer); state.quizTimer = null; }
}

// ================= ANTI-CHEAT: QUIZ SESSION =================
// When a quiz starts, we immediately record it on the server as "in progress".
// If the user closes the mini-app or navigates away before finishing, the server
// treats all un-answered questions as wrong so the quiz still counts as solved.
async function saveQuizSessionStart() {
    if (!state.questions.length || !state.telegramId) return;
    try {
        // Send correct:0, wrong:0 — the backend must NOT add these to
        // total_correct / total_wrong on status:'started'.
        // It should only record that the quiz was opened (lightweight row).
        // Real counts come in when status:'completed' arrives from finishQuiz().
        // This fixes the bug where total_questions ballooned because each quiz
        // open was writing wrong:5 AND then finish wrote the real numbers again.
        const result = await api('submit_quiz', {
            results: {
                topic: state.currentTopic,
                correct: 0,
                wrong: 0,
                total: state.questions.length,
                accuracy: 0,
                questions: state.questions.map(q => q.id),
                status: 'started'
            }
        });
        state.quizSessionId = result?.session_id || result?.quiz_id || null;
        state.quizStartSaved = true;
    } catch (e) {
        console.warn('Could not save quiz session start:', e);
    }
}

// ================= QUIZ =================
async function startQuiz(topic) {
    if (state.loading) return;
    clearTimer();
    state.currentTopic = topic;
    state.currentQuestionIndex = 0;
    state.correctAnswers = 0;
    state.wrongAnswers = 0;
    state.quizSessionId = null;
    state.quizStartSaved = false;

    setLoading(true);
    try {
        const data = await api('get_questions', { topic, limit: 5 });
        setLoading(false);
        if (!data.success || !data.questions?.length) {
            showError('No questions available for this topic');
            return;
        }
        state.questions = data.questions;
        switchView('quiz');
        loadQuestion();
        // ANTI-CHEAT: Save to DB immediately. If the student closes the app or
        // clicks "Back Home" before answering, the record already exists with
        // 0 correct answers — so peeking and leaving counts as a failed attempt.
        saveQuizSessionStart();
    } catch (e) {
        setLoading(false);
        showError('Failed to load questions');
    }
}

function startDailyChallenge() {
    const topics = ['Algebra', 'Geometry', 'Arithmetic', 'Trigonometry'];
    startQuiz(topics[Math.floor(Math.random() * topics.length)]);
}

function loadQuestion() {
    const q = state.questions[state.currentQuestionIndex];
    state.selectedOption = null;
    state.hasAnswered = false;

    qs('topicBadge').textContent = q.topic || 'Topic';

    // Difficulty styling
    const diff = q.difficulty || '';
    const diffEl = qs('difficultyBadge');
    const diffColors = { Easy: 'text-green-600 bg-green-50 px-2 py-0.5 rounded-full text-xs font-bold', Medium: 'text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full text-xs font-bold', Hard: 'text-red-600 bg-red-50 px-2 py-0.5 rounded-full text-xs font-bold' };
    diffEl.className = diffColors[diff] || 'text-xs text-gray-400';
    diffEl.textContent = diff;

    qs('questionText').innerHTML = renderMathText(q.question || 'Question loading...');
    qs('currentQ').textContent = state.currentQuestionIndex + 1;
    qs('totalQ').textContent = state.questions.length;
    qs('progressBar').style.width = ((state.currentQuestionIndex / state.questions.length) * 100) + '%';

    const container = qs('optionsContainer');
    container.innerHTML = '';
    if (q.options && Array.isArray(q.options)) {
        q.options.forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn w-full border-2 border-gray-200 rounded-xl p-4 text-left flex gap-3 bg-white';
            btn.innerHTML = `
                <span class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">${String.fromCharCode(65+idx)}</span>
                <span class="flex-1 text-sm font-medium">${renderMathText(opt)}</span>`;
            btn.onclick = () => selectOption(idx, btn);
            container.appendChild(btn);
        });
    }

    const checkBtn = qs('checkBtn'), explainBtn = qs('explainBtn');
    checkBtn.disabled = true;
    explainBtn.disabled = true;
    checkBtn.textContent = 'Check';
    checkBtn.onclick = checkAnswer;
    checkBtn.classList.remove('bg-green-600', 'bg-red-600');
    checkBtn.classList.add('bg-teal-600');

    // Timer: Hard=20s, Medium=30s, Easy=45s
    const timerSecs = diff === 'Hard' ? 20 : diff === 'Easy' ? 45 : 30;
    startTimer(timerSecs);
}

function selectOption(index, btn) {
    if (state.hasAnswered) return;
    state.selectedOption = index;
    document.querySelectorAll('.option-btn').forEach(b => {
        b.classList.remove('selected');
    });
    btn.classList.add('selected');
    qs('checkBtn').disabled = false;
}

function checkAnswer() {
    if (state.selectedOption === null || state.hasAnswered) return;
    clearTimer();
    state.hasAnswered = true;

    const q = state.questions[state.currentQuestionIndex];
    const correct = parseInt(q.correct) || 0;
    const isCorrect = state.selectedOption === correct;

    document.querySelectorAll('.option-btn').forEach((btn, idx) => {
        btn.disabled = true;
        btn.classList.remove('selected');
        if (idx === correct) btn.classList.add('correct');
        else if (idx === state.selectedOption && !isCorrect) btn.classList.add('wrong');
    });

    const checkBtn = qs('checkBtn');
    if (isCorrect) {
        state.correctAnswers++;
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        checkBtn.textContent = '✓ Correct!';
        checkBtn.classList.remove('bg-teal-600');
        checkBtn.classList.add('bg-green-600');
    } else {
        state.wrongAnswers++;
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
        checkBtn.textContent = '✗ Wrong';
        checkBtn.classList.remove('bg-teal-600');
        checkBtn.classList.add('bg-red-600');
    }

    qs('explainBtn').disabled = false;
    checkBtn.onclick = nextQuestion;

    setTimeout(() => {
        checkBtn.classList.remove('bg-green-600', 'bg-red-600');
        checkBtn.classList.add('bg-teal-600');
        checkBtn.textContent = 'Next →';
    }, 1000);
}

function showExplanation() {
    clearTimer();
    const q = state.questions[state.currentQuestionIndex];
    qs('explanationContent').innerHTML = `
        <div class="mb-4 p-3 bg-gray-50 rounded-xl">
            <p class="text-xs font-bold text-gray-500 uppercase mb-1.5">Question</p>
            <p class="text-gray-700 text-sm leading-relaxed">${renderMathText(q.question || '')}</p>
        </div>
        <div class="mb-4 p-3 bg-green-50 rounded-xl border border-green-100">
            <p class="text-xs font-bold text-green-700 uppercase mb-1.5">✓ Correct Answer</p>
            <p class="text-green-700 font-semibold text-sm">${renderMathText(q.options ? q.options[q.correct] : '')}</p>
        </div>
        <div class="p-3 bg-blue-50 rounded-xl border border-blue-100">
            <p class="text-xs font-bold text-blue-700 uppercase mb-1.5">💡 Explanation</p>
            <p class="text-blue-700 text-sm leading-relaxed">${renderMathText(q.explanation || 'No explanation provided.')}</p>
        </div>`;
    switchView('explanation');
}

function backToQuiz() { switchView('quiz'); }

async function nextQuestion() {
    clearTimer();
    state.currentQuestionIndex++;
    if (state.currentQuestionIndex >= state.questions.length) {
        await finishQuiz();
        return;
    }
    if (!qs('explanationView').classList.contains('hidden')) switchView('quiz');
    loadQuestion();
}

async function finishQuiz() {
    clearTimer();
    const total = state.questions.length;
    const accuracy = total > 0 ? Math.round((state.correctAnswers / total) * 100) : 0;

    setLoading(true);
    let submitResult = null;
    try {
        submitResult = await api('submit_quiz', {
            results: {
                topic: state.currentTopic, correct: state.correctAnswers,
                wrong: state.wrongAnswers, total, accuracy,
                questions: state.questions.map(q => q.id),
                status: 'completed',
                // If we saved a session_start record, send its id so the server
                // can UPDATE it instead of INSERT a duplicate row.
                session_id: state.quizSessionId || null
            }
        });
        if (!submitResult?.success) {
            showError('Failed to save quiz: ' + (submitResult?.error || 'Server error'));
            setLoading(false);
            return;
        }
        const auth = await api('auth', { user: state.user });
        if (auth.success && auth.user) updateUserDisplay(auth.user);
    } catch (e) {
        showError('Network error. Points not saved.');
        setLoading(false);
        return;
    }
    setLoading(false);

    const pointsEarned = submitResult.xp_earned || (state.correctAnswers * 10);

    qs('finalScore').textContent = state.correctAnswers + '/' + total;
    qs('accuracyBar').style.width = accuracy + '%';
    qs('accuracyText').textContent = accuracy + '% accuracy';
    qs('correctCount').textContent = state.correctAnswers;
    qs('wrongCount').textContent = state.wrongAnswers;
    qs('pointsValue').textContent = pointsEarned;
    qs('pointsEarned').classList.remove('hidden');

    let msg = 'Keep practicing!', icon = '💪';
    if (submitResult.streak_lost) { msg = '💔 Streak Reset! Try again tomorrow.'; icon = '😅'; }
    else if (accuracy === 100) { msg = 'Perfect score! Incredible!'; icon = '🌟'; }
    else if (accuracy >= 80) { msg = 'Great work! Keep it up!'; icon = '🎉'; }
    else if (accuracy >= 60) { msg = 'Good effort! Practice makes perfect.'; icon = '👍'; }

    qs('resultMessage').textContent = msg;
    qs('resultIcon').textContent = icon;

    // Check new achievements
    const newAchievements = checkNewAchievements(state.userStats || {}, {
        accuracy,
        perfectQuiz: accuracy === 100,
        topics_completed: 0
    });

    if (newAchievements.length > 0) {
        const section = qs('quizAchievements');
        section.classList.remove('hidden');
        qs('quizAchievementsList').innerHTML = newAchievements.map(a => `
            <div class="flex items-center gap-2">
                <span class="text-xl">${a.icon}</span>
                <div>
                    <p class="text-sm font-bold text-yellow-800">${a.name}</p>
                    <p class="text-xs text-yellow-600">${a.desc}</p>
                </div>
            </div>`).join('');
    } else {
        qs('quizAchievements').classList.add('hidden');
    }

    if (accuracy >= 80) createConfetti();
    switchView('results');
}

function createConfetti() {
    const colors = ['#0D7377', '#14A085', '#FFD700', '#FF6B6B', '#4ECDC4', '#7C3AED'];
    for (let i = 0; i < 60; i++) {
        const c = document.createElement('div');
        c.className = 'confetti';
        c.style.cssText = `left:${Math.random()*100}vw;background:${colors[Math.floor(Math.random()*colors.length)]};animation-duration:${Math.random()*2+2}s;animation-delay:${Math.random()*0.5}s;border-radius:${Math.random()>0.5?'50%':'2px'}`;
        document.body.appendChild(c);
        setTimeout(() => c.remove(), 4000);
    }
}

function retryQuiz() { startQuiz(state.currentTopic); }

// ================= NAVIGATION =================
function switchView(view) {
    const allViews = ['homeView','quizView','explanationView','resultsView','profileView','leaderboardView','chatView'];
    allViews.forEach(v => {
        const el = document.getElementById(v);
        if (el) { el.classList.add('hidden'); if (v === 'chatView') el.classList.remove('flex'); }
    });
    const target = document.getElementById(view + 'View');
    if (target) { target.classList.remove('hidden'); if (view === 'chat') target.classList.add('flex'); }

    // Nav highlight
    document.querySelectorAll('.nav-btn').forEach(btn => {
        const isActive = btn.dataset.view === view;
        btn.classList.toggle('active-nav', isActive);
        btn.classList.toggle('text-teal-600', isActive);
        btn.classList.toggle('text-gray-400', !isActive);
        const indicator = btn.querySelector('.nav-indicator');
        if (indicator) indicator.style.background = isActive ? '#EEF9F9' : '';
    });

    if (view === 'profile') loadProfile();
    if (view === 'leaderboard') loadLeaderboard();
    if (view === 'chat') {
        if (!hasChatLoadedOnce) {
            setChatLocked(true);
            fakeChatLoading();
            setTimeout(() => initChat(), 50);
        } else {
            setChatLocked(false);
            initChat();
        }
    }
    if (view !== 'quiz') clearTimer();
}

function goHome() {
    // ANTI-CHEAT: if the student opened a quiz but the session-start API call
    // somehow never fired (e.g. network was too slow), fire it now so the quiz
    // is still recorded. We do NOT fire it a second time if already saved.
    // NOTE: correct:0 / wrong:0 are sent — the PHP backend must only count
    // real numbers from the status:'completed' call, never from status:'started'.
    if (state.questions.length > 0 && !state.quizStartSaved && state.currentTopic) {
        saveQuizSessionStart();
    }
    // Reset quiz state
    state.questions = [];
    state.currentQuestionIndex = 0;
    state.correctAnswers = 0;
    state.wrongAnswers = 0;
    state.quizSessionId = null;
    state.quizStartSaved = false;
    clearTimer();
    switchView('home');
}

// ================= PROFILE =================
async function loadProfile() {
    try {
        const data = await api('get_profile', { telegram_id: state.telegramId });
        if (!data.success) return;
        const u = data.user || {};
        const totalQ = (u.total_correct || 0) + ' / ' + (u.total_wrong || 0);
        qs('totalAnswered').textContent = totalQ;
        qs('bestStreak').textContent = u.best_streak || 0;
        qs('topicsCompleted').textContent = data.topics_completed || 0;
        qs('accuracyRate').textContent = (data.accuracy || 0) + '%';
        qs('profilePoints').textContent = u.xp || 0;

        // Level info
        const lvl = getLevelInfo(u.xp || 0);
        // Swap profile hero avatar with real photo
        const heroAvatar = qs('profileHeroAvatar');
        if (heroAvatar) {
            const myPhoto = u.photo_url || state.photoUrl || null;
            const myName  = state.user?.first_name || 'U';
            if (myPhoto) {
                heroAvatar.innerHTML = `<img src="${escapeHtml(myPhoto)}" alt="avatar"
                    class="w-full h-full object-cover rounded-2xl"
                    onerror="this.parentElement.innerHTML='<span id=profileInitial class=text-3xl font-extrabold>${myName.charAt(0).toUpperCase()}</span>'">`;
            }
        }
        qs('profileLevelBadge').textContent = 'Lv ' + lvl.current.level;
        qs('profileLevelLabel').textContent = 'Level ' + lvl.current.level + ' — ' + lvl.current.name;
        qs('profileXpProgress').textContent = (u.xp || 0) + ' / ' + (lvl.next?.minXp || '∞') + ' XP';
        qs('profileXpBar').style.width = lvl.progress + '%';
        qs('profileXpNext').textContent = lvl.next
            ? ((lvl.next.minXp - (u.xp || 0)) + ' XP to Level ' + lvl.next.level)
            : '🏆 Maximum Level Reached!';

        // Achievements
        const achievements = computeAchievements(u, {
            accuracy: data.accuracy || 0,
            topics_completed: data.topics_completed || 0
        });

        const unlockedCount = achievements.filter(a => a.unlocked).length;
        const countEl = qs('achievementsCount');
        if (countEl) countEl.textContent = unlockedCount + ' / ' + achievements.length;

        qs('achievementsList').innerHTML = achievements.map(a => `
            <div class="flex items-center gap-3 p-3 rounded-xl transition-all ${a.unlocked ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border border-yellow-100' : 'bg-gray-50 achievement-locked'}">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl ${a.unlocked ? 'bg-white shadow-sm' : 'bg-gray-100'}">
                    ${a.icon}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm ${a.unlocked ? 'text-gray-900' : 'text-gray-400'}">${a.name}</p>
                    <p class="text-xs ${a.unlocked ? 'text-gray-500' : 'text-gray-300'} mt-0.5">${a.desc}</p>
                </div>
                ${a.unlocked
                    ? '<div class="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0"><span class="text-green-600 font-bold text-xs">✓</span></div>'
                    : '<div class="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0"><span class="text-gray-300 text-xs">🔒</span></div>'}
            </div>`).join('');

        // Topic mastery bars
        const topicMasteryEl = qs('topicMastery');
        const topicConfig = [
            { id: 'Algebra', icon: '📐', color: '#3B82F6' },
            { id: 'Geometry', icon: '📏', color: '#0D7377' },
            { id: 'Arithmetic', icon: '🔢', color: '#8B5CF6' },
            { id: 'Trigonometry', icon: '📊', color: '#F97316' }
        ];
        // Fetch quiz results for mastery
        try {
            const qData = await api('get_questions_admin', {});
            const results = await api('get_profile', { telegram_id: state.telegramId });
            topicMasteryEl.innerHTML = topicConfig.map(t => {
                const pct = Math.min(Math.random() * 100, 100); // placeholder; replace with real per-topic data
                return `
                <div class="flex items-center gap-3">
                    <span class="text-lg w-7 flex-shrink-0">${t.icon}</span>
                    <div class="flex-1">
                        <div class="flex justify-between mb-1">
                            <span class="text-xs font-semibold text-gray-700">${t.id}</span>
                        </div>
                        <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-700" style="width:0%;background:${t.color}" data-target="${pct}"></div>
                        </div>
                    </div>
                </div>`;
            }).join('');
            // Animate bars
            setTimeout(() => {
                topicMasteryEl.querySelectorAll('[data-target]').forEach(bar => {
                    bar.style.width = bar.dataset.target + '%';
                });
            }, 100);
        } catch (e) {}

        // Check achievements after load
        checkNewAchievements(u, { accuracy: data.accuracy || 0, topics_completed: data.topics_completed || 0 });
    } catch (e) { console.error('loadProfile error:', e); }
}

// ================= LEADERBOARD =================
let leaderboardData = [];

function switchLeaderboardTab(tab) {
    state.leaderboardTab = tab;
    qs('lbTabXp').className = tab === 'xp'
        ? 'text-xs px-3 py-1.5 rounded-lg font-semibold bg-white shadow-sm text-teal-600 transition-all'
        : 'text-xs px-3 py-1.5 rounded-lg font-semibold text-gray-400 transition-all';
    qs('lbTabStreak').className = tab === 'streak'
        ? 'text-xs px-3 py-1.5 rounded-lg font-semibold bg-white shadow-sm text-teal-600 transition-all'
        : 'text-xs px-3 py-1.5 rounded-lg font-semibold text-gray-400 transition-all';
    renderLeaderboard(leaderboardData, tab);
}

async function loadLeaderboard() {
    try {
        const data = await api('get_leaderboard');
        if (!data.success) return;
        leaderboardData = data.leaderboard || [];
        renderLeaderboard(leaderboardData, state.leaderboardTab);
    } catch (e) { console.error('loadLeaderboard error:', e); }
}

function renderLeaderboard(list, tab) {
    const sorted = [...list].sort((a, b) => tab === 'streak' ? (b.streak || 0) - (a.streak || 0) : (b.xp || 0) - (a.xp || 0));

    // User rank
    const myIdx = sorted.findIndex(u => String(u.telegram_id) === String(state.telegramId));
    qs('userRank').textContent = myIdx >= 0 ? '#' + (myIdx + 1) : '--';
    qs('userPoints').textContent = tab === 'streak'
        ? (state.userStats?.streak || 0) + ' streak'
        : (state.userStats?.xp || 0) + ' XP';

    // Podium top 3
    const top3 = sorted.slice(0, 3);
    const podium = qs('podiumDisplay');
    if (podium && top3.length >= 1) {
        const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
        const heights = top3.length === 1 ? [0, 80, 0] : [55, 80, 35];
        const medals = ['🥈', '🥇', '🥉'];
        const podiumIdxMap = [1, 0, 2]; // display order -> sorted idx
        podium.innerHTML = podiumOrder.map((u, pi) => {
            const h = heights[pi];
            const medal = medals[pi];
            const isMe = u && String(u.telegram_id) === String(state.telegramId);
            const safeName = (u?.first_name || 'User').replace(/'/g, "\'");
            const safeUsername = (u?.username || '').replace(/'/g, "\'");
            const safePhoto = (u?.photo_url || '').replace(/'/g, "\'");
            return u ? `
                <div class="flex flex-col items-center flex-1 cursor-pointer active:opacity-70 transition-opacity"
                     onclick="openTelegramProfile('${u.telegram_id}','${safeName}','${safeUsername}','${safePhoto}')">
                    <div class="text-lg mb-1">${medal}</div>
                    ${avatarHtml(u.photo_url, u.first_name, u.telegram_id, 'w-11 h-11', 'rounded-2xl', (isMe ? 'ring-2 ring-offset-1 ring-teal-500 ' : '') + 'shadow-md mb-1')}
                    <p class="text-[10px] font-bold text-gray-700 truncate max-w-[60px] text-center">${u.first_name || 'User'}</p>
                    <p class="text-[10px] text-gray-400">${tab === 'streak' ? (u.streak||0)+'🔥' : (u.xp||0)+' XP'}</p>
                    <div class="w-full rounded-t-xl mt-1 flex items-center justify-center font-bold text-white text-xs" 
                        style="height:${h}px;background:${pi===1?'linear-gradient(180deg,#F59E0B,#D97706)':pi===0?'linear-gradient(180deg,#94A3B8,#64748B)':'linear-gradient(180deg,#D97706,#B45309)'}">
                        #${podiumIdxMap[pi]+1}
                    </div>
                </div>` : '<div class="flex-1"></div>';
        }).join('');
    }

    // Full list — each row tappable to open Telegram profile
    const listEl = qs('leaderboardList');
    listEl.innerHTML = sorted.slice(0, 20).map((u, i) => {
        const isMe = String(u.telegram_id) === String(state.telegramId);
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
        // Safe values for inline onclick
        const safeName = (u.first_name || 'User').replace(/'/g, "\'");
        const safeUsername = (u.username || '').replace(/'/g, "\'");
        const safePhoto = (u.photo_url || '').replace(/'/g, "\'");
        return `
            <div class="flex items-center gap-3 px-4 py-3.5 ${isMe ? 'bg-teal-50' : 'active:bg-gray-100'} transition-colors cursor-pointer select-none"
                 onclick="openTelegramProfile('${u.telegram_id}','${safeName}','${safeUsername}','${safePhoto}')">
                <div class="w-8 text-center font-bold ${i < 3 ? 'text-yellow-600 text-base' : 'text-gray-400 text-sm'}">
                    ${medal || (i + 1)}
                </div>
                ${avatarHtml(u.photo_url, u.first_name, u.telegram_id, 'w-9 h-9', 'rounded-2xl', '')}
                <div class="flex-1 min-w-0">
                    <p class="font-semibold text-sm truncate ${isMe ? 'text-teal-700' : 'text-gray-900'}">
                        ${escapeHtml(u.first_name || 'User')} ${isMe ? '<span class="text-xs font-normal text-teal-500">(You)</span>' : ''}
                    </p>
                    <p class="text-[11px] text-gray-400">Lv ${getLevelInfo(u.xp||0).current.level} · ${u.streak||0}🔥</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <div class="text-right">
                        <p class="font-bold text-teal-600 text-sm">${tab === 'streak' ? (u.streak||0) : (u.xp||0)}</p>
                        <p class="text-[10px] text-gray-400">${tab === 'streak' ? 'streak' : 'XP'}</p>
                    </div>
                    <svg class="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                    </svg>
                </div>
            </div>`;
    }).join('');
}

// ================= NOTIFICATIONS =================
function showNotifications() { qs('notificationsPanel').classList.remove('hidden'); }
function hideNotifications() { qs('notificationsPanel').classList.add('hidden'); }
function clearNotifications() {
    qs('notificationsList').innerHTML = `
        <div class="text-center py-8 text-gray-400">
            <div class="text-3xl mb-2">🔔</div>
            <p class="text-sm">No notifications</p>
        </div>`;
}

// ================= START =================
console.log('MathBot script loaded');
init();
