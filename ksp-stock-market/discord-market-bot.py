"""KSP Market T/E Discord market processor.

Only NEW Discord messages are considered. A message is ignored unless it
contains a configured word/alias or person associated with a listed company.
The sentiment/impact is then inferred from the message context. Explicit
percentages are supported as an optional override when they are attached to a
company ticker.

Processed Discord message IDs are persisted in market-data.json so a message
can never move the same company twice just because the workflow runs again.
This is a fictional-market simulator, not financial advice.
"""
import json
import os
import re
from datetime import datetime, timezone
from urllib.request import Request, urlopen

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
CHANNEL_ID = os.environ["DISCORD_CHANNEL_ID"]
DATA_FILE = "ksp-stock-market/market-data.json"

# These are intentionally conservative. Add company-specific words/persons to
# market-data.json rather than making generic words move every company.
POSITIVE = {
    "success", "successful", "profit", "profits", "contract", "record",
    "launch", "launched", "discovery", "upgrade", "approved", "victory",
    "expansion", "growth", "mission", "breakthrough", "award", "deal",
    "funding", "investment", "improved", "improvement", "safe", "safely",
    "milestone", "innovation", "innovative", "won", "wins", "positive",
}
NEGATIVE = {
    "failure", "failed", "loss", "losses", "delay", "delayed", "crash",
    "explosion", "leak", "cancelled", "cancel", "debt", "warning",
    "problem", "accident", "damage", "shortage", "lawsuit", "scandal",
    "recall", "lost", "loss", "negative", "unsafe", "fire", "broken",
}
INTENSIFIERS = {"major", "huge", "massive", "severe", "critical", "historic", "record"}
NEGATORS = {"not", "never", "without", "no", "failed", "failure"}


def discord_messages():
    url = f"https://discord.com/api/v10/channels/{CHANNEL_ID}/messages?limit=100"
    req = Request(
        url,
        headers={
            "Authorization": f"Bot {TOKEN}",
            "User-Agent": "KSP-Market-TE/2.0",
        },
    )
    with urlopen(req, timeout=20) as response:
        return json.load(response)


def normalise(text):
    return re.sub(r"[^a-z0-9áéíóúüñ]+", " ", text.lower()).strip()


def company_terms(company):
    """Return configured company words, aliases and people."""
    terms = {
        company.get("ticker", ""),
        company.get("name", ""),
        company.get("sector", ""),
        *company.get("keywords", []),
        *company.get("aliases", []),
        *company.get("people", []),
    }
    return [normalise(str(term)) for term in terms if str(term).strip()]


def message_matches_company(text, company):
    """Match a whole configured term, not an arbitrary substring."""
    clean = normalise(text)
    padded = f" {clean} "
    for term in company_terms(company):
        if not term:
            continue
        if f" {term} " in padded:
            return True, term
    return False, None


def sentiment_score(text):
    """Estimate sentiment from local context around positive/negative words."""
    clean = normalise(text)
    words = clean.split()
    score = 0.0

    for index, word in enumerate(words):
        value = 0
        if word in POSITIVE:
            value = 1
        elif word in NEGATIVE:
            value = -1
        if not value:
            continue

        context = words[max(0, index - 3):index]
        if any(w in NEGATORS for w in context):
            value *= -1
        if any(w in INTENSIFIERS for w in context):
            value *= 1.5
        score += value

    # One message should normally move the fictional market by a modest amount.
    # Strong context can reach roughly +/-5%; neutral context produces no move.
    return max(-1.0, min(1.0, score / 3.0))


def explicit_change(text):
    match = re.search(r"\b([A-Z]{2,8})\s*([+-]\d+(?:\.\d+)?)\s*%", text.upper())
    return (match.group(1), float(match.group(2))) if match else (None, None)


def apply_company_change(company, pct):
    old_price = float(company["price"])
    if "previousClose" not in company:
        company["previousClose"] = old_price

    company["price"] = round(max(0.01, old_price * (1 + pct / 100)), 2)
    opening = float(company.get("previousClose", old_price))
    company["dailyChange"] = round(((company["price"] / opening) - 1) * 100, 2) if opening else 0
    company["signal"] = "UP" if pct > 0 else "DOWN" if pct < 0 else "NEUTRAL"
    company["lastEventAt"] = datetime.now(timezone.utc).isoformat()


def main():
    with open(DATA_FILE, encoding="utf-8") as file:
        data = json.load(file)

    data.setdefault("processedMessageIds", [])
    data.setdefault("news", [])
    data.setdefault("companies", [])

    messages = discord_messages()
    company_map = {company["ticker"].upper(): company for company in data["companies"]}
    processed = set(str(message_id) for message_id in data["processedMessageIds"])
    new_processed = []
    relevant_news = []
    market_scores = []

    # Discord returns newest first. Process oldest -> newest so a sequence of
    # messages produces deterministic price changes.
    messages = sorted(messages, key=lambda item: item.get("timestamp", ""))

    for msg in messages:
        message_id = str(msg.get("id", ""))
        if not message_id or message_id in processed:
            continue

        content = msg.get("content", "").strip()
        new_processed.append(message_id)
        if not content:
            continue

        matched = []
        for company in data["companies"]:
            is_match, matched_term = message_matches_company(content, company)
            if is_match:
                matched.append((company, matched_term))

        # Completely unrelated Discord messages do nothing to the market.
        if not matched:
            continue

        explicit_ticker, explicit_pct = explicit_change(content)
        for company, matched_term in matched:
            ticker = company["ticker"].upper()

            if explicit_ticker == ticker:
                pct = max(-15.0, min(15.0, explicit_pct))
            else:
                score = sentiment_score(content)
                pct = round(score * 5.0, 2)

            if pct == 0:
                signal = "NEUTRAL"
            else:
                signal = "UP" if pct > 0 else "DOWN"
                apply_company_change(company, pct)
                market_scores.append(pct / 5.0)

            relevant_news.append({
                "id": message_id,
                "ticker": ticker,
                "company": company.get("name", ticker),
                "matchedTerm": matched_term,
                "author": msg.get("author", {}).get("username", "Discord"),
                "text": content[:500],
                "date": msg.get("timestamp"),
                "impact": pct,
                "signal": signal,
            })

    # Keep a bounded audit trail. IDs are the source of truth for deduplication.
    data["processedMessageIds"] = (data["processedMessageIds"] + new_processed)[-5000:]
    data["news"] = (relevant_news + data.get("news", []))[:50]
    if market_scores:
        data["marketSentiment"] = round(sum(market_scores) / len(market_scores), 3)
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()

    with open(DATA_FILE, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")


if __name__ == "__main__":
    main()
