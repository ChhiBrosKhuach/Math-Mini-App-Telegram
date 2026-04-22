# 🤖 MathBot — Telegram Mini App

A gamified math learning Telegram Mini App where users solve problems, earn XP, level up, maintain streaks, and chat with other learners. Built with vanilla HTML, CSS, and JavaScript.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🧮 **Quiz System** | Random math problems across 4 topics (Algebra, Geometry, Arithmetic, Trigonometry) |
| 🏆 **XP & Levels** | Earn XP, level up from Beginner to Legend (10 levels) |
| 🔥 **Streak System** | Daily challenges to maintain weekly streaks |
| 💬 **Group Chat** | Real-time math chat with KaTeX rendering for formulas |
| 🎨 **Chat Customization** | Custom bubble colors, text colors, and stickers |
| 🥇 **Leaderboard** | Rank by XP or streak with podium display |
| 🎯 **Achievements** | 15 unlockable achievements with toast notifications |
| 🛡️ **Anti-Cheat** | Server-side quiz session tracking prevents skipping |

---

## 🚀 Getting Started

### Prerequisites
- A Telegram bot with Mini App enabled
- Web server with PHP backend (API endpoints)
- HTTPS domain (required for Telegram Web Apps)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/mathbot.git
   cd mathbot
   ```

2. **Configure backend API**
   - Update `API_URL` in `js/script.js`:
     ```javascript
     const API_URL = 'https://your-domain.com/math/api.php';
     ```

3. **Set up your PHP API** (`api.php`)
   Required endpoints:
   - `auth` — User authentication
   - `get_questions` — Fetch quiz questions
   - `submit_quiz` — Submit quiz results
   - `get_profile` — User stats & progress
   - `get_leaderboard` — Rankings
   - `get_chat_messages` / `send_chat_message` — Chat system
   - `save_chat_style` / `get_chat_styles` — Chat customization

4. **Deploy**
   Upload to your HTTPS-enabled hosting. Set the Mini App URL in [@BotFather](https://t.me/botfather).

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **Styling** | Tailwind CSS (CDN) |
| **Math Rendering** | KaTeX |
| **Telegram SDK** | Telegram Web App JS API |
| **Backend** | PHP (custom API) |
| **Icons** | SVG (inline) |

---

## 📁 Project Structure

```
mathbot/
├── index.html          # Main app shell
├── css/
│   └── style.css       # Custom styles & animations
├── js/
│   └── script.js       # App logic, state, API calls
├── image/              # Chat sticker images (optional)
└── README.md
```

---

## 🎮 How It Works

1. **Home** — Browse topics, start daily challenge, view streak tracker
2. **Quiz** — Answer timed questions with multiple choice
3. **Results** — View accuracy, XP earned, unlock achievements
4. **Chat** — Discuss problems with math formula support (`$x^2$`, `$$\frac{1}{2}$$`)
5. **Leaderboard** — Compete by XP or streak
6. **Profile** — Track progress, view achievements & topic mastery

---

## 🔐 Anti-Cheat System

To prevent users from closing the app to avoid bad scores:
- Quiz sessions are saved server-side immediately on start
- If abandoned, counts as 0 correct answers
- Session IDs ensure no duplicate submissions

---

## 📝 API Reference

### Authentication
```http
POST /api.php
Content-Type: application/json

{
  "action": "auth",
  "telegram_id": "123456789",
  "user": { "first_name": "John", ... }
}
```

### Submit Quiz
```http
POST /api.php
Content-Type: application/json

{
  "action": "submit_quiz",
  "telegram_id": "123456789",
  "results": {
    "topic": "Algebra",
    "correct": 4,
    "wrong": 1,
    "total": 5,
    "accuracy": 80,
    "questions": [1, 2, 3, 4, 5],
    "session_id": "abc123"
  }
}
```

---

## 🏅 Level System

| Level | Name | Min XP |
|-------|------|--------|
| 1 | Beginner | 0 |
| 2 | Learner | 100 |
| 3 | Explorer | 250 |
| 4 | Practitioner | 500 |
| 5 | Solver | 900 |
| 6 | Analyst | 1,400 |
| 7 | Expert | 2,000 |
| 8 | Master | 3,000 |
| 9 | Sage | 4,500 |
| 10 | Legend | 6,000 |

---

## 🎨 Chat Customization

Users can personalize their chat appearance:
- **Bubble Color** — 20 presets + custom color picker
- **Text Color** — 8 presets + custom color picker  
- **Sticker/Icon** — Emoji or uploaded images
- **Publish Style** — Share your style with the group

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## 📄 License

MIT License — feel free to use and modify!

---

## 🙏 Acknowledgments

- [Telegram Web Apps Platform](https://core.telegram.org/bots/webapps)
- [KaTeX](https://katex.org/) for math rendering
- [Tailwind CSS](https://tailwindcss.com/) for utility-first styling

---

<p align="center">
  Made with ❤️ for math learners everywhere
</p>
