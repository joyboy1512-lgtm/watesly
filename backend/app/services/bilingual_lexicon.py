"""Site-wide Arabic↔English product lexicon (not product-specific)."""

# Each group shares one meaning across languages/dialects.
PRODUCT_LEXICON_GROUPS: tuple[tuple[str, ...], ...] = (
    ("صابون", "soap", "soaps", "صابونه"),
    ("سائل", "liquid", "liquids", "ليكويد"),
    ("قالب", "bar", "bars", "قطعة", "قطعه"),
    ("شاور", "shower", "جل", "جيل", "gel", "gels", "شاورجيل"),
    ("سكراب", "scrub", "scrubs", "تقشير", "مقشر"),
    ("كريم", "cream", "creams", "مرطب", "moisturizer", "lotion", "لوشن"),
    ("زيت", "oil", "oils", "سيروم", "serum"),
    ("عطر", "perfume", "perfumes", "fragrance", "بخور"),
    ("عود", "oud", "oudh", "عودي"),
    ("ورد", "rose", "roses", "وردية"),
    ("مسك", "musk", "مسكي"),
    ("لافندر", "lavender"),
    ("فانيلا", "vanilla"),
    ("شاي", "tea"),
    ("قهوة", "coffee"),
    ("عسل", "honey"),
    ("حليب", "milk"),
    ("شعر", "hair", "شامبو", "shampoo", "بلسم", "conditioner"),
    ("بشرة", "skin", "face", "وجه", "جسم", "body"),
    ("غسول", "wash", "cleanser", "منظف"),
    ("معطر", "freshener", "spray", "سبري", "سبراي"),
    ("شمع", "wax", "candle", "شمعة", "شمعه"),
    ("هدية", "gift", "gifts", "بوكس", "box", "set", "طقم"),
    ("حجم", "size", "ml", "مل", "لتر", "liter", "litre"),
)
