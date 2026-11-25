"""Site-wide Arabic↔English product lexicon.

Generic language equivalents only — brand / channel-specific spellings
(e.g. Misk for a particular shower gel) belong on CatalogProduct.keywords
as reviewable alternate names, not here.
"""

# Product *types* (صابون ≠ سكراب). Matching prefers type + attribute together.
GENERIC_TYPE_GROUPS: tuple[tuple[str, ...], ...] = (
    ("صابون", "soap", "soaps", "صابونه"),
    ("سائل", "liquid", "liquids", "ليكويد"),
    ("قالب", "bar", "bars", "قطعة", "قطعه"),
    ("شاور", "shower", "شاورجيل", "showergel"),
    ("جل", "جيل", "gel", "gels"),
    ("سكراب", "scrub", "scrubs", "تقشير", "مقشر", "مقشّر"),
    ("كريم", "cream", "creams", "مرطب", "moisturizer", "lotion", "لوشن"),
    ("زيت", "oil", "oils", "سيروم", "serum"),
    ("عطر", "perfume", "perfumes", "fragrance", "بخور"),
    ("غسول", "wash", "cleanser", "منظف"),
    ("معطر", "freshener", "spray", "سبري", "سبراي"),
    ("شمع", "wax", "candle", "شمعة", "شمعه"),
    ("هدية", "gift", "gifts", "بوكس", "box", "set", "طقم"),
    ("شعر", "hair", "شامبو", "shampoo", "بلسم", "conditioner"),
    ("بشرة", "skin", "face", "وجه", "جسم", "body"),
)

# Common attribute / scent language pairs (not brand spellings).
GENERIC_ATTRIBUTE_GROUPS: tuple[tuple[str, ...], ...] = (
    ("عود", "oud", "oudh", "عودي"),
    ("ورد", "rose", "roses", "وردية"),
    ("مسك", "musk", "مسكي"),  # language pair; brand "Misk" stays on product aliases
    ("لافندر", "lavender"),
    ("فانيلا", "vanilla"),
    ("شاي", "tea"),
    ("قهوة", "coffee", "كوفي", "كوفيه"),
    ("عسل", "honey"),
    ("حليب", "milk"),
)

# Size / unit language pairs (parsing uses dedicated size logic; kept for token expand).
GENERIC_SIZE_GROUPS: tuple[tuple[str, ...], ...] = (
    ("حجم", "size", "ml", "مل", "لتر", "liter", "litre", "جم", "جرام", "g", "gm", "gram", "grams"),
)

PRODUCT_LEXICON_GROUPS: tuple[tuple[str, ...], ...] = (
    GENERIC_TYPE_GROUPS + GENERIC_ATTRIBUTE_GROUPS + GENERIC_SIZE_GROUPS
)


def _norm_root(word: str) -> str:
    # Keep roots aligned with internal_ai.normalize_text (ة→ه, etc.) without importing it
    # here (avoids circular imports). Mirror the critical folds only.
    value = (word or "").strip().lower()
    value = (
        value.replace("أ", "ا")
        .replace("إ", "ا")
        .replace("آ", "ا")
        .replace("ى", "ي")
        .replace("ة", "ه")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
    )
    return value


# Canonical roots used by the structured matcher (normalized).
TYPE_ROOTS: frozenset[str] = frozenset(_norm_root(group[0]) for group in GENERIC_TYPE_GROUPS)
ATTRIBUTE_ROOTS: frozenset[str] = frozenset(
    _norm_root(group[0]) for group in GENERIC_ATTRIBUTE_GROUPS
)
