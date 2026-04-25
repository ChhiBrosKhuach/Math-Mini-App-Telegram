<?php
require_once 'config.php';

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? $_GET['action'] ?? '';

function json($data) { echo json_encode($data); exit; }

switch ($action) {

// ============================================================
// CHAT
// ============================================================

case 'get_chat_messages':
    $limit = min((int)($input['limit'] ?? 50), 100);
    $after_id = (int)($input['after_id'] ?? 0);

    // Auto-delete messages older than 24 hours
    try {
        $pdo->exec("DELETE FROM chat_messages WHERE created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)");
    } catch (Exception $e) {}

    // Also keep only the latest 50 messages total
    try {
        $pdo->exec("DELETE FROM chat_messages WHERE id NOT IN (
            SELECT id FROM (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 50) AS keep
        )");
    } catch (Exception $e) {}

    $sql = "
        SELECT 
            m.id,
            m.message,
            m.telegram_id,
            m.type,
            m.created_at,
            COALESCE(u.first_name, m.first_name, 'User') AS first_name,
            COALESCE(u.xp, 0)          AS xp,
            COALESCE(u.streak, 0)      AS streak,
            COALESCE(u.best_streak, 0) AS best_streak
        FROM chat_messages m
        LEFT JOIN users u ON m.telegram_id = u.telegram_id
        WHERE m.id > ?
        ORDER BY m.id ASC
        LIMIT $limit
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$after_id]);
    json(['success' => true, 'messages' => $stmt->fetchAll()]);
    break;

case 'send_chat_message':
    $telegram_id = $input['telegram_id'] ?? null;
    if (empty($telegram_id)) {
        json(['success' => false, 'error' => 'Unauthorized: Missing ID']);
    }

    // Ban check
    try {
        $check = $pdo->prepare("SELECT status FROM users WHERE telegram_id = ?");
        $check->execute([$telegram_id]);
        $status = $check->fetchColumn();
        if ($status === 'banned') {
            json(['success' => false, 'error' => 'You are banned from chat']);
        }
    } catch (Exception $e) {}

    $message = trim($input['message'] ?? '');
    if (empty($message) || mb_strlen($message) > 500) {
        json(['success' => false, 'error' => 'Message must be 1–500 characters']);
    }

    $first_name = htmlspecialchars($input['first_name'] ?? 'User', ENT_QUOTES, 'UTF-8');
    $username   = !empty($input['username']) ? htmlspecialchars($input['username'], ENT_QUOTES, 'UTF-8') : null;

    try {
        $stmt = $pdo->prepare("INSERT INTO chat_messages (telegram_id, first_name, username, message) VALUES (?, ?, ?, ?)");
        $stmt->execute([$telegram_id, $first_name, $username, $message]);
        json(['success' => true, 'id' => $pdo->lastInsertId()]);
    } catch (Exception $e) {
        json(['success' => false, 'error' => 'Failed to send: ' . $e->getMessage()]);
    }
    break;

case 'get_chat_stats':
    try {
        $stmt = $pdo->query("SELECT COUNT(DISTINCT telegram_id) as users, COUNT(*) as messages
            FROM chat_messages WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)");
        $today = $stmt->fetch(PDO::FETCH_ASSOC);
        $total = $pdo->query("SELECT COUNT(DISTINCT telegram_id) as total FROM chat_messages WHERE telegram_id != 0")
                     ->fetch(PDO::FETCH_ASSOC);
        json(['success' => true, 'stats' => array_merge($today, $total)]);
    } catch (Exception $e) {
        json(['success' => false, 'error' => 'Stats error']);
    }
    break;

// ============================================================
// AUTH
// ============================================================

