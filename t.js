const API_URL = 'https://khmerservice.online/math/api.php';

// ================= TELEGRAM =================
const tg = window.Telegram.WebApp;
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
    userStats: null
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
let replyingTo = null;
const MAX_CHAT_MESSAGES = 50;

// ================= HELPERS =================
function qs(id) {
    return document.getElementById(id);
}

function toggleMathHelper() {
    const el = qs('mathHelper');
    if (el) {
        el.classList.toggle('hidden');
        if (!el.classList.contains('hidden') && tg.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }
}

function fakeChatLoading() {
    const overlay = qs('chatLoading');
    const bar = qs('chatLoadingBar');
    
    if (!overlay) return;
    
    overlay.style.display = 'flex';
    overlay.classList.remove('hidden');
    setChatLocked(true);
    
    let progress = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 15 + 5;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            setTimeout(() => {
                overlay.style.display = 'none';
                setChatLocked(false);
                hasChatLoadedOnce = true;
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            }, 300);
        }
        if (bar) bar.style.width = progress + '%';
    }, 100);
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
    
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function updateLoadingProgress(percent) {
    const circle = qs('loadingCircle');
    const text = qs('loadingPercent');
    
    if (circle) {
        const circumference = 2 * Math.PI * 45;
        const offset = circumference - (percent / 100) * circumference;
        circle.style.strokeDashoffset = offset;
    }
    if (text) text.textContent = Math.round(percent) + '%';
}

function showError(msg) {
    console.error('Error:', msg);
    if (tg && tg.showAlert) {
        tg.showAlert(msg || 'Something went wrong');
    } else {
        alert(msg || 'Something went wrong');
    }
}

function setLoading(val) {
    state.loading = val;
    const el = qs('loadingView');
    if (el) el.classList.toggle('hidden', !val);
}

function forceShowApp() {
    console.log('Force showing app...');
    setLoading(false);
    const mc = qs('mainContent');
    if (mc) {
        mc.classList.remove('hidden');
        mc.classList.add('fade-in');
    }
    switchView('home');
}

// ================= API =================
async function api(action, data) {
    try {
        const payload = {
            action: action,
            telegram_id: state.telegramId,
            ...data
        };

        console.log('API Request:', action, payload);

        const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            throw new Error('HTTP ' + res.status);
        }

        const json = await res.json();
        console.log('API Response:', action, json);
        return json;

    } catch (e) {
        console.error('API Error:', action, e);
        return {
            success: false,
            error: 'Network error'
        };
    }
}

// ================= CHAT FUNCTIONS =================
function getUserColor(id) {
    const colors = [
        'from-blue-500 to-blue-600',
        'from-purple-500 to-purple-600',
        'from-orange-500 to-orange-600',
        'from-pink-500 to-pink-600',
        'from-indigo-500 to-indigo-600',
        'from-teal-500 to-teal-600',
        'from-red-500 to-red-600',
        'from-green-500 to-green-600'
    ];
    const num = parseInt(id) || 0;
    return 'bg-gradient-to-br ' + colors[Math.abs(num) % colors.length];
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
    
    selectedUser = { id: userId, name: name };
    openUserProfile(selectedUser);
    
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
}

function openUserProfile(user) {
    const modal = qs('userProfileModal');
    modal.classList.remove('hidden');
    
    const avatar = qs('profileAvatar');
    avatar.className = 'w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-lg ' + getUserColor(user.id);
    avatar.textContent = user.name.charAt(0).toUpperCase();
    
    qs('profileUsername').textContent = user.name;
    qs('profilePointsMini').textContent = Math.floor(Math.random() * 500) + 100;
    qs('profileMessages').textContent = Math.floor(Math.random() * 50) + 5;
    qs('profileRankMini').textContent = '#' + Math.floor(Math.random() * 100);
}

function closeProfile() {
    qs('userProfileModal').classList.add('hidden');
    document.querySelectorAll('.username-tapped').forEach(e => e.classList.remove('username-tapped'));
}

