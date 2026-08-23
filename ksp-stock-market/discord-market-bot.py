"""KSP Market T/E daily market updater.

Reads the latest messages from a Discord channel using a bot token stored in
DISCORD_BOT_TOKEN. Messages can contain a ticker, a manual percentage and/or
news. Example:

KD +6% | Kerbin Dynamics successfully tested a new engine.
KD -4% | Launch delay after a fuel leak.

If no explicit percentage is present, a small sentiment score is derived from
news keywords. This is deliberately a fictional-market simulator, not financial advice.
"""
import json, os, re
from datetime import datetime, timezone
from urllib.request import Request, urlopen

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
CHANNEL_ID = os.environ["DISCORD_CHANNEL_ID"]
DATA_FILE = "ksp-stock-market/market-data.json"

POSITIVE = {"success", "successful", "profit", "profits", "contract", "record", "launch", "launched", "discovery", "upgrade", "approved", "victory", "expansion", "growth", "engine", "mission"}
NEGATIVE = {"failure", "failed", "loss", "losses", "delay", "delayed", "crash", "explosion", "leak", "cancelled", "cancel", "debt", "warning", "problem", "accident", "damage", "shortage"}


def discord_messages():
    url = f"https://discord.com/api/v10/channels/{CHANNEL_ID}/messages?limit=50"
    req = Request(url, headers={"Authorization": f"Bot {TOKEN}", "User-Agent": "KSP-Market-TE/1.0"})
    with urlopen(req, timeout=20) as r:
        return json.load(r)


def analyse(text):
    explicit = re.search(r"([A-Z]{2,6})\s*([+-]\d+(?:\.\d+)?)\s*%", text.upper())
    words = set(re.findall(r"[a-záéíóúñ]+", text.lower()))
    score = min(1, max(-1, (len(words & POSITIVE) - len(words & NEGATIVE)) / 4))
    return explicit, score


def main():
    with open(DATA_FILE, encoding="utf-8") as f:
        data = json.load(f)
    messages = discord_messages()
    company_map = {c["ticker"]: c for c in data["companies"]}
    news = []
    market_scores = []
    for msg in messages:
        content = msg.get("content", "").strip()
        if not content:
            continue
        explicit, score = analyse(content)
        if explicit:
            ticker, pct = explicit.group(1), float(explicit.group(2))
            if ticker in company_map:
                company_map[ticker]["dailyChange"] = pct
                company_map[ticker]["signal"] = "UP" if pct > 0 else "DOWN" if pct < 0 else "NEUTRAL"
                company_map[ticker]["previousClose"] = company_map[ticker]["price"]
                company_map[ticker]["price"] = round(max(1, company_map[ticker]["price"] * (1 + pct / 100)), 2)
                market_scores.append(pct / 10)
        elif content:
            market_scores.append(score)
        news.append({"author": msg.get("author", {}).get("username", "Discord"), "text": content[:500], "date": msg.get("timestamp")})
    data["news"] = news[:12]
    data["marketSentiment"] = round(sum(market_scores) / len(market_scores), 3) if market_scores else 0
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
