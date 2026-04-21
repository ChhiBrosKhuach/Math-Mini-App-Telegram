CREATE DATABASE IF NOT EXISTS eklcpzrqle_mathbot 
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE eklcpzrqle_mathbot;

CREATE TABLE users (
  id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  telegram_id bigint(20) NOT NULL UNIQUE,
  first_name varchar(100) DEFAULT NULL,
  last_name varchar(100) DEFAULT NULL,
  username varchar(100) DEFAULT NULL,
  photo_url text DEFAULT NULL,
  xp int(11) DEFAULT 0,
  streak int(11) DEFAULT 0,
  best_streak int(11) DEFAULT 0,
  total_quizzes int(11) DEFAULT 0,
  total_correct int(11) DEFAULT 0,
  total_wrong int(11) DEFAULT 0,
  status enum('active','banned') DEFAULT 'active',
  last_active datetime DEFAULT CURRENT_TIMESTAMP,
  created_at datetime DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_last_active (last_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE questions (
  id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  topic varchar(50) NOT NULL,
  difficulty enum('Easy','Medium','Hard') DEFAULT 'Medium',
  question text NOT NULL,
  options json NOT NULL,
  correct int(11) NOT NULL DEFAULT 0,
  explanation text,
  status enum('active','inactive') DEFAULT 'active',
  usage_count int(11) DEFAULT 0,
  correct_count int(11) DEFAULT 0,
  created_at datetime DEFAULT CURRENT_TIMESTAMP,
  KEY idx_topic (topic),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE quiz_results (
  id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id bigint(20) NOT NULL,
  topic varchar(50) NOT NULL,
  correct int(11) DEFAULT 0,
  wrong int(11) DEFAULT 0,
  total int(11) DEFAULT 0,
  accuracy int(11) DEFAULT 0,
  created_at datetime DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_id (user_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE activity_log (
  id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type varchar(50) NOT NULL,
  message text,
  user_id bigint(20) DEFAULT NULL,
  metadata json DEFAULT NULL,
  created_at datetime DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE broadcasts (
  id int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target enum('all','active','premium') DEFAULT 'all',
  message text NOT NULL,
  attachment text,
  status enum('pending','sent','scheduled') DEFAULT 'sent',
  reach_count int(11) DEFAULT 0,
  created_at datetime DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE settings (
  key_name varchar(100) PRIMARY KEY,
  value text,
  updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (key_name, value) VALUES 
('app_name', 'MathBot'),
('maintenance_mode', '0'),
('daily_challenge_time', '09:00'),
('questions_per_quiz', '5'),
('show_explanations', '1'),
('leaderboard_enabled', '1');

-- Sample question
INSERT INTO questions (topic, difficulty, question, options, correct, explanation) VALUES
('Algebra', 'Easy', 'Solve for x: 2x + 5 = 13', '[\"x = 3\", \"x = 4\", \"x = 5\", \"x = 6\"]', 1, 'Subtract 5: 2x = 8, then divide by 2: x = 4');

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` int(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `telegram_id` bigint(20) NOT NULL,
  `first_name` varchar(100) DEFAULT NULL,
  `username` varchar(100) DEFAULT NULL,
  `message` text NOT NULL,
  `type` enum('text','system') DEFAULT 'text',
  `reply_to` int(11) UNSIGNED DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_telegram` (`telegram_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional: Insert a welcome system message
INSERT INTO `chat_messages` (`telegram_id`, `first_name`, `message`, `type`) VALUES
(0, 'System', 'Welcome to MathBot Group Chat! Be kind and helpful to others.', 'system');

SELECT telegram_id, first_name, username, xp, streak FROM users ORDER BY xp DESC