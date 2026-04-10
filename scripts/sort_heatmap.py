#!/usr/bin/env python3
import csv

INPUT = "..data/heatmap.csv"
OUTPUT = "..data/heatmap_sorted.csv"

with open(INPUT, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = list(reader)
    fieldnames = reader.fieldnames

rows.sort(key=lambda r: r["leto_mesec"])

with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print(f"Razvrščeno {len(rows)} vrstic -> {OUTPUT}")