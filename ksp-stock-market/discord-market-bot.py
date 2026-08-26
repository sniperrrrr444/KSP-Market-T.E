"""KSP Market T/E Discord market processor.

Only new Discord messages can affect the fictional market. A message must
match a listed company's configured name, alias, keyword, related person, or
be authored by a configured related Discord member. The matched message is
then scored using local context, phrases, negation and intensifiers.
Processed message IDs are persisted so reruns are idempotent.
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
MAX_HISTORY_PAGES = 5

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
    "secured": 1.0, "raises": 0.8, "raised": 0.8,
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


def discord_request(url):
    req = Request(url, headers={
        "Authorization": f"Bot {TOKEN}",
        "User-Agent": "KSP-Market-TE/5.0",
    })
    try:
        with urlopen(req, timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        if exc.code == 401:
            raise RuntimeError("Discord 401: token inválido o revocado.") from exc
        if exc.code == 403:
            raise RuntimeError("Discord 403: el bot no puede leer el canal. Necesita Ver canal + Leer historial de mensajes y acceso al servidor.") from exc
        if exc.code == 404:
            raise RuntimeError("Discord 404: canal inexistente o inaccesible para el bot.") from exc
        raise RuntimeError(f"Discord HTTP {exc.code}: error leyendo el canal.") from exc
    except URLError as exc:
        raise RuntimeError(f"Discord no disponible: {exc.reason}") from exc


def discord_messages(processed):
    messages = []
    before = None
    for _ in range(MAX_HISTORY_PAGES):
        url = f"https://discord.com/api/v10/channels/{CHANNEL_ID}/messages?limit=100"
        if before:
            url += f"&before={before}"
        page = discord_request(url)
        if not page:
            break
        messages.extend(page)
        if any(str(item.get("id", "")) in processed for item in page):
            break
        if len(page) < 100:
            break
        before = page[-1].get("id")
    return messages


def company_terms(company):
    terms = {
        company.get("ticker", ""), company.get("name", ""),
        *company.get("keywords", []), *company.get("aliases", []),
        *company.get("people", []),
    }
    return [normalise(str(term)) for term in terms if str(term).strip()]


def author_terms(message):
    author = message.get("author", {}) or {}
    return {
        normalise(str(author.get("username", ""))),
        normalise(str(author.get("global_name", ""))),
        normalise(str(author.get("display_name", ""))),
    } - {""}


def message_matches_company(text, message, company):
    clean = normalise(text)
    padded = f" {clean} "
    content_matches = [term for term in company_terms(company) if term and f" {term} " in padded]
    configured_members = [normalise(str(item)) for item in company.get("relatedMembers", []) if str(item).strip()]
    member_matches = [term for term in configured_members if term in author_terms(message)]
    return content_matches + [f"member:{term}" for term in member_matches]


def sentiment_score(text):
    clean = normalise(text)
    words = clean.split()
    score = 0.0
    padded = f" {clean} "
    for phrase, value in POSITIVE_PHRASES.items():
        if f" {phrase} " in padded:
            score += value
    for phrase, value in NEGATIVE_PHRASES.items():
        if f" {phrase} " in padded:
            score += value
    for index, word in enumerate(words):
        value = POSITIVE.get(word, NEGATIVE.get(word, 0.0))
        if not value:
            continue
        context = words[max(0, index - 4):index]
        if any(item in NEGATORS for item in context):
            value *= -1
        multiplier = max([1.0] + [INTENSIFIERS[item] for item in context if item in INTENSIFIERS])
        score += value * multiplier
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
    processed = {str(item) for item in data["processedMessageIds"]}
    messages = sorted(discord_messages(processed), key=lambda item: item.get("timestamp", ""))
    new_processed, relevant_news, market_scores = [], [], []

    for msg in messages:
        message_id = str(msg.get("id", ""))
        if not message_id or message_id in processed:
            continue
        new_processed.append(message_id)
        content = msg.get("content", "").strip()
        if not content:
            continue

        matched_companies = []
        for company in data["companies"]:
            matches = message_matches_company(content, msg, company)
            if matches:
                matched_companies.append((company, matches))
        if not matched_companies:
            continue

        explicit_ticker, explicit_pct = explicit_change(content)
        for company, matches in matched_companies:
            ticker = company["ticker"].upper()
            score = sentiment_score(content)
            pct = round(score * 5.0, 2)
            if explicit_ticker == ticker and explicit_pct is not None:
                pct = max(-15.0, min(15.0, explicit_pct))
            signal = "UP" if pct > 0 else "DOWN" if pct < 0 else "NEUTRAL"
            if pct:
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

    data["processedMessageIds"] = (data["processedMessageIds"] + new_processed)[-5000:]
    data["news"] = (relevant_news + data.get("news", []))[:100]
    if market_scores:
        data["marketSentiment"] = round(sum(market_scores) / len(market_scores), 3)
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    with open(DATA_FILE, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(f"OK: {len(new_processed)} mensajes nuevos; {len(relevant_news)} eventos de mercado.")


if __name__ == "__main__":
    main()
