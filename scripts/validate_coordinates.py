#!/usr/bin/env python3
"""Validate bundled listing and neighborhood coordinates against Greek land."""

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_map_data():
    source = (ROOT / "data" / "map-data.js").read_text(encoding="utf-8")
    match = re.search(r"window\.MYHOME_MAP_DATA\s*=\s*(\{[\s\S]*\})\s*;\s*$", source)
    if not match:
        raise ValueError("Could not parse data/map-data.js.")
    return json.loads(match.group(1))


def point_on_segment(x, y, start, end):
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return abs(x - start[0]) <= 1e-9 and abs(y - start[1]) <= 1e-9
    cross = (x - start[0]) * dy - (y - start[1]) * dx
    if abs(cross) > 1e-9:
        return False
    dot = (x - start[0]) * dx + (y - start[1]) * dy
    return -1e-9 <= dot <= dx * dx + dy * dy + 1e-9


def point_in_ring(x, y, ring):
    inside = False
    previous = ring[-1]
    for current in ring:
        if point_on_segment(x, y, previous, current):
            return True
        if (current[1] > y) != (previous[1] > y):
            crossing_x = (previous[0] - current[0]) * (y - current[1]) / (previous[1] - current[1]) + current[0]
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def point_in_polygon(x, y, polygon):
    return point_in_ring(x, y, polygon[0]) and not any(
        point_in_ring(x, y, hole) for hole in polygon[1:]
    )


def point_on_greek_land(geometry, latitude, longitude):
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return False
    coordinates = geometry["coordinates"]
    polygons = coordinates if geometry["type"] == "MultiPolygon" else [coordinates]
    return any(point_in_polygon(longitude, latitude, polygon) for polygon in polygons)


def main():
    map_data = load_map_data()
    land = map_data["land"]["geometry"]
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    listing_source = index_html.split("const greekListings = [", 1)[1].split("];", 1)[0]
    listing_coordinates = re.findall(
        r"\blat:\s*(-?\d+(?:\.\d+)?),\s*lng:\s*(-?\d+(?:\.\d+)?)",
        listing_source,
    )
    if not listing_coordinates:
        raise ValueError("No seed listing coordinates found in index.html.")
    points = [
        (f"listing {index + 1}", float(latitude), float(longitude))
        for index, (latitude, longitude) in enumerate(listing_coordinates)
    ]
    points.extend(
        (f"neighborhood {item['name']}", item["lat"], item["lng"])
        for item in map_data.get("neighborhoods", [])
    )

    invalid = []
    for name, latitude, longitude in points:
        if not point_on_greek_land(land, latitude, longitude):
            invalid.append((name, latitude, longitude))
    if invalid:
        for name, latitude, longitude in invalid:
            print(f"FAIL {name}: ({latitude}, {longitude}) is not on Greek land", file=sys.stderr)
        return 1
    print(f"Validated {len(points)} listing and neighborhood coordinates against the Greece land polygon.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
