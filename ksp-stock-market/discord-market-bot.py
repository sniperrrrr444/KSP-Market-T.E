"""KSP Market T/E Discord market processor.

The processor is intentionally event-driven: only new Discord messages are
considered, and a message can affect the market only when it matches a listed
company's configured name, alias, keyword or related person. Sentiment is
estimated from the context of the matched message rather than from a simple
positive/negative word count.

Processed message IDs are persisted in market-data.json, so rerunning the
workflow cannot apply the same Discord event twice.
"""
import json
import os
import re
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
CHANNEL_ID = os.environ["DISCORD_CHANNEL_ID"]
DATA_FILE = "ksp-stock-market/market-data.json"

# Context vocabulary. These are deliberately broader than the old list, but
# the words only matter AFTER a company has been matched.
POSITIVE = {
    "success": 1.0, "successful": 1.0, "profit": 1.0, "profits": 1.0,
    "contract": 1.2, "record": 1.1, "launch": 0.8, "launched": 1.0,
    "discovery": 1.0, "upgrade": 0.7, "approved": 1.0, "approval": 1.0,
    "victory": 1.0, "expansion": 0.8, "growth": 0.9, "mission": 0.3,
    "breakthrough": 1.4, "award": 0.9, "deal": 0.9, "funding": 0.8,
    "investment": 0.7, "improved": 0.8, "improvement": 0.8, "safe": 0.8,
    "safely": 0.8, "milestone": 0.9, "innovation": 1.0, "innovative": 1.0,
    "won": 1.1, "wins": 1.1, "positive": 0.8, "surpasses": 1.2,
    "surpassed": 1.2, "beats": 1.0, "beaten": 0.8, "record-breaking": 1.4,
    "successful": 1.0, "secured": 1.0, "raises": 0.8, "raised": 0.8,
}

NEGATIVE = {
    "failure": -1.1, "failed": -1.1, "loss": -1.0, "losses": -1.0,
    "delay": -0.8, "delayed": -0.9, "crash": -1.5, "explosion": -1.7,
    "leak": -1.0, "leaked": -1.0, "cancelled": -1.2, "cancel": -1.1,
    "debt": -0.8, "warning": -0.6, "problem": -0.7, "accident": -1.1,
    "damage": -1.0, "shortage": -0.8, "lawsuit": -1.0, "scandal": -1.4,
    "recall": -1.0, "lost": -0.9, "negative": -0.8, "unsafe": -1.2,
    "fire": -1.3, "broken": -1.0, "bankrupt": -2.0, "bankruptcy": -2.0,
    "resigns": -0.8, "resigned": -0.8, "investigation": -0.8,
    "breach": -1.2, "stolen": -1.3, "downgrade": -0.8, "downgraded": -0.9,
    "misses": -1.0, "missed": -1.0, "fails": -1.1,
}

INTENSIFIERS = {
    "very": 1.25, "major": 1.35, "huge": 1.4, "massive": 1.5,
    "severe": 1.5, "critical": 1.6, "historic": 1.35, "record": 1.3,
    "extremely": 1.6, "significant": 1.25, "worst": 1.45,
}
NEGATORS = {"not", "never", "without", "no", "neither", "hardly", "barely"}

# Event phrases carry more meaning than isolated words.
POSITIVE_PHRASES = {
    "new contract": 1.5, "record profit": 1.7, "successful launch": 1.7,
    "mission success": 1.7, "new funding": 1.2, "wins contract": 1.6,
    "secures contract": 1.7, "beats expectations": 1.6,
    "passes test": 1.3, "passes tests": 1.3, "sets record": 1.6,
}
NEGATIVE_PHRASES = {
    "launch failure": -2.0, "failed launch": -2.0, "engine failure": -1.9,
    "major delay": -1.5, "project cancelled": -1.8, "contract cancelled": -1.8,
    "stock crash": -2.0, "data breach": -1.7, "lawsuit filed": -1.4,
    "fuel leak": -1.5, "mission failure": -2.0,
}