function mentionUser() {
    if (!selectedUser) return;
    const input = qs('chatInput');
    const mention = '@' + selectedUser.name.replace(/\s+/g, '_') + ' ';
    input.value += mention;
    input.focus();
    closeProfile();
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function openFullProfile() {
    switchView('profile');
    closeProfile();
}

function renderMathText(text) {
    if (!text || typeof window.katex === 'undefined') {
        return escapeHtml(text).replace(/\n/g, '<br>');
    }

    const segments = [];
    let remaining = text;

    const displayRegex = /\$\$([\s\S]+?)\$\$/g;
    let lastIndex = 0;
    let match;

    while ((match = displayRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({
                type: 'text',
                content: text.slice(lastIndex, match.index)
            });
        }
        segments.push({
            type: 'display',
            content: match[1].trim()
        });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        segments.push({
            type: 'text',
            content: text.slice(lastIndex)
        });
    }

    const finalSegments = [];
    segments.forEach(seg => {
        if (seg.type !== 'text') {
            finalSegments.push(seg);
            return;
        }

        const inlineRegex = /\$((?:\\\$|[^\$])+?)\$/g;
        let txt = seg.content;
        let idx = 0;
        let m;

        while ((m = inlineRegex.exec(txt)) !== null) {
            if (m.index > idx) {
                finalSegments.push({
                    type: 'text',
                    content: txt.slice(idx, m.index)
                });
            }
            finalSegments.push({
                type: 'inline',
                content: m[1].trim()
            });
            idx = m.index + m[0].length;
        }
        if (idx < txt.length) {
            finalSegments.push({
                type: 'text',
                content: txt.slice(idx)
            });
        }
    });

    return finalSegments.map(seg => {
        if (seg.type === 'text') {
            return escapeHtml(seg.content).replace(/\n/g, '<br>');
        }
        try {
            return window.katex.renderToString(seg.content, {
                throwOnError: false,
                displayMode: seg.type === 'display',
                strict: false
            });
        } catch (e) {
            return escapeHtml(seg.type === 'display' ? '$$' + seg.content + '$$' : '$' + seg.content + '$');
        }
    }).join('');
}

function formatChatTime(dateString) {
    const d = new Date(dateString);
    return d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatChatDate(dateString) {
    const d = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], {
        month: 'short',
        day: 'numeric'
    });
}

function startReply(msgId, userName, messageText) {
    replyingTo = msgId;
    qs('replyToName').textContent = userName;
    qs('replyToMessage').textContent = messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '');
    qs('replyPreview').classList.remove('hidden');
    qs('chatInput').focus();
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function cancelReply() {
    replyingTo = null;
    qs('replyPreview').classList.add('hidden');
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
        if (chatView && !chatView.classList.contains('hidden')) {
            pollChatMessages();
        }
    }, 3000);
}

async function loadChatMessages() {
    try {
        const data = await api('get_chat_messages', { limit: 50 });
        if (data.success && Array.isArray(data.messages)) {
            chatMessagesCache = data.messages.slice(-MAX_CHAT_MESSAGES);
            renderChatMessages();
        }
    } catch (e) {
        console.error('loadChatMessages error:', e);
    }
}

async function pollChatMessages() {
    try {
        const data = await api('get_chat_messages', {
            limit: 50,
            after_id: chatLastId
        });
        if (!data.success || !Array.isArray(data.messages)) return;

        const existingIds = new Set(chatMessagesCache.map(m => parseInt(m.id)));
        const newMsgs = data.messages.filter(m => !existingIds.has(parseInt(m.id)));

        if (newMsgs.length > 0) {
            chatMessagesCache.push(...newMsgs);
            if (chatMessagesCache.length > MAX_CHAT_MESSAGES) {
                chatMessagesCache = chatMessagesCache.slice(-MAX_CHAT_MESSAGES);
            }
            renderChatMessages();

            const hasOthers = newMsgs.some(m => m.telegram_id != state.telegramId);
            if (hasOthers && tg.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }

                        const chatView = qs('chatView');
            if (chatView && !chatView.classList.contains('hidden')) {
                pollChatMessages();
            }
        } 3000;
    } catch (e) {
        console.error('pollChatMessages error:', e);
    }
}

function setChatLocked(locked) {
    isChatLocked = locked;
    const input = qs('chatInput');
    const sendBtn = qs('sendBtn');
    if (input) input.disabled = locked;
    if (sendBtn) sendBtn.disabled = locked;
}