case 'auth':
    $u = $input['user'] ?? null;
    if (!$u || !isset($u['id'])) json(['success' => false, 'error' => 'No user']);

    $stmt = $pdo->prepare("SELECT * FROM users WHERE telegram_id = ?");
    $stmt->execute([$u['id']]);
    $exists = $stmt->fetch();

    if (!$exists) {
        $stmt = $pdo->prepare("INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, last_active) VALUES (?, ?, ?, ?, ?, NOW())");
        $stmt->execute([$u['id'], $u['first_name'] ?? null, $u['last_name'] ?? null, $u['username'] ?? null, $u['photo_url'] ?? null]);

        $stmt = $pdo->prepare("INSERT INTO activity_log (type, message, user_id) VALUES (?, ?, ?)");
        $stmt->execute(['new_user', 'New user registered via Telegram', $u['id']]);
    } else {
        $stmt = $pdo->prepare("UPDATE users SET last_active = NOW(),
            first_name = COALESCE(?, first_name),
            last_name  = COALESCE(?, last_name),
            username   = COALESCE(?, username)
            WHERE telegram_id = ?");
        $stmt->execute([$u['first_name'] ?? null, $u['last_name'] ?? null, $u['username'] ?? null, $u['id']]);
    }

    $stmt = $pdo->prepare("SELECT * FROM users WHERE telegram_id = ?");
    $stmt->execute([$u['id']]);
    json(['success' => true, 'user' => $stmt->fetch()]);
    break;

// ============================================================
// QUESTIONS
// ============================================================

// ============================================================
// QUESTIONS
// ============================================================

case 'get_questions':
    $topic = $input['topic'] ?? 'Algebra';
    $limit = min((int)($input['limit'] ?? 5), 50);
    $tid   = $input['telegram_id'] ?? 0;

    // Ensure tracking table exists (with topic column)
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS user_solved (
            user_id bigint(20) NOT NULL,
            question_id int(11) UNSIGNED NOT NULL,
            topic varchar(100) DEFAULT NULL,
            solved_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, question_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("ALTER TABLE user_solved ADD COLUMN IF NOT EXISTS topic varchar(100) DEFAULT NULL");
    } catch (Exception $e) {}

    $stmt = $pdo->prepare("
        SELECT id, topic, difficulty, question, options, correct, explanation
        FROM questions
        WHERE topic = ? AND status = 'active'
          AND id NOT IN (
              SELECT question_id FROM user_solved
              WHERE user_id = ? AND (topic = ? OR topic IS NULL)
          )
        ORDER BY RAND()
        LIMIT ?");
    $stmt->execute([$topic, $tid, $topic, $limit]);

    $questions = $stmt->fetchAll();
    foreach ($questions as &$q) {
        $q['options'] = json_decode($q['options'], true);
    }
    json(['success' => true, 'questions' => $questions]);
    break;

// ============================================================
// SUBMIT QUIZ
// ============================================================

case 'submit_quiz':
    $tid = $input['telegram_id'] ?? null;
    $r   = $input['results']     ?? null;
    if (!$tid || !$r) json(['success' => false, 'error' => 'Missing data']);

    $xp          = ($r['correct'] ?? 0) * 10;
    $wrong_count = $r['wrong'] ?? 0;

    $stmt = $pdo->prepare("SELECT streak, best_streak FROM users WHERE telegram_id = ?");
    $stmt->execute([$tid]);
    $userData = $stmt->fetch();

    $current_streak = $userData['streak']      ?? 0;
    $best_streak    = $userData['best_streak'] ?? 0;

    if ($wrong_count > 0) {
        $new_streak      = 0;
        $new_best_streak = $best_streak;
        $streak_lost     = true;
    } else {
        $new_streak      = $current_streak + 1;
        $new_best_streak = max($best_streak, $new_streak);
        $streak_lost     = false;
    }

    // Bonus XP for perfect quiz
    $bonus_xp = 0;
    if ($wrong_count === 0 && ($r['total'] ?? 0) > 0) $bonus_xp = 20;
    // Streak milestone bonus
    if (!$streak_lost && $new_streak % 7 === 0) $bonus_xp += 50;

    $total_xp = $xp + $bonus_xp;

    $stmt = $pdo->prepare("
        UPDATE users SET
            total_correct = total_correct + ?,
            total_wrong   = total_wrong   + ?,
            xp            = xp + ?,
            total_quizzes = total_quizzes + 1,
            streak        = ?,
            best_streak   = ?,
            last_active   = NOW()
        WHERE telegram_id = ?");
    $stmt->execute([$r['correct'] ?? 0, $wrong_count, $total_xp, $new_streak, $new_best_streak, $tid]);

    // Save quiz result
    $accuracy = $r['total'] > 0 ? round(($r['correct'] / $r['total']) * 100) : 0;
    $stmt = $pdo->prepare("INSERT INTO quiz_results (user_id, topic, correct, wrong, total, accuracy) VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->execute([$tid, $r['topic'] ?? '', $r['correct'] ?? 0, $wrong_count, $r['total'] ?? 0, $accuracy]);

    // Save solved questions
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS user_solved (
            user_id bigint(20) NOT NULL,
            question_id int(11) UNSIGNED NOT NULL,
            topic varchar(100) DEFAULT NULL,
            solved_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, question_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("ALTER TABLE user_solved ADD COLUMN IF NOT EXISTS topic varchar(100) DEFAULT NULL");
    } catch (Exception $e) {}

    foreach (($r['questions'] ?? []) as $qid) {
        $stmt = $pdo->prepare("INSERT IGNORE INTO user_solved (user_id, question_id, topic) VALUES (?, ?, ?)");
        $stmt->execute([$tid, $qid, $r['topic'] ?? '']);
    }

    json([
        'success'      => true,
        'xp_earned'    => $total_xp,
        'bonus_xp'     => $bonus_xp,
        'streak'       => $new_streak,
        'best_streak'  => $new_best_streak,
        'streak_lost'  => $streak_lost
    ]);
    break;

// ============================================================
// LEADERBOARD
// ============================================================

case 'get_leaderboard':
    $stmt = $pdo->query("
        SELECT telegram_id, first_name, username, xp, streak, best_streak, total_correct, total_quizzes
        FROM users
        WHERE status = 'active'
        ORDER BY xp DESC
        LIMIT 50");
    json(['success' => true, 'leaderboard' => $stmt->fetchAll()]);
    break;

// ============================================================
// PROFILE
// ============================================================

case 'get_profile':
    $tid = $input['telegram_id'] ?? null;
    if (!$tid) json(['success' => false, 'error' => 'No ID']);

    // Ensure privacy_mode column exists
    try { $pdo->exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_mode tinyint(1) DEFAULT 0"); } catch (Exception $e) {}

    $stmt = $pdo->prepare("SELECT * FROM users WHERE telegram_id = ?");
    $stmt->execute([$tid]);
    $user = $stmt->fetch();
    if (!$user) json(['success' => false, 'error' => 'User not found']);

    // Topic diversity
    $stmt = $pdo->prepare("SELECT COUNT(DISTINCT topic) FROM quiz_results WHERE user_id = ?");
    $stmt->execute([$tid]);
    $topics_completed = (int)$stmt->fetchColumn();

    $accuracy = ($user['total_correct'] + $user['total_wrong'] > 0)
        ? round($user['total_correct'] / ($user['total_correct'] + $user['total_wrong']) * 100)
        : 0;

    // Per-topic stats
    $stmt = $pdo->prepare("
        SELECT topic,
               SUM(correct) as correct,
               SUM(total)   as total,
               COUNT(*)     as quizzes
        FROM quiz_results
        WHERE user_id = ?
        GROUP BY topic");
    $stmt->execute([$tid]);
    $topic_stats = $stmt->fetchAll();

    json([
        'success'          => true,
        'user'             => $user,
        'topics_completed' => $topics_completed,
        'accuracy'         => $accuracy,
        'topic_stats'      => $topic_stats
    ]);
    break;

// ============================================================
// ADMIN – QUESTIONS
// ============================================================

case 'get_questions_admin':
    $topic      = $input['topic']      ?? '';
    $difficulty = $input['difficulty'] ?? '';
    $where  = "WHERE 1=1"; $params = [];
    if ($topic)      { $where .= " AND topic = ?";      $params[] = $topic; }
    if ($difficulty) { $where .= " AND difficulty = ?"; $params[] = $difficulty; }

    $stmt = $pdo->prepare("SELECT * FROM questions $where ORDER BY created_at DESC");
    $stmt->execute($params);
    $questions = $stmt->fetchAll();
    foreach ($questions as &$q) {
        $q['options']   = json_decode($q['options'], true);
        $q['usage']     = (int)$q['usage_count'];
        $q['accuracy']  = $q['usage_count'] > 0
            ? round(($q['correct_count'] / $q['usage_count']) * 100)
            : 0;
    }
    json(['success' => true, 'questions' => $questions]);
    break;

case 'save_question':
    $id          = $input['id']          ?? null;
    $topic       = $input['topic']       ?? '';
    $difficulty  = $input['difficulty']  ?? 'Medium';
    $question    = $input['question']    ?? '';
    $options     = json_encode($input['options'] ?? []);
    $correct     = (int)($input['correct'] ?? 0);
    $explanation = $input['explanation'] ?? '';

    if ($id) {
        $stmt = $pdo->prepare("UPDATE questions SET topic=?,difficulty=?,question=?,options=?,correct=?,explanation=? WHERE id=?");
        $stmt->execute([$topic, $difficulty, $question, $options, $correct, $explanation, $id]);
    } else {
        $stmt = $pdo->prepare("INSERT INTO questions (topic,difficulty,question,options,correct,explanation) VALUES (?,?,?,?,?,?)");
        $stmt->execute([$topic, $difficulty, $question, $options, $correct, $explanation]);
        $id = $pdo->lastInsertId();
    }
    json(['success' => true, 'id' => $id]);
    break;

case 'delete_question':
    $id = (int)($input['id'] ?? 0);
    $pdo->prepare("DELETE FROM questions WHERE id = ?")->execute([$id]);
    json(['success' => true]);
    break;

// ============================================================
// ADMIN – STATS, USERS, BROADCASTS, SETTINGS
// ============================================================

case 'get_stats':
    $totalUsers   = (int)$pdo->query("SELECT COUNT(*) FROM users")->fetchColumn();
    $activeToday  = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE last_active >= CURDATE()")->fetchColumn();
    $totalQuizzes = (int)$pdo->query("SELECT COUNT(*) FROM quiz_results")->fetchColumn();
    $activeStreaks = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE streak > 0")->fetchColumn();

    $stmt = $pdo->query("SELECT a.*, u.first_name, u.username
        FROM activity_log a LEFT JOIN users u ON a.user_id = u.telegram_id
        ORDER BY a.created_at DESC LIMIT 10");
    $activity = $stmt->fetchAll();

    json(['success' => true, 'stats' => [
        'total_users'   => $totalUsers,
        'active_today'  => $activeToday,
        'total_quizzes' => $totalQuizzes,
        'active_streaks'=> $activeStreaks,
        'active_now'    => (int)($activeToday * 0.85)
    ], 'activity' => $activity]);
    break;

case 'get_users':
    $page   = max(1, (int)($input['page']  ?? 1));
    $limit  = (int)($input['limit'] ?? 10);
    $offset = ($page - 1) * $limit;
    $search = $input['search'] ?? '';
    $filter = $input['filter'] ?? 'all';

    $where = "WHERE 1=1"; $params = [];
    if ($search) {
        $where  .= " AND (first_name LIKE ? OR username LIKE ? OR telegram_id LIKE ?)";
        $params  = ["%$search%", "%$search%", "%$search%"];
    }
    if ($filter === 'active')  $where .= " AND last_active >= CURDATE()";
    if ($filter === 'new')     $where .= " AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
    if ($filter === 'banned')  $where .= " AND status = 'banned'";

    $stmt = $pdo->prepare("SELECT * FROM users $where ORDER BY created_at DESC LIMIT ? OFFSET ?");
    $stmt->execute(array_merge($params, [$limit, $offset]));
    $users = $stmt->fetchAll();

    $stmt = $pdo->prepare("SELECT COUNT(*) FROM users $where");
    $stmt->execute($params);
    $total = (int)$stmt->fetchColumn();

    json(['success' => true, 'users' => $users, 'total' => $total]);
    break;

case 'update_user':
    $id     = (int)($input['id'] ?? 0);
    $status = $input['status'] ?? null;
    if ($status) {
        $pdo->prepare("UPDATE users SET status = ? WHERE id = ?")->execute([$status, $id]);
    }
    json(['success' => true]);
    break;

case 'send_broadcast':
    $target  = $input['target']  ?? 'all';
    $message = $input['message'] ?? '';
    $pdo->prepare("INSERT INTO broadcasts (target, message, status) VALUES (?, ?, 'sent')")->execute([$target, $message]);
    $pdo->prepare("INSERT INTO activity_log (type, message) VALUES (?, ?)")->execute(['broadcast', "Broadcast sent to $target"]);
    json(['success' => true]);
    break;

case 'get_broadcasts':
    $stmt = $pdo->query("SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 10");
    json(['success' => true, 'broadcasts' => $stmt->fetchAll()]);
    break;

case 'get_settings':
    $stmt = $pdo->query("SELECT * FROM settings");
    $settings = [];
    while ($row = $stmt->fetch()) $settings[$row['key_name']] = $row['value'];
    json(['success' => true, 'settings' => $settings]);
    break;

case 'save_setting':
    $key = $input['key']   ?? '';
    $val = $input['value'] ?? '';
    $pdo->prepare("INSERT INTO settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?")->execute([$key, $val, $val]);
    json(['success' => true]);
    break;

// ============================================================
// CHAT STYLE — save & fetch published styles
// ============================================================

case 'save_chat_style':
    $tid        = $input['telegram_id'] ?? null;
    $style_json = $input['style_json']  ?? null;

    if (!$tid || !$style_json) {
        json(['success' => false, 'error' => 'Missing telegram_id or style_json']);
    }

    // Validate it's valid JSON and not oversized (max 2 KB)
    if (mb_strlen($style_json) > 2048) {
        json(['success' => false, 'error' => 'Style data too large']);
    }
    $decoded = json_decode($style_json, true);
    if (!is_array($decoded)) {
        json(['success' => false, 'error' => 'Invalid style JSON']);
    }

    // Ensure the chat_style column exists (runs once, silently ignored after)
    try {
        $pdo->exec("ALTER TABLE users ADD COLUMN chat_style TEXT DEFAULT NULL");
    } catch (Exception $e) {
        // Column already exists — that's fine
    }

    try {
        $stmt = $pdo->prepare("UPDATE users SET chat_style = ? WHERE telegram_id = ?");
        $stmt->execute([$style_json, $tid]);
        json(['success' => true]);
    } catch (Exception $e) {
        json(['success' => false, 'error' => 'Failed to save style: ' . $e->getMessage()]);
    }
    break;

case 'get_chat_styles':
    // Ensure column exists
    try {
        $pdo->exec("ALTER TABLE users ADD COLUMN chat_style TEXT DEFAULT NULL");
    } catch (Exception $e) {}

    try {
        $stmt = $pdo->query("
            SELECT telegram_id, chat_style
            FROM users
            WHERE chat_style IS NOT NULL
              AND status = 'active'
        ");
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Only return published styles (where published = true in the JSON)
        $published = [];
        foreach ($rows as $row) {
            $s = json_decode($row['chat_style'], true);
            if (is_array($s) && !empty($s['published'])) {
                $published[] = [
                    'telegram_id' => $row['telegram_id'],
                    'style_json'  => $row['chat_style']
                ];
            }
        }

        json(['success' => true, 'styles' => $published]);
    } catch (Exception $e) {
        json(['success' => false, 'error' => 'Failed to fetch styles: ' . $e->getMessage()]);
    }
    break;

// ============================================================
// PRIVACY MODE
// ============================================================

case 'set_privacy':
    $tid = $input['telegram_id'] ?? null;
    $mode = (int)($input['privacy_mode'] ?? 0);
    if (!$tid) json(['success' => false, 'error' => 'No ID']);
    try {
        $pdo->exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_mode tinyint(1) DEFAULT 0");
        $pdo->prepare("UPDATE users SET privacy_mode = ? WHERE telegram_id = ?")->execute([$mode, $tid]);
        json(['success' => true]);
    } catch (Exception $e) {
        json(['success' => false, 'error' => $e->getMessage()]);
    }
    break;

// ============================================================
// COMMUNITY QUIZ — SUBMIT (user creates quiz, pending admin review)
// ============================================================

case 'submit_community_quiz':
    $tid  = $input['telegram_id'] ?? null;
    $q    = trim($input['question'] ?? '');
    $opts = $input['options'] ?? [];
    $cor  = (int)($input['correct'] ?? 0);
    $topic = trim($input['topic'] ?? 'General');
    $expl = trim($input['explanation'] ?? '');

    if (!$tid || !$q || count($opts) !== 4) {
        json(['success' => false, 'error' => 'Missing fields']);
    }
    if (mb_strlen($q) > 1000) json(['success' => false, 'error' => 'Question too long']);

    // Daily limit check
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS community_quizzes (
            id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            telegram_id bigint(20) NOT NULL,
            topic varchar(100) DEFAULT 'General',
            question text NOT NULL,
            options json NOT NULL,
            correct int(11) NOT NULL DEFAULT 0,
            explanation text,
            status enum('pending','approved','rejected') DEFAULT 'pending',
            reviewed_at datetime DEFAULT NULL,
            reviewed_by varchar(100) DEFAULT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            KEY idx_telegram (telegram_id),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    } catch (Exception $e) {}

    // Check daily limit
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM community_quizzes WHERE telegram_id = ? AND DATE(created_at) = CURDATE()");
    $stmt->execute([$tid]);
    if ((int)$stmt->fetchColumn() > 0) {
        json(['success' => false, 'error' => 'You can only submit 1 quiz per day']);
    }

    $stmt = $pdo->prepare("INSERT INTO community_quizzes (telegram_id, topic, question, options, correct, explanation) VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->execute([$tid, $topic, $q, json_encode($opts), $cor, $expl]);
    $new_id = $pdo->lastInsertId();

    // Log as notification for admin
    $pdo->prepare("INSERT INTO activity_log (type, message, user_id, metadata) VALUES (?, ?, ?, ?)")
        ->execute(['community_quiz_submitted', "New community quiz submitted (ID: $new_id)", $tid, json_encode(['quiz_id' => $new_id, 'topic' => $topic])]);

    json(['success' => true, 'id' => $new_id]);
    break;

// ============================================================
// COMMUNITY QUIZ — GET (approved quizzes for students to play)
// ============================================================

case 'get_community_quizzes':
    $topic   = $input['topic']   ?? '';
    $summary = $input['summary'] ?? false;

    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS community_quizzes (
            id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            telegram_id bigint(20) NOT NULL,
            topic varchar(100) DEFAULT 'General',
            question text NOT NULL,
            options json NOT NULL,
            correct int(11) NOT NULL DEFAULT 0,
            explanation text,
            status enum('pending','approved','rejected') DEFAULT 'pending',
            reviewed_at datetime DEFAULT NULL,
            reviewed_by varchar(100) DEFAULT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            KEY idx_telegram (telegram_id),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    } catch (Exception $e) {}

    if ($summary) {
        // Return list of topics with counts
        $stmt = $pdo->query("SELECT topic, COUNT(*) as count FROM community_quizzes WHERE status='approved' GROUP BY topic ORDER BY count DESC");
        json(['success' => true, 'topics' => $stmt->fetchAll()]);
    } else {
        $where = "WHERE status='approved'";
        $params = [];
        if ($topic) { $where .= " AND topic = ?"; $params[] = $topic; }

        // Exclude already-solved community questions
        $tid = $input['telegram_id'] ?? 0;
        if ($tid) {
            try {
                $pdo->exec("CREATE TABLE IF NOT EXISTS user_solved (
                    user_id bigint(20) NOT NULL,
                    question_id int(11) UNSIGNED NOT NULL,
                    topic varchar(100) DEFAULT NULL,
                    solved_at datetime DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, question_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                $pdo->exec("ALTER TABLE user_solved ADD COLUMN IF NOT EXISTS topic varchar(100) DEFAULT NULL");
            } catch (Exception $e) {}
            $where .= " AND id NOT IN (
                SELECT question_id FROM user_solved
                WHERE user_id = ? AND (topic = ? OR topic IS NULL)
            )";
            $params[] = $tid;
            $params[] = $topic;
        }

        $stmt = $pdo->prepare("SELECT id, topic, question, options, correct, explanation FROM community_quizzes $where ORDER BY RAND() LIMIT 20");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) $r['options'] = json_decode($r['options'], true);
        json(['success' => true, 'questions' => $rows]);
    }
    break;

// ============================================================
// COMMUNITY QUIZ — ADMIN REVIEW (accept / reject)
// ============================================================

case 'review_community_quiz':
    $quiz_id = (int)($input['quiz_id'] ?? 0);
    $action_val = $input['action_val'] ?? 'approve'; // 'approve' or 'reject'
    if (!$quiz_id) json(['success' => false, 'error' => 'Missing quiz_id']);

    $new_status = $action_val === 'approve' ? 'approved' : 'rejected';
    $pdo->prepare("UPDATE community_quizzes SET status=?, reviewed_at=NOW() WHERE id=?")->execute([$new_status, $quiz_id]);

    // Fetch quiz and author to notify
    $stmt = $pdo->prepare("SELECT cq.telegram_id, cq.topic, u.first_name FROM community_quizzes cq LEFT JOIN users u ON cq.telegram_id = u.telegram_id WHERE cq.id = ?");
    $stmt->execute([$quiz_id]);
    $row = $stmt->fetch();

    if ($row) {
        $notif_type = $action_val === 'approve' ? 'quiz_approved' : 'quiz_rejected';
        $notif_msg  = $action_val === 'approve'
            ? "Your quiz on '{$row['topic']}' was approved! It's now live for all students."
            : "Your quiz on '{$row['topic']}' was rejected. Keep creating better questions!";
        $pdo->prepare("INSERT INTO activity_log (type, message, user_id) VALUES (?, ?, ?)")
            ->execute([$notif_type, $notif_msg, $row['telegram_id']]);
    }

    json(['success' => true, 'status' => $new_status]);
    break;

// ============================================================
// COMMUNITY QUIZ — GET PENDING (admin panel)
// ============================================================

case 'get_pending_quizzes':
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS community_quizzes (id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY, telegram_id bigint(20) NOT NULL, topic varchar(100) DEFAULT 'General', question text NOT NULL, options json NOT NULL, correct int(11) NOT NULL DEFAULT 0, explanation text, status enum('pending','approved','rejected') DEFAULT 'pending', reviewed_at datetime DEFAULT NULL, created_at datetime DEFAULT CURRENT_TIMESTAMP, KEY idx_status (status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    } catch(Exception $e) {}
    $stmt = $pdo->query("SELECT cq.*, u.first_name, u.username FROM community_quizzes cq LEFT JOIN users u ON cq.telegram_id = u.telegram_id WHERE cq.status = 'pending' ORDER BY cq.created_at DESC LIMIT 50");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) $r['options'] = json_decode($r['options'], true);
    json(['success' => true, 'quizzes' => $rows]);
    break;

// ============================================================
// SUBMIT ONLINE QUIZ (community quiz, 5XP per correct, no streak)
// ============================================================

// ============================================================
// SUBMIT ONLINE QUIZ (community quiz, 5XP per correct, streak always +1)
// ============================================================

case 'submit_online_quiz':
    $tid = $input['telegram_id'] ?? null;
    $r   = $input['results']     ?? null;
    if (!$tid || !$r) json(['success' => false, 'error' => 'Missing data']);

    $correct   = (int)($r['correct'] ?? 0);
    $wrong     = (int)($r['wrong']   ?? 0);
    $xp_earned = $correct * 5; // 5 XP per correct answer for community quizzes

    // Community quiz: streak is unaffected (no increase, no loss)
    $stmt = $pdo->prepare("SELECT streak, best_streak FROM users WHERE telegram_id = ?");
    $stmt->execute([$tid]);
    $userData = $stmt->fetch();

    $current_streak  = $userData['streak']      ?? 0;
    $best_streak     = $userData['best_streak'] ?? 0;
    // Keep streak unchanged
    $new_streak      = $current_streak;
    $new_best_streak = $best_streak;

    $pdo->prepare("UPDATE users SET xp = xp + ?, total_quizzes = total_quizzes + 1, total_correct = total_correct + ?, total_wrong = total_wrong + ?, streak = ?, best_streak = ?, last_active = NOW() WHERE telegram_id = ?")
        ->execute([$xp_earned, $correct, $wrong, $new_streak, $new_best_streak, $tid]);

    $accuracy = ($r['total'] ?? 0) > 0 ? round($correct / $r['total'] * 100) : 0;
    $pdo->prepare("INSERT INTO quiz_results (user_id, topic, correct, wrong, total, accuracy) VALUES (?, ?, ?, ?, ?, ?)")
        ->execute([$tid, $r['topic'] ?? 'Community', $correct, $wrong, $r['total'] ?? 0, $accuracy]);

    // Save solved community questions too
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS user_solved (
            user_id bigint(20) NOT NULL,
            question_id int(11) UNSIGNED NOT NULL,
            topic varchar(100) DEFAULT NULL,
            solved_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, question_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("ALTER TABLE user_solved ADD COLUMN IF NOT EXISTS topic varchar(100) DEFAULT NULL");
    } catch (Exception $e) {}

    foreach (($r['questions'] ?? []) as $qid) {
        $stmt = $pdo->prepare("INSERT IGNORE INTO user_solved (user_id, question_id, topic) VALUES (?, ?, ?)");
        $stmt->execute([$tid, $qid, $r['topic'] ?? 'Community']);
    }

    json(['success' => true, 'xp_earned' => $xp_earned, 'streak_lost' => false, 'streak' => $new_streak, 'best_streak' => $new_best_streak]);
    break;

// ============================================================
// USER NOTIFICATIONS (quiz accepted/rejected)
// ============================================================

case 'get_user_notifications':
    $tid = $input['telegram_id'] ?? null;
    if (!$tid) json(['success' => false, 'error' => 'No ID']);
    $stmt = $pdo->prepare("SELECT * FROM activity_log WHERE user_id = ? AND type IN ('quiz_approved','quiz_rejected') ORDER BY created_at DESC LIMIT 20");
    $stmt->execute([$tid]);
    json(['success' => true, 'notifications' => $stmt->fetchAll()]);
    break;

// ============================================================
// CREATOR STUDIO — get my submitted quizzes + analytics
// ============================================================

case 'get_my_quizzes':
    $tid = $input['telegram_id'] ?? null;
    if (!$tid) json(['success' => false, 'error' => 'No ID']);

    // Ensure tables exist
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS community_quizzes (
            id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            telegram_id bigint(20) NOT NULL,
            topic varchar(100) DEFAULT 'General',
            question text NOT NULL,
            options json NOT NULL,
            correct int(11) NOT NULL DEFAULT 0,
            explanation text,
            status enum('pending','approved','rejected') DEFAULT 'pending',
            reviewed_at datetime DEFAULT NULL,
            reviewed_by varchar(100) DEFAULT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            KEY idx_telegram (telegram_id),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        $pdo->exec("CREATE TABLE IF NOT EXISTS quiz_answer_events (
            id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            quiz_id int(11) UNSIGNED NOT NULL,
            user_id bigint(20) NOT NULL,
            is_correct tinyint(1) NOT NULL DEFAULT 0,
            time_taken_seconds int(11) DEFAULT NULL,
            answered_at datetime DEFAULT CURRENT_TIMESTAMP,
            KEY idx_quiz (quiz_id),
            KEY idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    } catch (Exception $e) {}

    // Fetch my quizzes
    $stmt = $pdo->prepare("SELECT id, topic, question, options, correct, explanation, status, created_at
                           FROM community_quizzes
                           WHERE telegram_id = ?
                           ORDER BY created_at DESC
                           LIMIT 50");
    $stmt->execute([$tid]);
    $quizzes = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($quizzes as &$q) {
        $q['options'] = json_decode($q['options'], true);

        // Per-quiz analytics if approved
        if ($q['status'] === 'approved') {
            $aStmt = $pdo->prepare("
                SELECT
                    COUNT(*)                             AS total_answers,
                    SUM(is_correct)                      AS total_correct,
                    ROUND(AVG(time_taken_seconds))       AS avg_time_seconds,
                    ROUND(AVG(is_correct)*100)           AS avg_score
                FROM quiz_answer_events
                WHERE quiz_id = ?");
            $aStmt->execute([$q['id']]);
            $q['analytics'] = $aStmt->fetch(PDO::FETCH_ASSOC);
            // total_views = total times the quiz was shown (same as total_answers here)
            $q['analytics']['total_views'] = $q['analytics']['total_answers'] ?? 0;
        }
    }
    unset($q);

    // Aggregate analytics across all my approved quizzes
    $aggStmt = $pdo->prepare("
        SELECT
            COUNT(qae.id)                           AS total_answers,
            SUM(qae.is_correct)                     AS total_correct,
            SUM(1 - qae.is_correct)                 AS total_wrong,
            COUNT(DISTINCT qae.id)                  AS total_views,
            ROUND(AVG(qae.time_taken_seconds))      AS avg_time_seconds,
            ROUND(AVG(qae.is_correct)*100)          AS avg_score
        FROM quiz_answer_events qae
        INNER JOIN community_quizzes cq ON qae.quiz_id = cq.id
        WHERE cq.telegram_id = ? AND cq.status = 'approved'");
    $aggStmt->execute([$tid]);
    $analytics = $aggStmt->fetch(PDO::FETCH_ASSOC);

    json(['success' => true, 'quizzes' => $quizzes, 'analytics' => $analytics]);
    break;
    
case 'get_solved_questions':
    $tid = $input['telegram_id'] ?? null;
    $topic = $input['topic'] ?? '';
    if (!$tid) json(['success' => false, 'error' => 'No ID']);

    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS user_solved (
            user_id bigint(20) NOT NULL,
            question_id int(11) UNSIGNED NOT NULL,
            topic varchar(100) DEFAULT NULL,
            solved_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, question_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("ALTER TABLE user_solved ADD COLUMN IF NOT EXISTS topic varchar(100) DEFAULT NULL");
    } catch (Exception $e) {}

    $stmt = $pdo->prepare("SELECT question_id FROM user_solved WHERE user_id = ? AND (topic = ? OR topic IS NULL)");
    $stmt->execute([$tid, $topic]);
    json(['success' => true, 'solved' => $stmt->fetchAll(PDO::FETCH_COLUMN)]);
    break;

case 'mark_question_solved':
    $tid = $input['telegram_id'] ?? null;
    $qid = (int)($input['question_id'] ?? 0);
    $topic = $input['topic'] ?? '';
    if (!$tid || !$qid) json(['success' => false, 'error' => 'Missing data']);

    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS user_solved (
            user_id bigint(20) NOT NULL,
            question_id int(11) UNSIGNED NOT NULL,
            topic varchar(100) DEFAULT NULL,
            solved_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, question_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("ALTER TABLE user_solved ADD COLUMN IF NOT EXISTS topic varchar(100) DEFAULT NULL");
    } catch (Exception $e) {}

    $stmt = $pdo->prepare("INSERT IGNORE INTO user_solved (user_id, question_id, topic) VALUES (?, ?, ?)");
    $stmt->execute([$tid, $qid, $topic]);
    json(['success' => true]);
    break;

// ============================================================
// RECORD QUIZ ANSWER EVENT (tracks per-question answer stats)
// ============================================================

case 'record_quiz_answer':
    $quiz_id     = (int)($input['quiz_id'] ?? 0);
    $user_id     = $input['telegram_id'] ?? null;
    $is_correct  = (int)($input['is_correct'] ?? 0);
    $time_taken  = isset($input['time_taken_seconds']) ? (int)$input['time_taken_seconds'] : null;

    if (!$quiz_id || !$user_id) json(['success' => false, 'error' => 'Missing fields']);

    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS quiz_answer_events (
            id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            quiz_id int(11) UNSIGNED NOT NULL,
            user_id bigint(20) NOT NULL,
            is_correct tinyint(1) NOT NULL DEFAULT 0,
            time_taken_seconds int(11) DEFAULT NULL,
            answered_at datetime DEFAULT CURRENT_TIMESTAMP,
            KEY idx_quiz (quiz_id),
            KEY idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        $pdo->prepare("INSERT INTO quiz_answer_events (quiz_id, user_id, is_correct, time_taken_seconds) VALUES (?, ?, ?, ?)")
            ->execute([$quiz_id, $user_id, $is_correct ? 1 : 0, $time_taken]);
        json(['success' => true]);
    } catch (Exception $e) {
        json(['success' => false, 'error' => $e->getMessage()]);
    }
    break;

// ============================================================
// SEED — 15 Math problems (run once from admin)
// ============================================================

case 'seed_math_questions':
    $rows = [
        ['Arithmetic',   'Easy',   'What is 15 + 28?',                                          '["43","42","44","41"]',         0, '15 + 28 = 43'],
        ['Arithmetic',   'Easy',   'What is 144 ÷ 12?',                                         '["10","11","12","13"]',         2, '144 ÷ 12 = 12'],
        ['Arithmetic',   'Medium', 'What is 7 × 8 + 6 ÷ 2?',                                   '["59","58","57","56"]',         0, '7×8=56, 6÷2=3, 56+3=59'],
        ['Arithmetic',   'Hard',   'What is the greatest common divisor (GCD) of 48 and 60?',   '["8","10","12","6"]',           2, 'Factors of 48: 1,2,3,4,6,8,12,16,24,48. Factors of 60: 1,2,3,4,5,6,10,12,15,20,30,60. GCD = 12'],
        ['Algebra',      'Easy',   'Solve for x: 2x + 4 = 10',                                 '["2","3","4","5"]',             1, '2x = 10 - 4 = 6, so x = 3'],
        ['Algebra',      'Medium', 'What are the roots of x² - 5x + 6 = 0?',                   '["x=2 and x=3","x=1 and x=6","x=-2 and x=-3","x=2 and x=-3"]', 0, 'Factor: (x-2)(x-3) = 0, so x = 2 or x = 3'],
        ['Algebra',      'Hard',   'If f(x) = 3x² - 2x + 1, what is f(3)?',                   '["22","24","26","28"]',         2, 'f(3) = 3(9) - 2(3) + 1 = 27 - 6 + 1 = 22. Wait: 3×9=27, 27-6+1=22. Answer: 22'],
        ['Geometry',     'Easy',   'What is the area of a circle with radius 5? (Use π ≈ 3.14)','["78.5","75.4","80.1","70.0"]', 0, 'A = π × r² = 3.14 × 25 = 78.5'],
        ['Geometry',     'Medium', 'A right triangle has legs 6 and 8. What is the hypotenuse?','["10","9","11","12"]',          0, 'By Pythagorean theorem: c² = 6² + 8² = 36 + 64 = 100, c = 10'],
        ['Geometry',     'Hard',   'What is the sum of interior angles of a hexagon?',          '["540°","600°","720°","660°"]', 2, 'Sum = (n-2) × 180° = (6-2) × 180° = 4 × 180° = 720°'],
        ['Trigonometry', 'Easy',   'What is sin(30°)?',                                         '["0.5","0.75","1.0","0.25"]',   0, 'sin(30°) = 1/2 = 0.5'],
        ['Trigonometry', 'Medium', 'What is the value of cos(60°)?',                            '["0.5","√3/2","1","0"]',        0, 'cos(60°) = 1/2 = 0.5'],
        ['Trigonometry', 'Hard',   'If tan(θ) = 3/4 and θ is in the first quadrant, what is sin(θ)?', '["3/5","4/5","3/4","4/3"]', 0, 'In a 3-4-5 right triangle: hypotenuse = 5, sin(θ) = opposite/hypotenuse = 3/5'],
        ['Arithmetic',   'Medium', 'What is 15% of 240?',                                       '["36","32","38","34"]',         0, '15% of 240 = 0.15 × 240 = 36'],
        ['Algebra',      'Medium', 'Simplify: (x² - 9) ÷ (x - 3)',                             '["x + 3","x - 3","x² + 3","x + 9"]', 0, 'x² - 9 = (x-3)(x+3), so (x²-9)/(x-3) = x+3'],
    ];

    $inserted = 0;
    foreach ($rows as $row) {
        try {
            $stmt = $pdo->prepare("INSERT INTO questions (topic, difficulty, question, options, correct, explanation, status) VALUES (?, ?, ?, ?, ?, ?, 'active')");
            $stmt->execute($row);
            $inserted++;
        } catch (Exception $e) {}
    }
    json(['success' => true, 'inserted' => $inserted]);
    break;

default:
    json(['success' => false, 'error' => 'Unknown action: ' . $action]);
}
?>