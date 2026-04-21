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

case 'get_questions':
    $topic = $input['topic'] ?? 'Algebra';
    $limit = min((int)($input['limit'] ?? 5), 20);
    $tid   = $input['telegram_id'] ?? 0;

    // Try with user_solved exclusion first; fall back if table missing
    try {
        $stmt = $pdo->prepare("
            SELECT id, topic, difficulty, question, options, correct, explanation
            FROM questions
            WHERE topic = ? AND status = 'active'
              AND id NOT IN (SELECT question_id FROM user_solved WHERE user_id = ?)
            ORDER BY RAND()
            LIMIT ?");
        $stmt->execute([$topic, $tid, $limit]);
    } catch (PDOException $e) {
        // user_solved table may not exist yet
        $stmt = $pdo->prepare("
            SELECT id, topic, difficulty, question, options, correct, explanation
            FROM questions
            WHERE topic = ? AND status = 'active'
            ORDER BY RAND()
            LIMIT ?");
        $stmt->execute([$topic, $limit]);
    }

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

    // Save solved questions (create table if needed)
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS user_solved (
            user_id bigint(20) NOT NULL,
            question_id int(11) UNSIGNED NOT NULL,
            solved_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, question_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        foreach (($r['questions'] ?? []) as $qid) {
            $stmt = $pdo->prepare("INSERT IGNORE INTO user_solved (user_id, question_id) VALUES (?, ?)");
            $stmt->execute([$tid, $qid]);
        }
    } catch (Exception $e) {}

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

default:
    json(['success' => false, 'error' => 'Unknown action: ' . $action]);
}
?>