function renderChatMessages() {
    const container = qs('chatMessages');
    if (!container) return;

    // Group messages by date
    let lastDate = null;
    let html = '';

    if (chatMessagesCache.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-400" id="chatEmptyState">
                <div class="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner">
                    <svg class="w-10 h-10 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                </div>
                <p class="text-base font-semibold text-gray-600">No messages yet</p>
                <p class="text-sm mt-1 text-gray-400">Start the conversation!</p>
            </div>
        `;
        return;
    }

    chatMessagesCache.forEach((msg, index) => {
        const msgDate = formatChatDate(msg.created_at);
        if (msgDate !== lastDate) {
            html += `
                <div class="flex justify-center my-4">
                    <span class="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full font-medium">${msgDate}</span>
                </div>
            `;
            lastDate = msgDate;
        }

        const isMe = msg.telegram_id == state.telegramId;
        const userColor = getUserColor(msg.telegram_id);
        const replyHtml = msg.reply_to ? `
            <div class="reply-indicator mb-2">
                <p class="font-semibold text-teal-700 text-xs">${escapeHtml(msg.reply_to_username || 'Unknown')}</p>
                <p class="text-gray-500 text-xs truncate">${escapeHtml(msg.reply_to_message || '')}</p>
            </div>
        ` : '';

        const messageContent = renderMathText(msg.message);
        
        html += `
            <div class="flex ${isMe ? 'justify-end' : 'justify-start'} mb-3 group" data-msg-id="${msg.id}">
                <div class="flex ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-2 max-w-[85%]">
                    ${!isMe ? `
                        <div class="w-8 h-8 rounded-full ${userColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 cursor-pointer hover:scale-110 transition-transform" 
                             onclick="tapUsername(this, '${escapeHtml(msg.username || 'Unknown')}', '${msg.telegram_id}')">
                            ${(msg.username || 'U').charAt(0).toUpperCase()}
                        </div>
                    ` : ''}
                    <div class="message-bubble ${isMe ? 'sent text-white' : 'received text-gray-800'} px-4 py-3 rounded-2xl ${isMe ? 'rounded-br-md' : 'rounded-bl-md'} cursor-pointer"
                         onclick="startReply('${msg.id}', '${escapeHtml(msg.username || 'Unknown')}', '${escapeHtml(msg.message).replace(/'/g, "\\'")}')">
                        ${!isMe ? `<p class="text-xs font-semibold mb-1 ${isMe ? 'text-teal-100' : 'text-teal-600'}">${escapeHtml(msg.username || 'Unknown')}</p>` : ''}
                        ${replyHtml}
                        <div class="text-sm leading-relaxed break-words">${messageContent}</div>
                        <p class="text-xs ${isMe ? 'text-teal-100' : 'text-gray-400'} mt-1 text-right">${formatChatTime(msg.created_at)}</p>
                        
                        <div class="reaction-bar">
                            <button onclick="event.stopPropagation(); addReaction('${msg.id}', '👍')" class="hover:scale-125 transition-transform">👍</button>
                            <button onclick="event.stopPropagation(); addReaction('${msg.id}', '❤️')" class="hover:scale-125 transition-transform">❤️</button>
                            <button onclick="event.stopPropagation(); addReaction('${msg.id}', '😮')" class="hover:scale-125 transition-transform">😮</button>
                            <button onclick="event.stopPropagation(); addReaction('${msg.id}', '🎉')" class="hover:scale-125 transition-transform">🎉</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (index === chatMessagesCache.length - 1) {
            chatLastId = parseInt(msg.id);
        }
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
    const input = qs('chatInput');
    const message = input.value.trim();
    
    if (!message || isChatLocked) return;
    
    input.value = '';
    qs('charCount').classList.add('hidden');
    
    // Optimistic add
    const tempMsg = {
        id: 'temp-' + Date.now(),
        telegram_id: state.telegramId,
        username: state.user?.username || 'You',
        message: message,
        created_at: new Date().toISOString(),
        reply_to: replyingTo,
        reply_to_username: replyingTo ? qs('replyToName').textContent : null,
        reply_to_message: replyingTo ? qs('replyToMessage').textContent : null
    };
    
    chatMessagesCache.push(tempMsg);
    renderChatMessages();
    
    if (replyingTo) {
        cancelReply();
    }
    
    try {
        const data = await api('send_chat_message', {
            message: message,
            reply_to: replyingTo
        });
        
        if (!data.success) {
            showError('Failed to send message');
        } else {
            await loadChatMessages();
        }
    } catch (e) {
        console.error('Send message error:', e);
    }
    
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

async function addReaction(msgId, emoji) {
    try {
        await api('add_reaction', { message_id: msgId, emoji: emoji });
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    } catch (e) {
        console.error('Reaction error:', e);
    }
}

async function loadChatStats() {
    try {
        const data = await api('get_chat_stats');
        if (data.success) {
            qs('chatUserCount').textContent = data.active_users || 0;
        }
    } catch (e) {
        console.error('Chat stats error:', e);
    }
}

function toggleChatInfo() {
    if (tg.showPopup) {
        tg.showPopup({
            title: 'Math Community Chat',
            message: 'Welcome to the Math Community!\n\n• Be respectful to all members\n• Use $...$ for math equations\n• Ask questions, share solutions\n• Build your streak by participating',
            buttons: [{ id: 'ok', type: 'ok', text: 'Got it!' }]
        });
    }
}

// ================= VIEW MANAGEMENT =================
function switchView(viewName) {
    // Hide all views
    ['homeView', 'quizView', 'explanationView', 'resultsView', 'profileView', 'leaderboardView', 'chatView'].forEach(id => {
        const el = qs(id);
        if (el) {
            el.classList.add('hidden');
            el.classList.remove('flex');
        }
    });
    
    // Show selected view
    const targetView = qs(viewName + 'View');
    if (targetView) {
        targetView.classList.remove('hidden');
        if (viewName !== 'home') {
            targetView.classList.add('flex');
        }
    }
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(btn => {
        const isActive = btn.dataset.view === viewName;
        btn.classList.toggle('text-teal-600', isActive);
        btn.classList.toggle('text-gray-400', !isActive);
        btn.classList.toggle('active', isActive);
    });
    
    // Initialize chat if needed
    if (viewName === 'chat') {
        initChat();
    } else {
        if (chatInterval) {
            clearInterval(chatInterval);
            chatInterval = null;
        }
    }
    
    // Scroll to top
    const mainContent = qs('mainContent');
    if (mainContent) mainContent.scrollTop = 0;
    
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

// ================= QUIZ FUNCTIONS =================
async function loadTopics() {
    try {
        const data = await api('get_topics');
        if (data.success && data.topics) {
            renderTopics(data.topics);
            qs('questionCount').textContent = data.total_questions + ' questions';
        }
    } catch (e) {
        console.error('Load topics error:', e);
    }
}

function renderTopics(topics) {
    const grid = qs('topicsGrid');
    const icons = {
        'algebra': '📐',
        'calculus': '📈',
        'geometry': '📏',
        'trigonometry': '📐',
        'statistics': '📊',
        'arithmetic': '🔢',
        'default': '🧮'
    };
    
    const gradients = {
        'algebra': 'from-blue-500 to-indigo-600',
        'calculus': 'from-purple-500 to-pink-600',
        'geometry': 'from-green-500 to-teal-600',
        'trigonometry': 'from-orange-500 to-red-600',
        'statistics': 'from-cyan-500 to-blue-600',
        'arithmetic': 'from-yellow-500 to-orange-600',
        'default': 'from-teal-500 to-emerald-600'
    };
    
    grid.innerHTML = topics.map(topic => {
        const icon = icons[topic.id] || icons[topic.name?.toLowerCase()] || icons.default;
        const gradient = gradients[topic.id] || gradients[topic.name?.toLowerCase()] || gradients.default;
        
        return `
            <button onclick="startTopic('${topic.id}')" class="topic-card rounded-2xl p-5 h-36 text-left relative overflow-hidden group">
                <div class="absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-10 transition-opacity"></div>
                <div class="relative z-10">
                    <div class="text-3xl mb-3">${icon}</div>
                    <h3 class="font-bold text-gray-900 text-lg">${topic.name}</h3>
                    <p class="text-xs text-gray-500 mt-1">${topic.question_count || 0} problems</p>
                </div>
                <div class="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-teal-500 group-hover:text-white transition-all">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                </div>
            </button>
        `;
    }).join('');
}

async function startTopic(topicId) {
    state.currentTopic = topicId;
    state.currentQuestionIndex = 0;
    state.correctAnswers = 0;
    state.wrongAnswers = 0;
    state.hasAnswered = false;
    state.selectedOption = null;
    
    setLoading(true);
    
    try {
        const data = await api('get_questions', { topic: topicId, limit: 5 });
        if (data.success && data.questions) {
            state.questions = data.questions;
            switchView('quiz');
            showQuestion();
        } else {
            showError('No questions available for this topic');
        }
    } catch (e) {
        showError('Failed to load questions');
    } finally {
        setLoading(false);
    }
}

async function startDailyChallenge() {
    state.currentTopic = 'daily';
    state.currentQuestionIndex = 0;
    state.correctAnswers = 0;
    state.wrongAnswers = 0;
    state.hasAnswered = false;
    state.selectedOption = null;
    
    setLoading(true);
    
    try {
        const data = await api('get_daily_challenge');
        if (data.success && data.questions) {
            state.questions = data.questions;
            switchView('quiz');
            showQuestion();
        } else {
            showError('Daily challenge not available');
        }
    } catch (e) {
        showError('Failed to load daily challenge');
    } finally {
        setLoading(false);
    }
}

function showQuestion() {
    const q = state.questions[state.currentQuestionIndex];
    if (!q) return;
    
    state.hasAnswered = false;
    state.selectedOption = null;
    
    // Update progress
    const progress = ((state.currentQuestionIndex + 1) / state.questions.length) * 100;
    qs('progressBar').style.width = progress + '%';
    qs('currentQ').textContent = state.currentQuestionIndex + 1;
    qs('totalQ').textContent = state.questions.length;
    
    // Update question
    qs('topicBadge').textContent = q.topic || state.currentTopic;
    qs('difficultyBadge').textContent = q.difficulty || 'Medium';
    qs('questionText').innerHTML = renderMathText(q.question);
    
    // Render options
    const optionsHtml = q.options.map((opt, idx) => `
        <button onclick="selectOption(${idx})" 
                id="option-${idx}"
                class="w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-teal-500 hover:bg-teal-50 transition-all active:scale-[0.98] group">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-teal-500 group-hover:text-white flex items-center justify-center font-bold text-sm transition-all">
                    ${String.fromCharCode(65 + idx)}
                </div>
                <div class="flex-1 text-sm font-medium">${renderMathText(opt)}</div>
            </div>
        </button>
    `).join('');
    
    qs('optionsContainer').innerHTML = optionsHtml;
    
    // Reset buttons
    qs('checkBtn').disabled = true;
    qs('explainBtn').disabled = false;
    qs('checkBtn').innerHTML = `
        Check Answer
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
    `;
}

function selectOption(index) {
    if (state.hasAnswered) return;
    
    state.selectedOption = index;
    
    // Update UI
    document.querySelectorAll('[id^="option-"]').forEach((btn, idx) => {
        const isSelected = idx === index;
        btn.classList.toggle('border-teal-500', isSelected);
        btn.classList.toggle('bg-teal-50', isSelected);
        btn.classList.toggle('border-gray-200', !isSelected);
        btn.classList.toggle('bg-white', !isSelected);
        
        const letterDiv = btn.querySelector('div:first-child');
        letterDiv.classList.toggle('bg-teal-500', isSelected);
        letterDiv.classList.toggle('text-white', isSelected);
        letterDiv.classList.toggle('bg-gray-100', !isSelected);
    });
    
    qs('checkBtn').disabled = false;
    
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

async function checkAnswer() {
    if (state.hasAnswered || state.selectedOption === null) return;
    
    state.hasAnswered = true;
    const q = state.questions[state.currentQuestionIndex];
    const isCorrect = state.selectedOption === q.correct_answer;
    
    // Update UI
    const selectedBtn = qs('option-' + state.selectedOption);
    const correctBtn = qs('option-' + q.correct_answer);
    
    if (isCorrect) {
        state.correctAnswers++;
        selectedBtn.classList.remove('bg-teal-50', 'border-teal-500');
        selectedBtn.classList.add('bg-green-500', 'border-green-500', 'text-white');
        selectedBtn.querySelector('div:first-child').classList.add('bg-white', 'text-green-500');
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    } else {
        state.wrongAnswers++;
        selectedBtn.classList.remove('bg-teal-50', 'border-teal-500');
        selectedBtn.classList.add('bg-red-500', 'border-red-500', 'text-white');
        selectedBtn.querySelector('div:first-child').classList.add('bg-white', 'text-red-500');
        
        correctBtn.classList.add('bg-green-500', 'border-green-500', 'text-white');
        correctBtn.querySelector('div:first-child').classList.add('bg-white', 'text-green-500');
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
    }
    
    // Disable all options
    document.querySelectorAll('[id^="option-"]').forEach(btn => {
        btn.disabled = true;
        btn.classList.add('cursor-not-allowed');
    });
    
    // Update button
    qs('checkBtn').innerHTML = isCorrect ? 'Correct! ✓' : 'Wrong ✗';
    qs('checkBtn').classList.toggle('from-green-600', isCorrect);
    qs('checkBtn').classList.toggle('to-green-700', isCorrect);
    qs('checkBtn').classList.toggle('from-red-600', !isCorrect);
    qs('checkBtn').classList.toggle('to-red-700', !isCorrect);
    
    // Record answer
    await api('record_answer', {
        question_id: q.id,
        correct: isCorrect,
        topic: state.currentTopic
    });
    
    // Show explanation button
    qs('explainBtn').disabled = false;
    
    // Auto advance after delay or wait for user
    setTimeout(() => {
        if (state.currentQuestionIndex < state.questions.length - 1) {
            qs('checkBtn').innerHTML = `
                Next Question
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
            `;
            qs('checkBtn').onclick = nextQuestion;
        } else {
            qs('checkBtn').innerHTML = 'See Results →';
            qs('checkBtn').onclick = showResults;
        }
    }, 1500);
}

function showExplanation() {
    const q = state.questions[state.currentQuestionIndex];
    if (!q || !q.explanation) {
        showError('No explanation available');
        return;
    }
    
    qs('explanationContent').innerHTML = renderMathText(q.explanation);
    switchView('explanation');
}

function backToQuiz() {
    switchView('quiz');
}

function nextQuestion() {
    state.currentQuestionIndex++;
    if (state.currentQuestionIndex < state.questions.length) {
        // Reset button onclick
        qs('checkBtn').onclick = checkAnswer;
        showQuestion();
    } else {
        showResults();
    }
}

function showResults() {
    switchView('results');
    
    const total = state.questions.length;
    const accuracy = Math.round((state.correctAnswers / total) * 100);
    
    qs('finalScore').textContent = state.correctAnswers + '/' + total;
    qs('accuracyBar').style.width = accuracy + '%';
    qs('accuracyText').textContent = accuracy + '% accuracy';
    qs('correctCount').textContent = state.correctAnswers;
    qs('wrongCount').textContent = state.wrongAnswers;
    
    // Points calculation
    const basePoints = state.correctAnswers * 10;
    const streakBonus = state.correctAnswers >= 3 ? 20 : 0;
    const accuracyBonus = accuracy >= 80 ? 30 : accuracy >= 60 ? 15 : 0;
    const totalPoints = basePoints + streakBonus + accuracyBonus;
    
    if (totalPoints > 0) {
        qs('pointsEarned').classList.remove('hidden');
        qs('pointsValue').textContent = totalPoints;
        
        // Animate points
        let current = 0;
        const interval = setInterval(() => {
            current += Math.ceil(totalPoints / 20);
            if (current >= totalPoints) {
                current = totalPoints;
                clearInterval(interval);
            }
            qs('pointsValue').textContent = current;
        }, 50);
    } else {
        qs('pointsEarned').classList.add('hidden');
    }
    
    // Result message
    let message = 'Keep practicing!';
    let icon = '📚';
    if (accuracy === 100) {
        message = 'Perfect score! Amazing!';
        icon = '🌟';
    } else if (accuracy >= 80) {
        message = 'Great job! Well done!';
        icon = '🎉';
    } else if (accuracy >= 60) {
        message = 'Good work! Keep it up!';
        icon = '👍';
    }
    
    qs('resultMessage').textContent = message;
    qs('resultIcon').textContent = icon;
    
    // Update streak display
    loadUserStats();
}

function retryQuiz() {
    startTopic(state.currentTopic);
}

function goHome() {
    switchView('home');
    loadUserStats();
    loadTopics();
}

// ================= PROFILE & LEADERBOARD =================
async function loadUserStats() {
    try {
        const data = await api('get_user_stats');
        if (data.success && data.stats) {
            state.userStats = data.stats;
            
            // Update header
            qs('streakCount').textContent = data.stats.current_streak || 0;
            qs('userName').textContent = data.stats.username || 'Math Learner';
            
            // Update profile
            qs('profileName').textContent = data.stats.username || 'User';
            qs('profileInitial').textContent = (data.stats.username || 'U').charAt(0).toUpperCase();
            qs('profilePoints').textContent = data.stats.total_points || 0;
            qs('totalAnswered').textContent = data.stats.total_answered || 0;
            qs('bestStreak').textContent = data.stats.best_streak || 0;
            qs('topicsCompleted').textContent = data.stats.topics_completed || 0;
            qs('accuracyRate').textContent = (data.stats.accuracy || 0) + '%';
            
            // Join date
            if (data.stats.created_at) {
                const date = new Date(data.stats.created_at);
                qs('profileJoined').textContent = 'Member since ' + date.toLocaleDateString();
            }
            
            // Render achievements
            renderAchievements(data.stats.achievements || []);
        }
    } catch (e) {
        console.error('Load stats error:', e);
    }
}

function renderAchievements(achievements) {
    const list = qs('achievementsList');
    
    if (achievements.length === 0) {
        list.innerHTML = `
            <div class="text-center py-6 text-gray-400">
                <p class="text-sm">Complete quizzes to earn achievements!</p>
            </div>
        `;
        return;
    }
    
    const icons = {
        'first_steps': '🎯',
        'streak_master': '🔥',
        'perfect_score': '⭐',
        'topic_master': '📚',
        'math_wizard': '🧙',
        'daily_warrior': '📅',
        'helpful': '🤝',
        'popular': '💬'
    };
    
    list.innerHTML = achievements.map(ach => `
        <div class="flex items-center gap-4 p-4 bg-gradient-to-r from-gray-50 to-white rounded-2xl border border-gray-100">
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-100 to-orange-100 flex items-center justify-center text-2xl shadow-sm">
                ${icons[ach.id] || '🏆'}
            </div>
            <div class="flex-1">
                <h4 class="font-bold text-gray-900">${ach.name}</h4>
                <p class="text-xs text-gray-500">${ach.description}</p>
            </div>
            <span class="text-xs text-gray-400">${ach.earned_at ? new Date(ach.earned_at).toLocaleDateString() : ''}</span>
        </div>
    `).join('');
}

async function loadLeaderboard() {
    try {
        const data = await api('get_leaderboard');
        if (data.success && data.leaderboard) {
            renderLeaderboard(data.leaderboard, data.user_rank);
        }
    } catch (e) {
        console.error('Load leaderboard error:', e);
    }
}

function renderLeaderboard(leaderboard, userRank) {
    qs('userRank').textContent = userRank ? '#' + userRank.rank : '#--';
    qs('userPoints').textContent = userRank ? userRank.points + ' pts' : '0 pts';
    
    const medals = ['🥇', '🥈', '🥉'];
    
    qs('leaderboardList').innerHTML = leaderboard.map((user, idx) => {
        const isMe = user.telegram_id == state.telegramId;
        const medal = idx < 3 ? medals[idx] : `<span class="text-gray-400 font-bold">${idx + 1}</span>`;
        
        return `
            <div class="flex items-center gap-4 p-4 ${isMe ? 'bg-gradient-to-r from-teal-50 to-white border-l-4 border-teal-500' : 'hover:bg-gray-50'} transition-colors">
                <div class="w-8 text-center">${medal}</div>
                <div class="w-10 h-10 rounded-full ${getUserColor(user.telegram_id)} flex items-center justify-center text-white font-bold text-sm">
                    ${(user.username || 'U').charAt(0).toUpperCase()}
                </div>
                <div class="flex-1">
                    <p class="font-bold text-gray-900 ${isMe ? 'text-teal-700' : ''}">${user.username || 'Anonymous'}</p>
                    <p class="text-xs text-gray-500">${user.total_solved || 0} solved</p>
                </div>
                <div class="text-right">
                    <p class="font-bold text-teal-600">${user.total_points || 0}</p>
                    <p class="text-xs text-gray-400">pts</p>
                </div>
            </div>
        `;
    }).join('');
}

// ================= NOTIFICATIONS =================
function showNotifications() {
    qs('notificationsPanel').classList.remove('hidden');
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function hideNotifications() {
    qs('notificationsPanel').classList.add('hidden');
}

function clearNotifications() {
    qs('notificationsList').innerHTML = `
        <div class="text-center py-10 text-gray-400">
            <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg class="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
            </div>
            <p class="text-sm font-medium">No notifications</p>
            <p class="text-xs mt-1 text-gray-400">You're all caught up!</p>
        </div>
    `;
    qs('notifBadge').classList.add('hidden');
}

function dismissBanner() {
    qs('adminBanner').classList.add('hidden');
}

// ================= INITIALIZATION =================
async function initApp() {
    // Simulate loading progress
    let progress = 0;
    const loadingInterval = setInterval(() => {
        progress += Math.random() * 15 + 5;
        if (progress >= 100) {
            progress = 100;
            clearInterval(loadingInterval);
            setTimeout(() => {
                setLoading(false);
                qs('mainContent').classList.remove('hidden');
                qs('mainContent').classList.add('fade-in');
            }, 500);
        }
        updateLoadingProgress(progress);
    }, 200);
    
    // Get Telegram user data
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const user = tg.initDataUnsafe.user;
        state.telegramId = user.id;
        state.user = user;
        
        // Register/update user in backend
        await api('register_user', {
            username: user.username || user.first_name || 'User',
            first_name: user.first_name,
            last_name: user.last_name
        });
        
        // Load user data
        await loadUserStats();
    } else {
        // Demo mode
        state.telegramId = 'demo_' + Date.now();
        qs('userName').textContent = 'Demo User';
        console.log('Running in demo mode');
    }
    
    // Load initial data
    await loadTopics();
    await loadLeaderboard();
    
    // Check for daily challenge completion
    checkDailyStatus();
    
    // Setup input character counter
    const chatInput = qs('chatInput');
    if (chatInput) {
        chatInput.addEventListener('input', (e) => {
            const count = e.target.value.length;
            const counter = qs('charCount');
            if (count > 0) {
                counter.classList.remove('hidden');
                counter.textContent = count + '/500';
                counter.classList.toggle('text-orange-500', count > 450);
            } else {
                counter.classList.add('hidden');
            }
        });
    }
}

async function checkDailyStatus() {
    try {
        const data = await api('check_daily_status');
        if (data.success && data.completed) {
            qs('dailyCompleted').classList.remove('hidden');
            qs('dailyBtn').textContent = 'Completed ✓';
            qs('dailyBtn').disabled = true;
            qs('dailyBtn').classList.add('opacity-50');
        }
    } catch (e) {
        console.error('Daily status error:', e);
    }
}

// Handle back button
if (tg.BackButton) {
    tg.BackButton.onClick(() => {
        const currentView = document.querySelector('.nav-item.active')?.dataset.view;
        if (currentView && currentView !== 'home') {
            switchView('home');
        } else {
            tg.close();
        }
    });
}

// Handle theme changes
tg.onEvent('themeChanged', () => {
    document.body.style.backgroundColor = tg.backgroundColor || '#F0F4F8';
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);

// Handle visibility change (pause/resume polling)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (chatInterval) clearInterval(chatInterval);
    } else {
        const chatView = qs('chatView');
        if (chatView && !chatView.classList.contains('hidden')) {
            initChat();
        }
    }
});