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
    quizSessionId: null,
    quizStartSaved: false,
    onlineQuiz: false,       // true when playing community-submitted quiz
    privacyMode: false       // true when user hides their profile
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

    // Update nav creator lock icon
    const creatorNavLock = qs('creatorNavLock');
    if (creatorNavLock) creatorNavLock.style.display = lvInfo.current.level >= 3 ? 'none' : '';

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

// ================= SOLVED QUESTIONS =================
function getSolvedKey(topic) {
    return 'mb_solved_' + topic;
}

function getSolvedQuestions(topic) {
    return JSON.parse(localStorage.getItem(getSolvedKey(topic)) || '[]');
}

function markQuestionSolved(questionId) {
    const topic = state.currentTopic?.replace(' (Community)', '') || state.currentTopic;
    const key = getSolvedKey(state.currentTopic);

    // 1) localStorage (offline backup)
    let solved = JSON.parse(localStorage.getItem(key) || '[]');
    if (!solved.includes(questionId)) {
        solved.push(questionId);
        localStorage.setItem(key, JSON.stringify(solved));
    }

    // 2) Server sync immediately (prevents refresh-spam)
    api('mark_question_solved', {
        question_id: questionId,
        topic: topic
    }).catch(() => {});
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

// ================= VIEW OTHER USER FULL PROFILE =================
let _vupmUser = null;
async function openViewUserProfile(user) {
    if (!user) return;
    _vupmUser = user;
    const modal = qs('viewUserProfileModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    // Check privacy before showing
    const privKey = 'mb_privacy_' + user.id;
    // Set initial loading state
    qs('vupm-name').textContent = user.name || 'User';
    qs('vupm-title').textContent = 'Loading...';
    qs('vupm-xp').textContent = '...';
    qs('vupm-points').textContent = '...';
    qs('vupm-streak').textContent = '...';
    qs('vupm-rank').textContent = '--';
    qs('vupm-quizzes').textContent = '...';
    qs('vupm-accuracy').textContent = '...';
    qs('vupm-topics').innerHTML = '<p class="text-xs text-gray-400">Loading...</p>';
    qs('vupm-achievements').innerHTML = '';
    qs('vupm-avatar').innerHTML = avatarHtml(user.photo_url || null, user.name, user.id, 'w-16 h-16', 'rounded-2xl', '');

    try {
        const data = await api('get_profile', { telegram_id: user.id });
        if (data.success && data.user) {
            const u = data.user;

            // Respect privacy mode
            if (u.privacy_mode == 1) {
                qs('vupm-name').textContent = '🔒 Private User';
                qs('vupm-title').textContent = 'Profile is private';
                qs('vupm-xp').textContent = '--';
                qs('vupm-points').textContent = '--';
                qs('vupm-streak').textContent = '--';
                qs('vupm-rank').textContent = '--';
                qs('vupm-quizzes').textContent = '--';
                qs('vupm-accuracy').textContent = '--';
                qs('vupm-topics').innerHTML = '<p class="text-xs text-gray-400">Profile is private 🔒</p>';
                qs('vupm-lvbadge').textContent = 'Lv ?';
                return;
            }

            const lvl = getLevelInfo(u.xp || 0);
            qs('vupm-avatar').innerHTML = avatarHtml(u.photo_url || null, user.name, user.id, 'w-16 h-16', 'rounded-2xl', '');
            qs('vupm-name').textContent = u.first_name || user.name;
            qs('vupm-title').textContent = lvl.current.name;
            qs('vupm-lvbadge').textContent = 'Lv ' + lvl.current.level;
            qs('vupm-xp').textContent = u.xp || 0;
            qs('vupm-points').textContent = u.xp || 0;
            qs('vupm-streak').textContent = u.streak || 0;
            qs('vupm-quizzes').textContent = u.total_quizzes || 0;

            const acc = (u.total_correct + u.total_wrong) > 0
                ? Math.round(u.total_correct / (u.total_correct + u.total_wrong) * 100) : 0;
            qs('vupm-accuracy').textContent = acc + '%';

            // Rank
            try {
                const lb = await api('get_leaderboard');
                if (lb.success) {
                    const idx = (lb.leaderboard || []).findIndex(u2 => String(u2.telegram_id) === String(user.id));
                    qs('vupm-rank').textContent = idx >= 0 ? '#' + (idx + 1) : '--';
                }
            } catch(e) {}

            // Topic performance
            if (data.topic_stats && data.topic_stats.length > 0) {
                qs('vupm-topics').innerHTML = data.topic_stats.map(t => {
                    const acc2 = t.total > 0 ? Math.round(t.correct / t.total * 100) : 0;
                    return `<div class="mb-2">
                        <div class="flex justify-between text-xs mb-1">
                            <span class="font-semibold text-gray-700">${escapeHtml(t.topic)}</span>
                            <span class="text-gray-400">${acc2}% (${t.quizzes} quizzes)</span>
                        </div>
                        <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div class="h-full bg-gradient-to-r from-teal-500 to-teal-600 rounded-full" style="width:${acc2}%"></div>
                        </div>
                    </div>`;
                }).join('');
            } else {
                qs('vupm-topics').innerHTML = '<p class="text-xs text-gray-400">No quizzes completed yet</p>';
            }

            // Achievements
            const ach = computeAchievements(u, { accuracy: acc, topics_completed: data.topics_completed || 0 });
            const unlocked = ach.filter(a => a.unlocked);
            qs('vupm-achievements').innerHTML = unlocked.length > 0
                ? unlocked.map(a => `<span title="${escapeHtml(a.name)}" class="text-xl" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.1))">${a.icon}</span>`).join('')
                : '<p class="text-xs text-gray-400">No achievements yet</p>';
        }
    } catch(e) {
        qs('vupm-title').textContent = 'Could not load profile';
    }
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function closeViewUserProfile() {
    const modal = qs('viewUserProfileModal');
    if (modal) modal.classList.add('hidden');
    _vupmUser = null;
}

function vupmMention() {
    if (!_vupmUser) return;
    const input = qs('chatInput');
    if (input) {
        input.value += '@' + (_vupmUser.name || 'User').replace(/\s+/g, '_') + ' ';
        input.focus();
    }
    closeViewUserProfile();
    closeProfile();
    switchView('chat');
}

// ================= PRIVACY MODE =================
function loadPrivacyMode() {
    try { state.privacyMode = JSON.parse(localStorage.getItem('mb_privacy') || 'false'); } catch { state.privacyMode = false; }
    updatePrivacyUI();
}

function savePrivacyMode(val) {
    try { localStorage.setItem('mb_privacy', JSON.stringify(val)); } catch {}
}

function updatePrivacyUI() {
    const btn = qs('privacyToggleBtn');
    const thumb = qs('privacyToggleThumb');
    const explainer = qs('privacyExplainer');
    if (!btn) return;
    if (state.privacyMode) {
        btn.style.background = '#0D7377';
        if (thumb) thumb.style.transform = 'translateX(24px)';
        if (explainer) explainer.classList.remove('hidden');
    } else {
        btn.style.background = '#E5E7EB';
        if (thumb) thumb.style.transform = 'translateX(0)';
        if (explainer) explainer.classList.add('hidden');
    }
}

async function togglePrivacyMode() {
    state.privacyMode = !state.privacyMode;
    savePrivacyMode(state.privacyMode);
    updatePrivacyUI();
    // Sync to server
    try { await api('set_privacy', { privacy_mode: state.privacyMode ? 1 : 0 }); } catch(e) {}
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    const msg = state.privacyMode ? '🔒 Profile is now private' : '🌐 Profile is now public';
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#111827;color:white;padding:10px 22px;border-radius:999px;font-size:13px;font-weight:700;z-index:9999;animation:fadeIn 0.25s ease both;white-space:nowrap;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ================= ONLINE TOPIC =================
async function loadOnlineTopics() {
    try {
        const data = await api('get_community_quizzes', { summary: true });
        const grid = qs('onlineTopicsGrid');
        if (!grid) return;

        if (!data.success || !data.topics || data.topics.length === 0) {
            grid.innerHTML = `<div class="bg-white rounded-2xl p-4 text-center text-gray-400 card-shadow">
                <p class="text-2xl mb-1">🌐</p>
                <p class="text-sm font-semibold">No community quizzes yet</p>
                <p class="text-xs mt-1">Be the first to create one!</p>
            </div>`;
            return;
        }

        grid.innerHTML = data.topics.map(t => `
            <div class="bg-white rounded-2xl p-3 card-shadow flex items-center gap-3 btn-press topic-card" onclick="startOnlineQuiz('${escapeHtml(t.topic)}')">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-teal-500 flex items-center justify-center text-white text-lg flex-shrink-0">🌐</div>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm text-gray-900">${escapeHtml(t.topic)}</p>
                    <p class="text-[11px] text-gray-400">${t.count} question${t.count != 1 ? 's' : ''} · +5 XP each</p>
                </div>
                <span class="text-xs bg-green-50 text-green-700 border border-green-100 px-2 py-0.5 rounded-full font-semibold">Play</span>
            </div>`).join('');
    } catch(e) {
        const grid = qs('onlineTopicsGrid');
        if (grid) grid.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">Could not load community quizzes</div>';
    }
}

async function startOnlineQuiz(topic) {
    if (state.loading) return;
    clearTimer();
    state.currentTopic = topic + ' (Community)';
    state.currentQuestionIndex = 0;
    state.correctAnswers = 0;
    state.wrongAnswers = 0;
    state.quizSessionId = null;
    state.quizStartSaved = false;
    state.onlineQuiz = true;

    setLoading(true);
    try {
        const data = await api('get_community_quizzes', { topic });
        setLoading(false);

        if (!data.success || !data.questions?.length) {
            showError('🎉 You already solved all questions in this topic!');
            return;
        }

        // Server already filtered out solved — just pick one
        const randomQuestion = data.questions[Math.floor(Math.random() * data.questions.length)];
        state.questions = [randomQuestion];
        switchView('quiz');
        loadQuestion();
    } catch(e) {
        setLoading(false);
        showError('Failed to load community questions');
    }
}

// ================= CREATE QUIZ =================
function openCreateQuiz() {
    const lvl = getLevelInfo(state.userStats?.xp || 0).current.level;
    if (lvl < 3) {
        showError('🔒 You need to reach Level 3 to create quizzes. Keep practicing!');
        return;
    }
    // Check daily limit
    const today = new Date().toDateString();
    const lastCreate = localStorage.getItem('mb_last_create');
    if (lastCreate === today) {
        showError('⏰ You can only create 1 quiz per day. Come back tomorrow!');
        return;
    }

    const modal = qs('createQuizModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderCQOptions();
    qs('cqQuestion').value = '';
    qs('cqExplanation').value = '';
    qs('cqCorrect').value = '0';
    qs('cqTopic').value = 'Algebra';
    qs('cqPreviewBox').classList.add('hidden');
    qs('cqQuestionPreview').classList.add('hidden');
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function closeCreateQuiz() {
    const modal = qs('createQuizModal');
    if (modal) modal.classList.add('hidden');
}

function renderCQOptions() {
    const c = qs('cqOptionsContainer');
    if (!c) return;
    const letters = ['A', 'B', 'C', 'D'];
    c.innerHTML = letters.map((l, i) => `
        <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">${l}</span>
            <div class="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex items-center gap-2">
                <input type="text" id="cqOpt${i}" placeholder="Option ${l}..." class="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none">
                <button onclick="cqInsertMath('cqOpt${i}','x^2')" class="text-[10px] text-teal-600 font-bold">∑</button>
            </div>
        </div>`).join('');
}

function cqInsertMath(inputId, latex) {
    const input = qs(inputId);
    if (!input) return;
    const before = input.value.slice(0, input.selectionStart || input.value.length);
    const after = input.value.slice(input.selectionEnd || input.value.length);
    input.value = before + '$' + latex + '$ ' + after;
    input.focus();
}

function previewCreateQuiz() {
    const q = qs('cqQuestion').value.trim();
    const opts = [0,1,2,3].map(i => (qs('cqOpt' + i)?.value || '').trim());
    const correct = parseInt(qs('cqCorrect').value);
    const letters = ['A','B','C','D'];

    if (!q) { showError('Please enter a question'); return; }

    const box = qs('cqPreviewBox');
    const content = qs('cqPreviewContent');
    box.classList.remove('hidden');
    content.innerHTML = `
        <p class="font-semibold text-gray-800 mb-3">${renderMathText(q)}</p>
        ${opts.map((o, i) => `<div class="flex items-center gap-2 mb-1.5 ${i === correct ? 'text-green-700 font-semibold' : 'text-gray-600'}">
            <span class="w-6 h-6 rounded-full ${i === correct ? 'bg-green-100' : 'bg-gray-100'} flex items-center justify-center text-xs font-bold flex-shrink-0">${letters[i]}</span>
            <span class="text-sm">${renderMathText(o || '(empty)') }${i === correct ? ' ✓' : ''}</span>
        </div>`).join('')}`;
}

async function submitCreateQuiz() {
    const q = qs('cqQuestion').value.trim();
    const opts = [0,1,2,3].map(i => (qs('cqOpt' + i)?.value || '').trim());
    const correct = parseInt(qs('cqCorrect').value);
    const topic = qs('cqTopic').value;
    const explanation = qs('cqExplanation').value.trim();

    if (!q) { showError('Please enter a question'); return; }
    if (opts.some(o => !o)) { showError('Please fill in all 4 answer options'); return; }

    const btn = document.querySelector('#createQuizModal button[onclick="submitCreateQuiz()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

    try {
        const data = await api('submit_community_quiz', {
            question: q,
            options: opts,
            correct,
            topic,
            explanation
        });

        if (data.success) {
            // Record daily limit
            localStorage.setItem('mb_last_create', new Date().toDateString());
            closeCreateQuiz();
            const toast = document.createElement('div');
            toast.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#0D7377;color:white;padding:12px 24px;border-radius:999px;font-size:13px;font-weight:700;z-index:9999;animation:fadeIn 0.25s ease both;white-space:nowrap;text-align:center;`;
            toast.innerHTML = '✅ Quiz submitted!<br><span style="font-size:11px;opacity:0.85;">Admin will review it soon</span>';
            toast.style.borderRadius = '16px';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3500);
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        } else {
            showError(data.error || 'Failed to submit quiz');
        }
    } catch(e) {
        showError('Network error. Please try again.');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Quiz'; }
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
            // Smooth: only scroll-to-bottom if user is already near bottom
            const cm = qs('chatMessages');
            const wasAtBottom = cm && (cm.scrollHeight - cm.scrollTop - cm.clientHeight < 80);
            renderChatMessages(false); // false = don't force-scroll
            if (wasAtBottom && cm) cm.scrollTo({ top: cm.scrollHeight, behavior: 'smooth' });
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

function renderChatMessages(forceScroll = true) {
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

    // ── Pre-pass: tag every message with its position in its consecutive run ──
    // position: 'only' | 'first' | 'middle' | 'last'
    const tagged = [];
    chatMessagesCache.forEach((msg, i) => {
        const prev = chatMessagesCache[i - 1];
        const next = chatMessagesCache[i + 1];
        const samePrev = prev && prev.telegram_id === msg.telegram_id && prev.type !== 'system' && msg.type !== 'system';
        const sameNext = next && next.telegram_id === msg.telegram_id && next.type !== 'system' && msg.type !== 'system';
        let pos = 'only';
        if (!samePrev && sameNext)  pos = 'first';
        if (samePrev  && sameNext)  pos = 'middle';
        if (samePrev  && !sameNext) pos = 'last';
        tagged.push({ ...msg, _pos: pos });
    });

    let html = '', lastDate = null;

    tagged.forEach(msg => {
        // Date divider
        const msgDate = formatChatDate(msg.created_at);
        if (msgDate !== lastDate) {
            html += `<div class="flex items-center gap-3 my-4 px-2">
                <div class="flex-1 h-px bg-gray-200"></div>
                <span class="text-[10px] font-bold text-gray-400 bg-white border border-gray-200 px-3 py-1 rounded-full shadow-sm flex-shrink-0">${msgDate}</span>
                <div class="flex-1 h-px bg-gray-200"></div>
            </div>`;
            lastDate = msgDate;
        }

        // System message
        if (msg.type === 'system') {
            html += `<div class="flex justify-center my-2 message-bubble"><span class="text-[11px] text-gray-400 italic bg-white/80 px-3 py-1 rounded-full border border-gray-100">${escapeHtml(msg.message)}</span></div>`;
            return;
        }

        const isMe   = String(msg.telegram_id) === String(state.telegramId);
        const time   = formatChatTime(msg.created_at);
        const xp     = msg.xp || 0;
        const streak = msg.streak || 0;
        const badge  = streak >= 7 ? '⚡' : streak >= 3 ? '🔥' : xp >= 1000 ? '💎' : xp >= 500 ? '⭐' : '';
        const nameStyle = xp >= 1000 ? 'name-gradient' : 'name-clean';
        const lvl    = getLevelInfo(xp).current.level;
        const pos    = msg._pos; // 'only' | 'first' | 'middle' | 'last'

        // Avatar colour for thread line
        const colorMap = {
            'from-blue-500':'#3B82F6','from-purple-500':'#A855F7',
            'from-orange-500':'#F97316','from-pink-500':'#EC4899',
            'from-indigo-500':'#6366F1','from-teal-500':'#14B8A6',
            'from-red-500':'#EF4444','from-green-500':'#22C55E'
        };
        const colorClass = getUserColor(msg.telegram_id);
        const lineColor = Object.entries(colorMap).find(([k]) => colorClass.includes(k))?.[1] || '#94A3B8';

        // ── Decide what goes in the avatar slot ──
        // first/only  → nothing yet (avatar appears at "last")
        // middle      → vertical thread line
        // last/only   → actual avatar
        const showName   = (pos === 'first' || pos === 'only') && !isMe;
        const showAvatar = (pos === 'last'  || pos === 'only') && !isMe;
        const showLine   = (pos === 'first' || pos === 'middle') && !isMe;

        const userNameHtml = showName ? `
            <div class="flex items-center gap-1.5 mb-1">
                <p class="username-tap ${nameStyle} text-xs leading-none"
                   onclick="tapUsername(this,'${escapeHtml(msg.first_name || 'User')}','${msg.telegram_id}')">
                    ${badge ? '<span class="mr-0.5">' + badge + '</span>' : ''}${escapeHtml(msg.first_name || 'User')}
                </p>
                <span class="text-[9px] font-bold text-teal-600 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded-full leading-none">Lv${lvl}</span>
            </div>` : '';

        // Avatar slot — 32px wide to keep alignment consistent
        let avatarSlot = '';
        if (!isMe) {
            if (showAvatar) {
                avatarSlot = avatarHtml(msg.photo_url, msg.first_name, msg.telegram_id, 'w-8 h-8', 'rounded-2xl', 'shadow-sm flex-shrink-0 text-xs');
            } else if (showLine) {
                // Vertical coloured line — full height of this row
                avatarSlot = `<div class="flex-shrink-0 w-8 flex justify-center" style="align-self:stretch;">
                    <div style="width:3px;border-radius:99px;background:${lineColor};opacity:0.55;min-height:100%;margin:0 auto;"></div>
                </div>`;
            } else {
                // 'middle' already handled above; this is a safety spacer
                avatarSlot = '<div class="w-8 flex-shrink-0"></div>';
            }
        }

        // Bottom margin: tighter between messages in same run, normal otherwise
        const mb = (pos === 'first' || pos === 'middle') ? 'mb-0' : 'mb-1.5';

        html += `
            <div class="flex ${isMe ? 'justify-end' : 'justify-start'} message-bubble ${mb} items-end gap-2" data-tid="${msg.telegram_id}">
                ${!isMe ? avatarSlot : ''}
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
    });

    container.innerHTML = html;
    if (forceScroll) {
        setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
    }
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

        // Load online topics and privacy mode
        try { await loadOnlineTopics(); } catch(e) {}
        loadPrivacyMode();

        // Show create quiz button for level 3+
        try {
            const lvl = getLevelInfo(state.userStats?.xp || 0).current.level;
            if (lvl >= 3) {
                const banner = qs('createQuizBanner');
                if (banner) banner.classList.remove('hidden');
            }
        } catch(e) {}

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
            { id: 'Trigonometry',  name: 'Trigonometry',  icon: '📊', color: 'from-orange-500 to-orange-600', desc: 'Sin, Cos, Tan' },
            { id: 'Calculus', name: 'Calculus', icon: '📐', color: '#0D5390',desc: 'Calculus' }
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
                const currentQuestion = state.questions[state.currentQuestionIndex];
                markQuestionSolved(currentQuestion.id);
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
        const result = await api('submit_quiz', {
            results: {
                topic: state.currentTopic,
                correct: 0,
                wrong: state.questions.length,
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
// New approach: fetch ALL questions for topic, shuffle, serve one at a time
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
        // Server now excludes already-solved questions automatically
        const data = await api('get_questions', { topic, limit: 10 });
        setLoading(false);

        if (!data.success || !data.questions?.length) {
            showError('🎉 You already solved all questions in this topic! Great job!');
            return;
        }

        state.questions = data.questions;
        state.onlineQuiz = false;
        switchView('quiz');
        loadQuestion();
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
    state._questionStartTime = Date.now(); // Track when question was shown

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
    const currentQuestion = state.questions[state.currentQuestionIndex];
    markQuestionSolved(currentQuestion.id);
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

    // Record answer event for community quiz analytics
    if (state.onlineQuiz) {
        const q2 = state.questions[state.currentQuestionIndex];
        if (q2 && q2.id) {
            const timeTaken = state._questionStartTime
                ? Math.round((Date.now() - state._questionStartTime) / 1000)
                : null;
            api('record_quiz_answer', {
                quiz_id: q2.id,
                is_correct: isCorrect ? 1 : 0,
                time_taken_seconds: timeTaken
            }).catch(() => {});
        }
    }

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
    const isOnline = state.onlineQuiz;

    setLoading(true);
    let submitResult = null;
    try {
        const action = isOnline ? 'submit_online_quiz' : 'submit_quiz';
        submitResult = await api(action, {
            results: {
                topic: state.currentTopic, correct: state.correctAnswers,
                wrong: state.wrongAnswers, total, accuracy,
                questions: state.questions.map(q => q.id),
                status: 'completed',
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

    const pointsEarned = isOnline
        ? (state.correctAnswers * 5)
        : (submitResult.xp_earned || (state.correctAnswers * 10));

    qs('finalScore').textContent = state.correctAnswers + '/' + total;
    qs('accuracyBar').style.width = accuracy + '%';
    qs('accuracyText').textContent = accuracy + '% accuracy';
    qs('correctCount').textContent = state.correctAnswers;
    qs('wrongCount').textContent = state.wrongAnswers;
    qs('pointsValue').textContent = pointsEarned;
    qs('pointsEarned').classList.remove('hidden');

    let msg = 'Keep practicing!', icon = '💪';
    if (isOnline) {
        msg = 'Community quiz done! Streak unaffected.'; icon = '🌐';
    } else if (submitResult.streak_lost) {
        msg = '💔 Streak Reset! Try again tomorrow.'; icon = '😅';
    } else if (accuracy === 100) {
        msg = 'Perfect score! Incredible!'; icon = '🌟';
    } else if (accuracy >= 80) {
        msg = 'Great work! Keep it up!'; icon = '🎉';
    } else if (accuracy >= 60) {
        msg = 'Good effort! Practice makes perfect.'; icon = '👍';
    }

    qs('resultMessage').textContent = msg;
    qs('resultIcon').textContent = icon;

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

    if (accuracy >= 80 && !isOnline) createConfetti();
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
    const allViews = ['homeView','quizView','explanationView','resultsView','profileView','leaderboardView','chatView','creatorView'];
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
    if (view === 'creator') loadCreatorView();
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
    // ANTI-CHEAT: if the student bails out mid-quiz and we haven't already
    // saved a start record, save now with 0 correct so it counts as attempted.
    if (state.questions.length > 0 && !state.quizStartSaved && state.currentTopic) {
        saveQuizSessionStart();
    }
    // Reset quiz state so a fresh start next time
    state.questions = [];
    state.currentQuestionIndex = 0;
    state.correctAnswers = 0;
    state.wrongAnswers = 0;
    state.quizSessionId = null;
    state.quizStartSaved = false;
    switchView('home');
}

// ================= PROFILE =================
async function loadProfile() {
    try {
        const data = await api('get_profile', { telegram_id: state.telegramId });
        if (!data.success) return;
        const u = data.user || {};
        const totalQ = (u.total_correct || 0) + " / " + (u.total_wrong || 0);
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

        // Topic mastery bars using real data from topic_stats
        const topicMasteryEl = qs('topicMastery');
        const topicConfig = [
            { id: 'Algebra', icon: '📐', color: '#3B82F6' },
            { id: 'Geometry', icon: '📏', color: '#0D7377' },
            { id: 'Arithmetic', icon: '🔢', color: '#8B5CF6' },
            { id: 'Trigonometry', icon: '📊', color: '#F97316' },
            { id: 'Calculus', icon: '📐', color: '#0D5390' }
        ];
        topicMasteryEl.innerHTML = topicConfig.map(t => {
            const ts = (data.topic_stats || []).find(s => s.topic === t.id);
            const pct = ts && ts.total > 0 ? Math.round(ts.correct / ts.total * 100) : 0;
            const quizCount = ts ? ts.quizzes : 0;
            return `
            <div class="flex items-center gap-3">
                <span class="text-lg w-7 flex-shrink-0">${t.icon}</span>
                <div class="flex-1">
                    <div class="flex justify-between mb-1">
                        <span class="text-xs font-semibold text-gray-700">${t.id}</span>
                        <span class="text-xs text-gray-400">${quizCount} quizzes · ${pct}%</span>
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

        // Sync privacy mode from server data
        if (u.privacy_mode != null) {
            state.privacyMode = u.privacy_mode == 1;
            savePrivacyMode(state.privacyMode);
        }
        updatePrivacyUI();

        // Show create quiz button for level 3+
        const cqBanner = qs('createQuizBanner');
        if (cqBanner) cqBanner.classList.toggle('hidden', lvl.current.level < 3);

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
function showNotifications() {
    qs('notificationsPanel').classList.remove('hidden');
    loadUserNotifications();
}
function hideNotifications() { qs('notificationsPanel').classList.add('hidden'); }
function clearNotifications() {
    qs('notificationsList').innerHTML = `
        <div class="text-center py-8 text-gray-400">
            <div class="text-3xl mb-2">🔔</div>
            <p class="text-sm">No notifications</p>
        </div>`;
    const badge = qs('notifBadge');
    if (badge) badge.classList.add('hidden');
}

async function loadUserNotifications() {
    try {
        const data = await api('get_user_notifications');
        const list = qs('notificationsList');
        if (!list) return;
        const notifs = data.notifications || [];
        if (notifs.length === 0) {
            list.innerHTML = `<div class="text-center py-8 text-gray-400"><div class="text-3xl mb-2">🔔</div><p class="text-sm">No notifications</p></div>`;
            return;
        }
        list.innerHTML = notifs.map(n => {
            const isApproved = n.type === 'quiz_approved';
            const icon = isApproved ? '✅' : '❌';
            const color = isApproved ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100';
            const textColor = isApproved ? 'text-green-800' : 'text-red-700';
            const date = new Date(n.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
            return `<div class="p-3 rounded-xl border ${color} mb-2">
                <div class="flex items-start gap-2">
                    <span class="text-lg">${icon}</span>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-bold ${textColor}">${isApproved ? 'Quiz Approved!' : 'Quiz Rejected'}</p>
                        <p class="text-xs text-gray-600 mt-0.5 leading-relaxed">${escapeHtml(n.message)}</p>
                        <p class="text-[10px] text-gray-400 mt-1">${date}</p>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Update badge
        const badge = qs('notifBadge');
        if (badge && notifs.length > 0) {
            badge.textContent = Math.min(notifs.length, 9);
            badge.classList.remove('hidden');
        }
    } catch(e) {}
}

// ================= CREATOR STUDIO =================

async function loadCreatorView() {
    const lvl = getLevelInfo(state.userStats?.xp || 0).current.level;
    const locked = qs('creatorLocked');
    const unlocked = qs('creatorUnlocked');

    // Update nav lock icon
    const navLock = qs('creatorNavLock');
    if (navLock) navLock.style.display = lvl >= 3 ? 'none' : '';

    if (lvl < 3) {
        if (locked) locked.classList.remove('hidden');
        if (unlocked) unlocked.classList.add('hidden');
        // Update progress bar toward level 3
        const xp = state.userStats?.xp || 0;
        const l3xp = 250; // Level 3 minXp
        const pct = Math.min(Math.round((xp / l3xp) * 100), 100);
        const lockBar = qs('creatorLockBar');
        const lockText = qs('creatorLockLevelText');
        if (lockBar) lockBar.style.width = pct + '%';
        if (lockText) lockText.textContent = 'Level ' + lvl + ' of 3 needed · ' + xp + ' / 250 XP';
        return;
    }

    if (locked) locked.classList.add('hidden');
    if (unlocked) unlocked.classList.remove('hidden');

    // Check daily limit
    const today = new Date().toDateString();
    const lastCreate = localStorage.getItem('mb_last_create');
    const usedToday = lastCreate === today;
    const dailyText = qs('creatorDailyText');
    const dailyBadge = qs('creatorDailyBadge');
    const createBtn = qs('creatorCreateBtn');
    if (dailyText) dailyText.textContent = usedToday ? 'Already submitted today — come back tomorrow!' : 'You can submit 1 quiz today';
    if (dailyBadge) {
        dailyBadge.textContent = usedToday ? '1/1 ✓' : '0/1';
        dailyBadge.className = usedToday
            ? 'px-3 py-1 rounded-full text-xs font-bold bg-green-200 text-green-800'
            : 'px-3 py-1 rounded-full text-xs font-bold bg-amber-200 text-amber-800';
    }
    if (createBtn) {
        createBtn.disabled = usedToday;
        createBtn.style.opacity = usedToday ? '0.5' : '1';
        createBtn.title = usedToday ? 'Already submitted today' : 'Create a quiz';
    }

    // Load my quizzes from server
    try {
        const data = await api('get_my_quizzes');
        if (data.success) {
            renderCreatorQuizList(data.quizzes || []);
            updateCreatorStats(data);
        }
    } catch(e) {
        const list = qs('creatorQuizList');
        if (list) list.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Could not load your quizzes</p>';
    }
}

function updateCreatorStats(data) {
    const quizzes = data.quizzes || [];
    const analytics = data.analytics || {};

    const total = quizzes.length;
    const approved = quizzes.filter(q => q.status === 'approved').length;
    const pending = quizzes.filter(q => q.status === 'pending').length;

    const el = (id) => qs(id);
    if (el('cstTotalQuizzes')) el('cstTotalQuizzes').textContent = total;
    if (el('cstApproved')) el('cstApproved').textContent = approved;
    if (el('cstPending')) el('cstPending').textContent = pending;

    // Analytics section (only visible if there are approved quizzes)
    const analyticsSection = qs('creatorAnalyticsSection');
    if (analyticsSection) {
        if (approved > 0 && analytics && (analytics.total_views != null)) {
            analyticsSection.classList.remove('hidden');
            if (el('cstTotalViews'))   el('cstTotalViews').textContent   = (analytics.total_views   || 0).toLocaleString();
            if (el('cstTotalAnswers')) el('cstTotalAnswers').textContent = (analytics.total_answers || 0).toLocaleString();
            if (el('cstTotalCorrect')) el('cstTotalCorrect').textContent = (analytics.total_correct || 0).toLocaleString();
            if (el('cstTotalWrong'))   el('cstTotalWrong').textContent   = (analytics.total_wrong   || 0).toLocaleString();
            if (el('cstAvgTime'))      el('cstAvgTime').textContent      = analytics.avg_time_seconds != null ? analytics.avg_time_seconds + 's' : '--';
            if (el('cstAvgScore'))     el('cstAvgScore').textContent     = analytics.avg_score != null ? analytics.avg_score + '%' : '--%';
        } else {
            analyticsSection.classList.add('hidden');
        }
    }
}

function renderCreatorQuizList(quizzes) {
    const list = qs('creatorQuizList');
    if (!list) return;

    if (quizzes.length === 0) {
        list.innerHTML = `
            <div class="bg-white rounded-2xl p-6 card-shadow text-center">
                <div class="text-3xl mb-3">📝</div>
                <p class="font-bold text-gray-700 text-sm">No quizzes yet</p>
                <p class="text-xs text-gray-400 mt-1">Create your first quiz and contribute to the community!</p>
            </div>`;
        return;
    }

    list.innerHTML = quizzes.map(q => {
        const statusConfig = {
            approved: { label: 'Approved', bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500', text: 'text-green-700', icon: '✅' },
            pending:  { label: 'Pending',  bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-400', text: 'text-amber-700',  icon: '⏳' },
            rejected: { label: 'Rejected', bg: 'bg-red-50',   border: 'border-red-200',   dot: 'bg-red-500',   text: 'text-red-600',    icon: '❌' }
        };
        const s = statusConfig[q.status] || statusConfig.pending;
        const created = new Date(q.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
        const opts = Array.isArray(q.options) ? q.options : [];

        // Build per-quiz analytics row (only for approved)
        let analyticsHtml = '';
        if (q.status === 'approved' && q.analytics) {
            const a = q.analytics;
            analyticsHtml = `
                <div class="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
                    <div>
                        <p class="font-bold text-xs text-indigo-600">${(a.total_answers || 0).toLocaleString()}</p>
                        <p class="text-[10px] text-gray-400">Answers</p>
                    </div>
                    <div>
                        <p class="font-bold text-xs text-green-600">${a.avg_score != null ? a.avg_score + '%' : '--'}</p>
                        <p class="text-[10px] text-gray-400">Avg Score</p>
                    </div>
                    <div>
                        <p class="font-bold text-xs text-gray-700">${a.avg_time_seconds != null ? a.avg_time_seconds + 's' : '--'}</p>
                        <p class="text-[10px] text-gray-400">Avg Time</p>
                    </div>
                </div>`;
        } else if (q.status === 'pending') {
            analyticsHtml = `<div class="mt-2 text-[11px] text-amber-600 font-medium">⏳ Waiting for admin review...</div>`;
        } else if (q.status === 'rejected') {
            analyticsHtml = `<div class="mt-2 text-[11px] text-red-500 font-medium">❌ Not approved for community. Keep trying!</div>`;
        }

        return `
            <div class="bg-white rounded-2xl p-4 card-shadow border ${s.border}">
                <div class="flex items-start justify-between gap-2 mb-2">
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-bold text-gray-400 uppercase mb-1">${escapeHtml(q.topic)}</p>
                        <p class="text-sm font-semibold text-gray-800 leading-snug line-clamp-2">${escapeHtml(q.question.length > 100 ? q.question.slice(0,100)+'…' : q.question)}</p>
                    </div>
                    <span class="${s.bg} ${s.text} text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.border} flex-shrink-0 flex items-center gap-1">
                        ${s.icon} ${s.label}
                    </span>
                </div>
                <p class="text-[10px] text-gray-400 mb-0.5">Submitted ${created} · ${opts.length} options</p>
                ${analyticsHtml}
            </div>`;
    }).join('');
}

// ================= START =================
console.log('MathBot script loaded');
init();

// =====================================================================
// ================= CHAT STYLE CUSTOMIZATION SYSTEM ==================
// =====================================================================

// ---- Default & storage keys ----
const STYLE_KEY = 'mb_chat_style_v2';
const PUBLISH_KEY = 'mb_chat_style_published';

const DEFAULT_STYLE = {
    bubbleColor: '#0D7377',
    textColor: '#FFFFFF',
    sticker: null,       // null | emoji string | 'img:image/filename.png'
    published: false
};

// Current working style while modal is open (not yet saved)
let _draftStyle = { ...DEFAULT_STYLE };
let _draftPublished = false;

// Cache of published styles from other users: { telegram_id: {bubbleColor, textColor, sticker} }
let _publishedStylesCache = {};

function loadMyStyle() {
    try { return JSON.parse(localStorage.getItem(STYLE_KEY)) || { ...DEFAULT_STYLE }; }
    catch { return { ...DEFAULT_STYLE }; }
}
function saveMyStyle(s) {
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(s)); } catch {}
}
function isPublished() {
    try { return JSON.parse(localStorage.getItem(PUBLISH_KEY)) === true; }
    catch { return false; }
}
function setPublished(val) {
    try { localStorage.setItem(PUBLISH_KEY, JSON.stringify(val)); } catch {}
}

// ---- Server sync for published styles ----
// Piggybacks on the existing api() helper.
// Action: save_chat_style  → saves style JSON to the user's server record
// Action: get_chat_styles  → returns array of {telegram_id, style_json} for published users

async function pushStyleToServer(style, published) {
    try {
        await api('save_chat_style', {
            telegram_id: state.telegramId,
            style_json: JSON.stringify({ ...style, published })
        });
    } catch (e) { console.warn('pushStyleToServer failed', e); }
}

async function fetchPublishedStyles() {
    try {
        const data = await api('get_chat_styles', {});
        if (data.success && Array.isArray(data.styles)) {
            data.styles.forEach(row => {
                try {
                    const s = typeof row.style_json === 'string' ? JSON.parse(row.style_json) : row.style_json;
                    if (s && s.published) {
                        _publishedStylesCache[String(row.telegram_id)] = s;
                    } else {
                        delete _publishedStylesCache[String(row.telegram_id)];
                    }
                } catch {}
            });
        }
    } catch (e) { /* server may not support this action yet — silently fail */ }
}

// Poll published styles every 10 s when chat is open
let _stylesPollInterval = null;
function startStylesPolling() {
    if (_stylesPollInterval) return;
    fetchPublishedStyles();
    _stylesPollInterval = setInterval(() => {
        const chatView = qs('chatView');
        if (chatView && !chatView.classList.contains('hidden')) {
            fetchPublishedStyles().then(() => renderChatMessages());
        }
    }, 10000);
}

// ---- Preset palettes ----
const BUBBLE_PRESETS = [
    '#0D7377','#14A085','#6366F1','#8B5CF6','#EC4899',
    '#EF4444','#F97316','#F59E0B','#10B981','#3B82F6',
    '#1E293B','#374151','#64748B','#D97706','#BE185D',
    '#7C3AED','#0891B2','#059669','#DC2626','#1D4ED8'
];

const TEXT_PRESETS = [
    '#FFFFFF','#F9FAFB','#FEF08A','#BBF7D0',
    '#BFDBFE','#FECACA','#111827','#374151'
];

const EMOJI_STICKERS = ['✨','🔥','💫','⚡','💎','👑','🚀','🌟','❤️','💜','🎯','🏆','🤩','😎','🦋','🌈'];

// ---- Images in the image/ folder ----
const IMAGE_STICKERS = [
    // 'image/star.png',
];
(function autoDetectImages() {
    for (let i = 1; i <= 30; i++) {
        IMAGE_STICKERS.push(`image/${i}.png`);
        IMAGE_STICKERS.push(`image/${i}.jpg`);
        IMAGE_STICKERS.push(`image/${i}.gif`);
        IMAGE_STICKERS.push(`image/${i}.webp`);
    }
})();

// ---- Render helpers ----
function renderBubbleColorPicker() {
    const el = qs('bubbleColorPicker');
    if (!el) return;
    el.innerHTML = BUBBLE_PRESETS.map(c => `
        <button type="button" onclick="selectBubbleColor('${c}')"
            class="bubble-color-swatch btn-press ${_draftStyle.bubbleColor === c ? 'active' : ''}"
            style="background:${c};" title="${c}"></button>
    `).join('');
}

function renderTextColorPicker() {
    const el = qs('textColorPicker');
    if (!el) return;
    el.innerHTML = TEXT_PRESETS.map(c => {
        const border = c === '#FFFFFF' || c === '#F9FAFB' ? 'border border-gray-200' : '';
        return `<button type="button" onclick="selectTextColor('${c}')"
            class="text-color-dot btn-press ${border} ${_draftStyle.textColor === c ? 'active' : ''}"
            style="background:${c};" title="${c}"></button>`;
    }).join('');
}

function renderStickerPicker() {
    const row = qs('stickerPicker');
    if (!row) return;

    const noneActive = !_draftStyle.sticker;
    row.innerHTML = `<button onclick="selectSticker(null)" id="sticker-none"
        class="sticker-btn w-12 h-12 rounded-xl border-2 ${noneActive ? 'border-teal-600 bg-teal-50' : 'border-gray-200 bg-gray-50'} flex items-center justify-center text-gray-400 text-xs font-bold transition-all btn-press"
        title="No icon">✕</button>`;

    EMOJI_STICKERS.forEach(em => {
        const active = _draftStyle.sticker === em;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `sticker-btn w-12 h-12 rounded-xl border-2 ${active ? 'border-teal-600 bg-teal-50' : 'border-gray-200 bg-gray-50'} flex items-center justify-center text-2xl transition-all btn-press`;
        btn.textContent = em;
        btn.onclick = () => selectSticker(em);
        row.appendChild(btn);
    });
}

function renderImageStickerPicker() {
    const row = qs('imageStickerPicker');
    const section = qs('imageStickerRow');
    if (!row || !section) return;

    row.innerHTML = '';
    IMAGE_STICKERS.forEach(path => {
        const img = document.createElement('img');
        img.src = path;
        img.alt = path;
        img.title = path;
        const key = 'img:' + path;
        img.className = `image-sticker-btn btn-press ${_draftStyle.sticker === key ? 'active' : ''}`;
        img.onclick = () => selectSticker(key);
        img.onload = () => { row.appendChild(img); section.classList.remove('hidden'); };
    });
}

function updatePreview() {
    const bubble = qs('stylePreviewBubble');
    const text = qs('stylePreviewText');
    const iconEl = qs('stylePreviewIcon');
    if (!bubble || !text) return;

    bubble.style.background = _draftStyle.bubbleColor;
    text.style.color = _draftStyle.textColor;

    if (_draftStyle.sticker) {
        iconEl.classList.remove('hidden');
        if (_draftStyle.sticker.startsWith('img:')) {
            const path = _draftStyle.sticker.slice(4);
            iconEl.innerHTML = `<img src="${path}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;display:inline-block;">`;
        } else {
            iconEl.textContent = _draftStyle.sticker;
        }
    } else {
        iconEl.classList.add('hidden');
        iconEl.textContent = '';
    }
}

function updatePublishToggleUI(on) {
    const toggle = qs('publishToggle');
    const thumb = qs('publishToggleThumb');
    const badge = qs('publishedBadge');
    if (!toggle || !thumb) return;
    if (on) {
        toggle.style.background = '#0D7377';
        thumb.style.transform = 'translateX(24px)';
        if (badge) badge.classList.remove('hidden');
    } else {
        toggle.style.background = '#E5E7EB';
        thumb.style.transform = 'translateX(0)';
        if (badge) badge.classList.add('hidden');
    }
}

function togglePublish() {
    _draftPublished = !_draftPublished;
    updatePublishToggleUI(_draftPublished);
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

// ---- Selection handlers ----
function selectBubbleColor(c) {
    _draftStyle.bubbleColor = c;
    const customInput = qs('bubbleCustomColor');
    const hexLabel = qs('bubbleHexLabel');
    if (customInput) customInput.value = c;
    if (hexLabel) hexLabel.textContent = c;
    renderBubbleColorPicker();
    updatePreview();
}

function onCustomBubbleColor(c) {
    _draftStyle.bubbleColor = c;
    const hexLabel = qs('bubbleHexLabel');
    if (hexLabel) hexLabel.textContent = c;
    document.querySelectorAll('.bubble-color-swatch').forEach(el => el.classList.remove('active'));
    updatePreview();
}

function selectTextColor(c) {
    _draftStyle.textColor = c;
    const customInput = qs('textCustomColor');
    const hexLabel = qs('textHexLabel');
    if (customInput) customInput.value = c;
    if (hexLabel) hexLabel.textContent = c;
    renderTextColorPicker();
    updatePreview();
}

function onCustomTextColor(c) {
    _draftStyle.textColor = c;
    const hexLabel = qs('textHexLabel');
    if (hexLabel) hexLabel.textContent = c;
    document.querySelectorAll('.text-color-dot').forEach(el => el.classList.remove('active'));
    updatePreview();
}

function selectSticker(val) {
    _draftStyle.sticker = val;
    renderStickerPicker();
    document.querySelectorAll('.image-sticker-btn').forEach(img => {
        const src = img.getAttribute('src') || '';
        const key = 'img:' + src.replace(location.origin + '/', '').replace(location.origin, '');
        img.classList.toggle('active', key === val);
    });
    updatePreview();
    const btnIcon = qs('chatStyleBtnIcon');
    if (btnIcon) {
        if (val && !val.startsWith('img:')) btnIcon.textContent = val;
        else if (val && val.startsWith('img:')) btnIcon.innerHTML = `<img src="${val.slice(4)}" style="width:20px;height:20px;border-radius:5px;object-fit:cover;">`;
        else btnIcon.textContent = '🎨';
    }
}

// ---- Open / close ----
function openChatStyleModal() {
    _draftStyle = { ...loadMyStyle() };
    _draftPublished = isPublished();

    const modal = qs('chatStyleModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const customBubble = qs('bubbleCustomColor');
    const customText = qs('textCustomColor');
    if (customBubble) customBubble.value = _draftStyle.bubbleColor;
    if (customText) customText.value = _draftStyle.textColor;
    qs('bubbleHexLabel').textContent = _draftStyle.bubbleColor;
    qs('textHexLabel').textContent = _draftStyle.textColor;

    updatePublishToggleUI(_draftPublished);
    renderBubbleColorPicker();
    renderTextColorPicker();
    renderStickerPicker();
    renderImageStickerPicker();
    updatePreview();

    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function closeChatStyleModal() {
    const modal = qs('chatStyleModal');
    if (modal) modal.classList.add('hidden');
}

async function saveChatStyle() {
    saveMyStyle(_draftStyle);
    setPublished(_draftPublished);
    closeChatStyleModal();
    renderChatMessages();

    // Push to server so others can see it (if published)
    pushStyleToServer(_draftStyle, _draftPublished);

    // Also refresh cached published styles immediately
    await fetchPublishedStyles();
    renderChatMessages();

    const btnIcon = qs('chatStyleBtnIcon');
    if (btnIcon) {
        if (_draftStyle.sticker && !_draftStyle.sticker.startsWith('img:')) btnIcon.textContent = _draftStyle.sticker;
        else if (_draftStyle.sticker && _draftStyle.sticker.startsWith('img:')) btnIcon.innerHTML = `<img src="${_draftStyle.sticker.slice(4)}" style="width:20px;height:20px;border-radius:5px;object-fit:cover;">`;
        else btnIcon.textContent = '🎨';
    }

    const msg = _draftPublished ? '🌐 Style published! Everyone can see it' : '✨ Style saved!';
    const bg  = _draftPublished ? '#6366F1' : '#0D7377';
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:${bg};color:white;padding:10px 22px;border-radius:999px;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 16px ${bg}55;animation:fadeIn 0.25s ease both;white-space:nowrap;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
}

function resetChatStyle() {
    _draftStyle = { ...DEFAULT_STYLE };
    _draftPublished = false;
    const customBubble = qs('bubbleCustomColor');
    const customText = qs('textCustomColor');
    if (customBubble) customBubble.value = DEFAULT_STYLE.bubbleColor;
    if (customText) customText.value = DEFAULT_STYLE.textColor;
    qs('bubbleHexLabel').textContent = DEFAULT_STYLE.bubbleColor;
    qs('textHexLabel').textContent = DEFAULT_STYLE.textColor;
    updatePublishToggleUI(false);
    renderBubbleColorPicker();
    renderTextColorPicker();
    renderStickerPicker();
    updatePreview();
}

// ---- Helper: get style for any user (published cache or my own) ----
function getStyleForUser(telegramId) {
    const tid = String(telegramId);
    const myTid = String(state.telegramId);
    if (tid === myTid) {
        // Always apply own local style regardless of publish
        return loadMyStyle();
    }
    // Return published style if available
    return _publishedStylesCache[tid] || null;
}

// ---- Apply style to a single message bubble DOM node ----
function applyStyleToBubble(bubbleEl, wrapperEl, style, isMe) {
    if (!style) return;

    bubbleEl.style.background = style.bubbleColor;
    bubbleEl.style.boxShadow = `0 2px 8px ${style.bubbleColor}55`;

    const p = bubbleEl.querySelector('p');
    if (p) {
        p.style.color = style.textColor;
        p.querySelectorAll('.katex').forEach(k => k.style.color = style.textColor);
    }

    // Check only DIRECT children of this wrapper — not subtree — so consecutive
    // messages from the same user each get their own sticker correctly.
    const alreadyHasSticker = Array.from(wrapperEl.children)
        .some(child => child.classList.contains('my-style-sticker'));

    if (style.sticker && !alreadyHasSticker) {
        const stickerEl = document.createElement('div');
        stickerEl.className = 'my-style-sticker';
        stickerEl.style.cssText = isMe
            ? 'text-align:right;margin-bottom:2px;'
            : 'text-align:left;margin-bottom:2px;';

        if (style.sticker.startsWith('img:')) {
            const path = style.sticker.slice(4);
            stickerEl.innerHTML = `<img src="${path}" class="msg-custom-sticker-img" style="${isMe ? 'margin-left:auto;' : ''}">`;
        } else {
            stickerEl.innerHTML = `<span class="msg-custom-sticker">${style.sticker}</span>`;
        }
        wrapperEl.insertBefore(stickerEl, bubbleEl);
    }
}

// ---- Patch renderChatMessages ----
const _origRenderChatMessages = renderChatMessages;
renderChatMessages = function(forceScroll = true) {
    _origRenderChatMessages(forceScroll);

    const container = qs('chatMessages');
    if (!container) return;

    startStylesPolling();

    // Style MY outgoing bubbles — every row with justify-end
    container.querySelectorAll('.flex.justify-end').forEach(row => {
        const bubble = row.querySelector('[class*="from-teal"]') || row.querySelector('[class*="bg-gradient"]');
        if (!bubble) return;
        const wrapper = bubble.parentElement;
        const style = getStyleForUser(state.telegramId);
        if (style) applyStyleToBubble(bubble, wrapper, style, true);
    });

    // Style OTHER users' incoming bubbles using data-tid (works for ALL messages,
    // including consecutive ones where the username header is hidden)
    container.querySelectorAll('.flex.justify-start[data-tid]').forEach(row => {
        const tid = row.getAttribute('data-tid');
        const publishedStyle = _publishedStylesCache[tid];
        if (!publishedStyle) return;

        const bubble = row.querySelector('.bg-white.rounded-2xl');
        if (!bubble) return;
        const wrapper = bubble.parentElement;
        applyStyleToBubble(bubble, wrapper, publishedStyle, false);
    });
};