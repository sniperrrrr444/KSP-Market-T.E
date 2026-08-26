"""Ensure configured KSP Market T/E companies exist in market-data.json."""
import json
from pathlib import Path

DATA_FILE = Path("ksp-stock-market/market-data.json")

COMPANIES = [
    {
        "ticker": "KD",
        "name": "Kerbin Dynamics",
        "description": "Fabricación aeroespacial de Kerbin. Empresa ficticia de prueba.",
        "sector": "Aeroespacial",
        "price": 125.40,
        "previousPrice": 125.40,
        "dailyChange": 0,
        "signal": "NEUTRAL",
        "keywords": ["Kerbin Dynamics", "Kerbin", "Dynamics", "aeroespacial"],
        "aliases": ["KD"],
        "people": [],
        "relatedMembers": [],
        "history": [118, 119, 117, 121, 120, 122, 124, 123, 125, 124, 126, 125.4],
    },
    {
        "ticker": "JSA",
        "name": "JS Aerospace",
        "description": "Compañía aeroespacial de Kerbin centrada en vehículos, estaciones y tecnología espacial.",
        "sector": "Aeroespacial",
        "price": 100.00,
        "previousPrice": 100.00,
        "dailyChange": 0,
        "signal": "NEUTRAL",
        "keywords": ["JS Aerospace", "J.S. Aerospace", "JSA", "aerospace", "aeroespacial"],
        "aliases": ["JSA", "JS Aerospace", "J.S. Aerospace"],
        "people": [],
        "relatedMembers": ["Agus"],
        "history": [100, 100, 100, 100, 100, 100, 100],
    },
]

with DATA_FILE.open(encoding="utf-8") as f:
    data = json.load(f)

companies = data.setdefault("companies", [])
by_ticker = {str(c.get("ticker", "")).upper(): c for c in companies}
changed = False

for configured in COMPANIES:
    existing = by_ticker.get(configured["ticker"])
    if existing is None:
        companies.append(configured)
        changed = True
        print(f"Added company {configured['ticker']}: {configured['name']}")
        continue
    for key, value in configured.items():
        if key in {"price", "previousPrice", "dailyChange", "signal", "history"}:
            continue
        if existing.get(key) != value:
            existing[key] = value
            changed = True

if changed:
    data["companies"] = companies
    with DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
else:
    print("Company configuration already up to date.")