def normalise(text):
    text = text.lower().replace("%", " percent ")
    text = re.sub(r"[^a-z0-9áéíóúüñ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def discord_messages():
    """Read recent messages and turn Discord permission errors into useful logs."""
    url = f"https://discord.com/api/v10/channels/{CHANNEL_ID}/messages?limit=100"
    req = Request(
        url,
        headers={
            "Authorization": f"Bot {TOKEN}",
            "User-Agent": "KSP-Market-TE/3.0",
        },
    )
    try:
        with urlopen(req, timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        if exc.code == 401:
            raise RuntimeError("Discord 401: el token del bot es inválido o fue revocado.") from exc
        if exc.code == 403:
            raise RuntimeError(
                "Discord 403: el bot no tiene permiso para leer este canal. "
                "Necesita Ver canal + Leer historial de mensajes y debe estar en el servidor."
            ) from exc
        if exc.code == 404:
            raise RuntimeError("Discord 404: el canal no existe o el bot no puede acceder a él.") from exc
        raise RuntimeError(f"Discord HTTP {exc.code}: no se pudieron leer los mensajes.") from exc
    except URLError as exc:
        raise RuntimeError(f"Discord no está disponible: {exc.reason}") from exc


def company_terms(company):
    terms = {
        company.get("ticker", ""),
        company.get("name", ""),
        *company.get("keywords", []),
        *company.get("aliases", []),
        *company.get("people", []),
    }
    return [normalise(str(term)) for term in terms if str(term).strip()]


def message_matches_company(text, company):
    """Match configured entities as whole words/phrases, never substrings."""
    clean = normalise(text)
    padded = f" {clean} "
    matches = []
    for term in company_terms(company):
        if term and f" {term} " in padded:
            matches.append(term)
    return matches


def sentiment_score(text):
    """Score the whole message with local context, phrases and negation."""
    clean = normalise(text)
    words = clean.split()
    score = 0.0

    for phrase, value in POSITIVE_PHRASES.items():
        if f" {phrase} " in f" {clean} ":
            score += value
    for phrase, value in NEGATIVE_PHRASES.items():
        if f" {phrase} " in f" {clean} ":
            score += value

    for index, word in enumerate(words):
        value = POSITIVE.get(word, NEGATIVE.get(word, 0.0))
        if not value:
            continue

        context = words[max(0, index - 4):index]
        if any(item in NEGATORS for item in context):
            value *= -1

        multiplier = 1.0
        for item in context:
            if item in INTENSIFIERS:
                multiplier = max(multiplier, INTENSIFIERS[item])
        score += value * multiplier

    # Avoid letting a long message with many repeated adjectives become an
    # absurd market shock. The final value is converted to a max +/-5% move.
    return max(-1.0, min(1.0, score / 5.0))


def explicit_change(text):
    match = re.search(r"\b([A-Z]{2,8})\s*([+-]\d+(?:\.\d+)?)\s*%", text.upper())
    return (match.group(1), float(match.group(2))) if match else (None, None)


def apply_company_change(company, pct):
    old_price = float(company.get("price", 0.01))
    company["previousPrice"] = old_price
    company["price"] = round(max(0.01, old_price * (1 + pct / 100)), 2)
    company["lastChange"] = round(pct, 2)
    company["dailyChange"] = round(float(company.get("dailyChange", 0)) + pct, 2)
    company["signal"] = "UP" if pct > 0 else "DOWN" if pct < 0 else "NEUTRAL"
    company["lastEventAt"] = datetime.now(timezone.utc).isoformat()


def main():
    with open(DATA_FILE, encoding="utf-8") as file:
        data = json.load(file)

    data.setdefault("processedMessageIds", [])
    data.setdefault("news", [])
    data.setdefault("companies", [])

    messages = discord_messages()
    processed = {str(message_id) for message_id in data["processedMessageIds"]}
    new_processed = []
    relevant_news = []
    market_scores = []

    # Discord returns newest first. Oldest-first makes multiple new messages
    # deterministic and means the later event sees the earlier price.
    messages = sorted(messages, key=lambda item: item.get("timestamp", ""))

    for msg in messages:
        message_id = str(msg.get("id", ""))
        if not message_id or message_id in processed:
            continue

        # Mark every new message as seen, even if unrelated. This prevents an
        # irrelevant message from being reconsidered forever.
        new_processed.append(message_id)
        content = msg.get("content", "").strip()
        if not content:
            continue

        matched_companies = []
        for company in data["companies"]:
            matches = message_matches_company(content, company)
            if matches:
                matched_companies.append((company, matches))

        # No company/entity match = zero market impact and no news event.
        if not matched_companies:
            continue

        explicit_ticker, explicit_pct = explicit_change(content)
        for company, matches in matched_companies:
            ticker = company["ticker"].upper()
            score = sentiment_score(content)
            pct = round(score * 5.0, 2)

            # Explicit ticker percentages are supported but bounded so a bad
            # Discord message cannot instantly destroy a fictional company.
            if explicit_ticker == ticker and explicit_pct is not None:
                pct = max(-15.0, min(15.0, explicit_pct))

            signal = "UP" if pct > 0 else "DOWN" if pct < 0 else "NEUTRAL"
            if pct != 0:
                apply_company_change(company, pct)
                market_scores.append(score)

            relevant_news.append({
                "id": message_id,
                "ticker": ticker,
                "company": company.get("name", ticker),
                "matchedTerms": matches[:5],
                "author": msg.get("author", {}).get("username", "Discord"),
                "text": content[:500],
                "date": msg.get("timestamp"),
                "impact": pct,
                "signal": signal,
            })

    # Keep persistent state bounded while retaining enough history to prevent
    # duplicate processing across many daily runs.
    data["processedMessageIds"] = (data["processedMessageIds"] + new_processed)[-5000:]
    data["news"] = (relevant_news + data.get("news", []))[:100]
    if market_scores:
        data["marketSentiment"] = round(sum(market_scores) / len(market_scores), 3)
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()

    with open(DATA_FILE, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")

    print(f"Processed {len(new_processed)} new Discord messages; {len(relevant_news)} relevant market events.")


if __name__ == "__main__":
    main()
