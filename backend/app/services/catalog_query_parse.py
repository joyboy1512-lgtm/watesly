"""Parse customer product requests into type / attribute / size / quantity parts."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.services.bilingual_lexicon import ATTRIBUTE_ROOTS, TYPE_ROOTS
from app.services.internal_ai import (
    _TOKEN_SPLIT,
    _strip_al_prefix,
    lexicon_canonical_map,
    normalize_text,
    tokenize,
)

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

_SIZE_RE = re.compile(
    r"(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>ml|مل|l|لتر|liter|litre|gm|grams?|g|جم|جرام|kg|كغ|كيلو)",
    re.IGNORECASE,
)

_QTY_WORDS: dict[str, int] = {
    "حبه": 1,
    "حبة": 1,
    "واحد": 1,
    "واحدة": 1,
    "قطعه": 1,
    "قطعة": 1,
    "one": 1,
    "حبتين": 2,
    "حبتان": 2,
    "ثنين": 2,
    "اثنين": 2,
    "اتنين": 2,
    "قطعتين": 2,
    "two": 2,
    "ثلاث": 3,
    "ثلاثه": 3,
    "ثلاثة": 3,
    "ثلاثهحبات": 3,
    "ثلاثحبات": 3,
    "three": 3,
    "اربع": 4,
    "اربعة": 4,
    "أربع": 4,
    "أربعة": 4,
    "four": 4,
    "خمس": 5,
    "خمسة": 5,
    "five": 5,
}

_UNIT_CANON = {
    "ml": "ml",
    "مل": "ml",
    "l": "l",
    "لتر": "l",
    "liter": "l",
    "litre": "l",
    "g": "g",
    "gm": "g",
    "gram": "g",
    "grams": "g",
    "جم": "g",
    "جرام": "g",
    "kg": "kg",
    "كغ": "kg",
    "كيلو": "kg",
}


@dataclass
class SizeSpec:
    value: float
    unit: str  # ml | g | l | kg

    def matches(self, other: "SizeSpec | None", *, tolerance: float = 0.01) -> bool:
        if other is None:
            return False
        if self.unit != other.unit:
            # 400ml vs 0.4l
            self_ml = _to_ml_or_g(self)
            other_ml = _to_ml_or_g(other)
            if self_ml is None or other_ml is None:
                return False
            return abs(self_ml[0] - other_ml[0]) <= tolerance and self_ml[1] == other_ml[1]
        return abs(self.value - other.value) <= tolerance


def _to_ml_or_g(size: SizeSpec) -> tuple[float, str] | None:
    if size.unit == "ml":
        return size.value, "ml"
    if size.unit == "l":
        return size.value * 1000.0, "ml"
    if size.unit == "g":
        return size.value, "g"
    if size.unit == "kg":
        return size.value * 1000.0, "g"
    return None


@dataclass
class ParsedProductQuery:
    raw: str
    tokens: set[str] = field(default_factory=set)
    types: set[str] = field(default_factory=set)
    attributes: set[str] = field(default_factory=set)
    size: SizeSpec | None = None
    quantity: int | None = None
    # set = replace cart qty ("خلّهم ثلاث"); add = increment ("زيد ثلاث")
    quantity_mode: str | None = None
    residual_tokens: set[str] = field(default_factory=set)


def arabic_western_digits(text: str) -> str:
    return (text or "").translate(_AR_DIGITS)


def parse_size_from_text(text: str) -> SizeSpec | None:
    normalized = arabic_western_digits(normalize_text(text))
    # Glue patterns like 95gm / 400مل / ٩٥جم
    glued = re.sub(r"(\d)\s*(ml|مل|gm|g|جم|جرام|لتر|l)\b", r"\1 \2", normalized)
    match = _SIZE_RE.search(glued)
    if not match:
        return None
    raw_value = match.group("value").replace(",", ".")
    try:
        value = float(raw_value)
    except ValueError:
        return None
    unit = _UNIT_CANON.get(match.group("unit").lower()) or _UNIT_CANON.get(
        normalize_text(match.group("unit"))
    )
    if not unit:
        return None
    return SizeSpec(value=value, unit=unit)


def parse_quantity_mode(text: str) -> str | None:
    """Detect set-vs-add intent for follow-up quantity messages."""
    normalized = arabic_western_digits(normalize_text(text))
    if re.search(r"(?<!\w)(زيد|زود|زيدو|زودو|اضف|أضف|add|plus|more)(?!\w)", normalized):
        return "add"
    if re.search(r"(?<!\w)(خلهم|خليهم|خلّهم|خليها|خلها|اجعلها|اجعلهم|صير|صيرو|set|make)(?!\w)", normalized):
        return "set"
    return None


def parse_quantity_from_text(text: str) -> int | None:
    normalized = arabic_western_digits(normalize_text(text))
    # Explicit "حبتين" / "2 حبة" / "x2"
    for word, qty in _QTY_WORDS.items():
        if word in normalized.split() or word in normalized:
            # Avoid matching "حبة" inside longer unrelated tokens poorly — check boundaries
            if re.search(rf"(?<!\w){re.escape(word)}(?!\w)", normalized):
                return qty

    # Leading/trailing small integers next to product words: "حبتين 2", "2 صابون", "×2"
    qty_match = re.search(
        r"(?:^|[×xX*]\s*|\b)(\d{1,2})\s*(?:حبه|حبة|قطع|pcs?|pieces?|x)?\b",
        normalized,
    )
    if qty_match:
        value = int(qty_match.group(1))
        if 1 <= value <= 20:
            # Don't treat size numbers as quantity when a size unit follows
            after = normalized[qty_match.end() : qty_match.end() + 6]
            if re.match(r"\s*(ml|مل|g|gm|جم|لتر|l)\b", after):
                return None
            return value
    return None


def _fuzzy_canon(token: str, *, max_distance: int = 1) -> str | None:
    """Map simple typos (cofee→coffee) onto known lexicon roots."""
    if len(token) < 4:
        return None
    canonical = lexicon_canonical_map()
    best = None
    for known, root in canonical.items():
        if abs(len(known) - len(token)) > max_distance:
            continue
        if _edit_distance(token, known) <= max_distance:
            best = root
            break
    return best


def _edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    if abs(len(a) - len(b)) > 1:
        return 2
    # optimized distance-1 check
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b))
    if len(a) < len(b):
        a, b = b, a
    # a longer by 1
    i = j = diffs = 0
    while i < len(a) and j < len(b):
        if a[i] != b[j]:
            diffs += 1
            if diffs > 1:
                return diffs
            i += 1
            continue
        i += 1
        j += 1
    return diffs + (len(a) - i)


def expand_with_typos(tokens: set[str]) -> set[str]:
    expanded = set(tokens)
    for token in list(tokens):
        fuzzy = _fuzzy_canon(token)
        if fuzzy:
            expanded.add(fuzzy)
            expanded.add(token)
    return expanded


def parse_product_query(query: str) -> ParsedProductQuery:
    raw = query or ""
    digit_norm = arabic_western_digits(raw)
    size = parse_size_from_text(digit_norm)
    quantity = parse_quantity_from_text(digit_norm)
    quantity_mode = parse_quantity_mode(digit_norm)
    if quantity is not None and quantity_mode is None:
        # Default: first mention sets qty; bare "ثلاث" after a product is set
        quantity_mode = "set"

    # Strip size phrase so 400 doesn't become a residual token
    stripped = digit_norm
    if size:
        stripped = _SIZE_RE.sub(" ", arabic_western_digits(normalize_text(stripped)))

    tokens = tokenize(stripped, expand_synonyms=True, drop_stopwords=True)
    tokens = expand_with_typos(tokens)

    # Also keep raw split tokens for residual matching
    raw_parts = {
        _strip_al_prefix(part)
        for part in _TOKEN_SPLIT.split(normalize_text(stripped))
        if len(part) >= 2
    }
    tokens |= expand_with_typos(raw_parts)

    canonical = lexicon_canonical_map()
    types = {
        canonical.get(t, t)
        for t in tokens
        if t in TYPE_ROOTS or canonical.get(t) in TYPE_ROOTS
    }
    types = {t for t in types if t in TYPE_ROOTS}

    attributes = {
        canonical.get(t, t)
        for t in tokens
        if t in ATTRIBUTE_ROOTS or canonical.get(t) in ATTRIBUTE_ROOTS
    }
    attributes = {t for t in attributes if t in ATTRIBUTE_ROOTS}

    noise = {
        "سعر",
        "طلب",
        "شراء",
        "ابي",
        "ابغى",
        "كم",
        "price",
        "cost",
        "buy",
        "order",
        "want",
        "please",
        "حجم",
        "size",
    }
    # Quantity words are not residual product tokens
    noise |= {normalize_text(k) for k in _QTY_WORDS}
    residual = {
        t
        for t in tokens
        if t not in types
        and t not in attributes
        and t not in noise
        and canonical.get(t, t) not in types
        and canonical.get(t, t) not in attributes
        and not t.isdigit()
    }

    return ParsedProductQuery(
        raw=raw,
        tokens=tokens,
        types=types,
        attributes=attributes,
        size=size,
        quantity=quantity,
        quantity_mode=quantity_mode,
        residual_tokens=residual,
    )


def product_aliases(product) -> set[str]:
    """Channel/product alternate names stored in keywords (comma-separated)."""
    aliases: set[str] = set()
    keywords = getattr(product, "keywords", None) or ""
    for part in str(keywords).split(","):
        part_n = normalize_text(part)
        if not part_n:
            continue
        aliases.add(part_n)
        aliases |= tokenize(part_n, expand_synonyms=True, drop_stopwords=False)
    return aliases


def product_type_roots(product) -> set[str]:
    blob = " ".join(
        str(part)
        for part in (
            getattr(product, "name", "") or "",
            getattr(product, "category", "") or "",
            getattr(product, "keywords", "") or "",
            getattr(product, "description", "") or "",
        )
        if part
    )
    tokens = tokenize(blob, expand_synonyms=True, drop_stopwords=False)
    canonical = lexicon_canonical_map()
    roots = {t for t in tokens if t in TYPE_ROOTS}
    roots |= {canonical[t] for t in tokens if t in canonical and canonical[t] in TYPE_ROOTS}
    return roots


def product_attribute_roots(product) -> set[str]:
    blob = " ".join(
        str(part)
        for part in (
            getattr(product, "name", "") or "",
            getattr(product, "keywords", "") or "",
            getattr(product, "variant_color", "") or "",
            getattr(product, "description", "") or "",
        )
        if part
    )
    tokens = tokenize(blob, expand_synonyms=True, drop_stopwords=False)
    canonical = lexicon_canonical_map()
    roots = {t for t in tokens if t in ATTRIBUTE_ROOTS}
    roots |= {canonical[t] for t in tokens if t in canonical and canonical[t] in ATTRIBUTE_ROOTS}
    return roots


def product_size_spec(product) -> SizeSpec | None:
    for candidate in (
        getattr(product, "variant_size", None),
        getattr(product, "name", None),
        getattr(product, "description", None),
    ):
        parsed = parse_size_from_text(str(candidate or ""))
        if parsed:
            return parsed
    attrs = getattr(product, "variant_attributes", None) or {}
    if isinstance(attrs, dict):
        for key, value in attrs.items():
            parsed = parse_size_from_text(f"{key} {value}")
            if parsed:
                return parsed
    return None
