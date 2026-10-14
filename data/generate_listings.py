#!/usr/bin/env python3
"""
Generate a grounded sample dataset of Bangkok condo rental listings.

Reads areas.csv and buildings.csv, writes listings.csv.
Prices are drawn around each area's rent-per-sqm band (from public 2026
listing medians, see SOURCES.md), adjusted by building tier and age.
About 70% of listings carry one to three deliberate flaws so the checker
has something to catch. The `flaws` column records the ground truth so the
completeness metric can be measured. (The first cut used 40% with one or two
flaws; raw drafts then averaged 98 out of 100 and the metric had nothing to show.)

Usage: python3 generate_listings.py [--n 400] [--seed 42]
"""
import argparse
import csv
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent

TIER_MULT = {"luxury": 1.22, "mid": 1.02, "budget": 0.88}
FURNISHING = ["fully furnished", "fully furnished", "fully furnished", "partly furnished", "unfurnished"]
VIEWS = ["city view", "pool view", "garden view", "river glimpse", "unblocked view", "quiet side"]
EXTRAS = ["washing machine", "bathtub", "balcony", "walk-in wardrobe", "corner unit", "high ceiling", "renovated"]

# Unit mixes by bedrooms: (bedrooms, bathrooms, size range sqm)
UNIT_TYPES = [
    (0, 1, (22, 32)),   # studio
    (1, 1, (28, 48)),
    (1, 1, (28, 48)),
    (1, 1, (28, 48)),
    (2, 1, (48, 68)),
    (2, 2, (55, 85)),
    (3, 2, (85, 140)),
]

FLAW_TYPES = [
    "missing_floor",
    "missing_photos",      # photo_count 0-3
    "short_description",
    "caps_title",
    "missing_furnishing",
    "missing_bathrooms",
    "overpriced",          # +20 to +45%
    "underpriced",         # -20 to -40%
    "typo_price",          # extra zero or missing zero
    "missing_size",
    "vague_title",
]

TH_BED = {0: "สตูดิโอ", 1: "1 ห้องนอน", 2: "2 ห้องนอน", 3: "3 ห้องนอน"}
TH_FURN = {"fully furnished": "ตกแต่งครบ", "partly furnished": "ตกแต่งบางส่วน", "unfurnished": "ห้องเปล่า"}
TH_VIEW = {"city view": "วิวเมือง", "pool view": "วิวสระ", "garden view": "วิวสวน",
           "river glimpse": "เห็นแม่น้ำ", "unblocked view": "วิวไม่บล็อก", "quiet side": "ฝั่งเงียบ"}


def bed_label(b):
    return "Studio" if b == 0 else f"{b} bed"


def make_title(b, bldg, flaws, rng):
    base = f"{bed_label(b['bedrooms'])} at {bldg['building_name']}, {b['size_sqm']} sqm, near {bldg['nearest_station']}"
    if "vague_title" in flaws:
        return rng.choice(["Nice condo for rent", "Room for rent Bangkok", "Condo good price", "For rent"])
    if "caps_title" in flaws:
        return base.upper()
    return base


