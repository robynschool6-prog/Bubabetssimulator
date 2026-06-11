# OddsLab — Betslip & Odds Simulator

**Simulation only — no real money betting.** Demo credits have no value. No deposits, no withdrawals. Educational/demo use only.

Live odds come from [The Odds API](https://the-odds-api.com) (free tier available). Your API key stays on the server in a `.env` file and is never sent to the browser.

## Setup

1. **Install dependencies** (requires Node.js 18+):
   ```bash
   cd oddslab-simulator
   npm install
   ```

2. **Add your API key:**
   - Get a free key from https://the-odds-api.com (they email it to you).
   - Copy the example env file:
     ```bash
     cp .env.example .env
     ```
   - Open `.env` in any text editor and replace the placeholder:
     ```
     ODDS_API_KEY=paste_your_real_key_here
     ```
   - Do not share this key, paste it into chats, or commit `.env` to git.

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open the app:** go to http://localhost:3000 in your browser.

## Notes

- Odds responses are cached server-side for 5 minutes to protect your monthly request quota (free tier = 500 requests/month; each sport load costs ~3 market-credits).
- Simulated bets and your fake balance live in your browser's localStorage only. "Reset demo account" restores 1,000 credits and clears history.
- Click the balance pill in the header to set any fake balance you like.
- If a sport shows "No upcoming events", that league may be out of season — try another tab.
- To change which leagues appear, edit the `SPORTS` array at the top of `server.js` (any sport key from `GET /v4/sports` works).
