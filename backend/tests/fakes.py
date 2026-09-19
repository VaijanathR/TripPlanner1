"""Canned upstream responses, so destination tests never touch the network."""

import upstream


class FakeUpstream:
    """Stands in for upstream.get_json. Register an answer (a value to return, or
    an exception to raise) per URL prefix; the longest matching prefix wins.
    A registered *list* is consumed one item per call (last one repeats)."""

    def __init__(self):
        self.routes: dict[str, object] = {}
        self.calls: list[tuple[str, dict | None]] = []
        self.exact: set[str] = set()

    def on(self, url_prefix: str, answer, exact: bool = False):
        """`exact=True` matches only that full URL (Wikipedia pages: "Georgia"
        must not also answer for "Georgia_Prefecture")."""
        self.routes[url_prefix] = answer
        if exact:
            self.exact.add(url_prefix)
        return self

    def __call__(self, url, params=None, timeout=8.0):
        self.calls.append((url, params))
        matches = [p for p in self.routes if (url == p if p in self.exact else url.startswith(p))]
        if not matches:
            raise upstream.UpstreamError(f"no fake registered for {url}")
        answer = self.routes[max(matches, key=len)]
        if isinstance(answer, list):
            answer = answer.pop(0) if len(answer) > 1 else answer[0]
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(url, params)
        return answer

    def calls_to(self, url_prefix: str) -> list:
        return [c for c in self.calls if c[0].startswith(url_prefix)]


def geocode_result(id, name, admin1, country, code, lat, lon, population=None):
    return {
        "id": id, "name": name, "admin1": admin1, "country": country, "country_code": code,
        "latitude": lat, "longitude": lon, "population": population,
    }


def sparql_row(item, name, sitelinks, dist, type_qid, type_label, image=None, description=None,
               lon=135.75, lat=35.02):
    row = {
        "item": {"value": f"http://www.wikidata.org/entity/{item}"},
        "itemLabel": {"value": name},
        "sitelinks": {"value": str(sitelinks)},
        "dist": {"value": str(dist)},
        "coord": {"value": f"Point({lon} {lat})"},
        "type": {"value": f"http://www.wikidata.org/entity/{type_qid}"},
        "typeLabel": {"value": type_label},
    }
    if image:
        row["image"] = {"value": f"http://commons.wikimedia.org/wiki/Special:FilePath/{image}"}
    if description:
        row["itemDescription"] = {"value": description}
    return row


def sparql_response(*rows):
    return {"results": {"bindings": list(rows)}}


def summary(title, description="City in Japan", image="https://upload.wikimedia.org/x/thumb/a/ab/Kyoto.jpg/330px-Kyoto.jpg",
            lat=35.02, lon=135.75, type="standard", original_width=3000):
    body = {
        "type": type, "title": title, "description": description, "extract": f"{title} is a place.",
        "content_urls": {"desktop": {"page": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"}},
    }
    if image:
        body["thumbnail"] = {"source": image, "width": 330, "height": 220}
        body["originalimage"] = {"source": image.replace("/thumb/", "/").rsplit("/", 1)[0], "width": original_width, "height": 2000}
    if lat is not None:
        body["coordinates"] = {"lat": lat, "lon": lon}
    return body