def make_description(b, bldg, area, flaws, rng):
    view = rng.choice(VIEWS)
    extras = rng.sample(EXTRAS, k=rng.randint(1, 3))
    floor_txt = f"on floor {b['floor']}" if b["floor"] else "on a high floor"
    en = (
        f"{bed_label(b['bedrooms'])} unit {floor_txt} at {bldg['building_name']} in {area['area_name']}. "
        f"{b['size_sqm'] or 'Spacious'} sqm, {b['furnishing'] or 'furnished'}, {view}. "
        f"About {bldg['walk_min']} minutes' walk to {bldg['nearest_station']}. "
        f"Includes {', '.join(extras)}. Building completed {bldg['completed_year']}. "
        f"Minimum one year contract, two months deposit."
    )
    th = (
        f"{TH_BED.get(b['bedrooms'], '')} {bldg['building_name']} {area['area_name']} "
        f"ชั้น {b['floor'] or '-'} ขนาด {b['size_sqm'] or '-'} ตร.ม. {TH_FURN.get(b['furnishing'], '')} {TH_VIEW[view]} "
        f"เดิน {bldg['walk_min']} นาทีถึง {bldg['nearest_station']} สัญญา 1 ปี มัดจำ 2 เดือน"
    )
    if "short_description" in flaws:
        en = rng.choice([
            f"{bed_label(b['bedrooms'])} for rent. Call for details.",
            f"Condo at {bldg['building_name']}. Good location.",
            "Nice room, ready to move in.",
        ])
        th = rng.choice(["ห้องสวย พร้อมเข้าอยู่", f"ให้เช่า {bldg['building_name']}", "สนใจทักมา"])
    return en, th


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=400)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--flaw-rate", type=float, default=0.70)
    args = ap.parse_args()
    rng = random.Random(args.seed)

    areas = {r["area_id"]: r for r in csv.DictReader(open(HERE / "areas.csv", encoding="utf-8"))}
    buildings = list(csv.DictReader(open(HERE / "buildings.csv", encoding="utf-8")))

    rows = []
    for i in range(1, args.n + 1):
        bldg = rng.choice(buildings)
        area = areas[bldg["area_id"]]
        bedrooms, bathrooms, (lo, hi) = rng.choice(UNIT_TYPES)
        size = rng.randint(lo, hi)
        floor = rng.randint(2, 40 if bldg["tier"] != "budget" else 25)
        furnishing = rng.choice(FURNISHING)
        photos = rng.randint(6, 18)

        # Price: area typical per sqm, tier multiplier, age discount, unit-size effect, noise.
        typical = float(area["rent_sqm_typical"])
        age = 2026 - int(bldg["completed_year"])
        age_mult = max(0.85, 1 - 0.006 * age)
        size_mult = 1.08 if size < 30 else (0.94 if size > 80 else 1.0)   # small units rent dearer per sqm
        per_sqm = typical * TIER_MULT[bldg["tier"]] * age_mult * size_mult * rng.uniform(0.9, 1.1)
        per_sqm = min(max(per_sqm, float(area["rent_sqm_low"]) * 0.9), float(area["rent_sqm_high"]) * 1.1)
        rent = int(round(per_sqm * size / 500.0) * 500)

        flaws = []
        if rng.random() < args.flaw_rate:
            k = rng.randint(1, 3)
            flaws = rng.sample(FLAW_TYPES, k=k)
            if "overpriced" in flaws and "underpriced" in flaws:
                flaws.remove("underpriced")

        if "overpriced" in flaws:
            rent = int(round(rent * rng.uniform(1.20, 1.45) / 500) * 500)
        if "underpriced" in flaws:
            rent = int(round(rent * rng.uniform(0.60, 0.80) / 500) * 500)
        if "typo_price" in flaws:
            rent = rent * 10 if rng.random() < 0.5 else max(500, rent // 10)
        if "missing_floor" in flaws:
            floor = ""
        if "missing_photos" in flaws:
            photos = rng.randint(0, 3)
        if "missing_furnishing" in flaws:
            furnishing = ""
        if "missing_bathrooms" in flaws:
            bathrooms = ""
        if "missing_size" in flaws:
            size = ""

        b = dict(bedrooms=bedrooms, bathrooms=bathrooms, size_sqm=size, floor=floor, furnishing=furnishing)
        title = make_title(b, bldg, flaws, rng)
        desc_en, desc_th = make_description(b, bldg, area, flaws, rng)

        rows.append({
            "listing_id": f"L{i:04d}",
            "building_id": bldg["building_id"],
            "area_id": area["area_id"],
            "title": title,
            "description_en": desc_en,
            "description_th": desc_th,
            "bedrooms": bedrooms,
            "bathrooms": bathrooms,
            "size_sqm": size,
            "floor": floor,
            "monthly_rent_thb": rent,
            "furnishing": furnishing,
            "photo_count": photos,
            "nearest_station": bldg["nearest_station"],
            "listed_date": f"2026-{rng.randint(6, 10):02d}-{rng.randint(1, 28):02d}",
            "status": rng.choice(["active"] * 8 + ["let"] * 2),
            "flaws": ";".join(flaws),
        })

    out = HERE / "listings.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    flawed = sum(1 for r in rows if r["flaws"])
    print(f"Wrote {len(rows)} listings to {out} ({flawed} with flaws, {flawed/len(rows):.0%})")


if __name__ == "__main__":
    main()
