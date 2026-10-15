"""Context-aware acronym & custom pronunciation normalization and mapping for VoxLab.

Maintains three distinct representations:
1. `source_text`: Original script text (never mutates user script, UI, history, or SRT).
2. `spoken_text`: Internal text sent to the TTS engine after applying pronunciation rules.
3. `pronunciation_mapping`: Structured mapping between source spans and expected spoken forms
   for post-check audio quality validation (`audio_quality.py`) and diagnostics.

Strict Precedence Order:
  Project User Rules -> Global User Rules -> Verified Standard Pronunciation Dictionary
  -> High-Confidence Contextual Auto-Detection -> Keep Original Text.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any

_BRACKET_CONTROL_RE = re.compile(r"\[[^\[\]]*\]")
_VI_DIACRITIC_RE = re.compile(
    r"[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ"
    r"ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]"
)

# Group A: Verified standard initialisms read letter-by-letter
VERIFIED_INITIALISMS: set[str] = {
    "GVEC", "VPP", "FBI", "CIA", "NSA", "FCC", "FDA", "EPA", "FAA", "DOJ", "DOE", "DOD",
    "IRS", "CDC", "NIH", "NHS", "WTO", "IMF", "UN", "EU", "UK", "USA", "UAE", "CEO", "CFO",
    "CTO", "COO", "CIO", "CMO", "VP", "EVP", "SVP", "GDP", "GNP", "CPI", "PPI", "ROI", "IPO",
    "ETF", "ESG", "LLC", "CPU", "GPU", "NPU", "TPU", "SSD", "HDD", "USB", "HDMI", "API",
    "SDK", "CLI", "GUI", "URL", "HTML", "CSS", "SQL", "JSON", "XML", "HTTP", "HTTPS", "TCP",
    "UDP", "DNS", "SSH", "SSL", "TLS", "VPN", "LLM", "NLP", "ASR", "TTS", "OCR", "AI", "ML",
    "VR", "AR", "XR", "EV", "SUV", "BMW", "BYD", "GM", "VW", "LG", "HP", "IBM", "AMD", "TSMC",
    "ASML", "UBS", "HSBC", "BBC", "CNN", "NBC", "CBS", "ABC", "CNBC", "WSJ", "NYT", "NFL",
    "NBA", "MLB", "NHL", "UFC", "DNA", "RNA", "PCR", "MRI", "ECG", "EKG", "ICU", "HIV", "HPV",
    "ADHD", "PTSD", "OCD", "MBA", "ATM", "OTP", "GPS", "SOS", "VIP", "DIY", "FAQ", "FYI",
    "TBA", "TBD", "ETA", "NDA", "SLA", "KPI", "OKR", "CRM", "ERP", "CMS", "SEO", "CTR", "CPC",
    "CPM", "LTV", "CAC", "ARR", "MRR", "YTD", "HVAC", "LCD", "CRT", "LFP", "NMC", "NCA", "BMS",
    "PCS", "UPS", "TOU", "PPA", "SREC", "ITC", "PTC", "CPUC", "PUCT", "NERC", "WECC", "MISO",
    "PJM", "SPP", "LCRA", "SMUD", "LADWP", "TVA", "BPA", "NREL", "EPRI", "NARUC", "IEEE",
}

# Mixed-case / alphanumeric verified initialisms
VERIFIED_MIXED_INITIALISMS: dict[str, tuple[str, ...]] = {
    "PhD": ("p", "h", "d"),
    "IoT": ("i", "o", "t"),
    "PCIe": ("p", "c", "i", "e"),
    "B2B": ("b", "two", "b"),
    "B2C": ("b", "two", "c"),
    "V2G": ("v", "two", "g"),
    "V2H": ("v", "two", "h"),
    "V2L": ("v", "two", "l"),
    "V2X": ("v", "two", "x"),
    "YoY": ("y", "o", "y"),
    "QoQ": ("q", "o", "q"),
}

# Group E: Ampersand compound initialisms (e.g. PG&E -> P G and E)
AMPERSAND_INITIALISMS: dict[str, tuple[str, list[str]]] = {
    "PG&E": ("P G and E", ["p", "g", "and", "e"]),
    "AT&T": ("A T and T", ["a", "t", "and", "t"]),
    "S&P": ("S and P", ["s", "and", "p"]),
    "R&D": ("R and D", ["r", "and", "d"]),
    "M&A": ("M and A", ["m", "and", "a"]),
    "Q&A": ("Q and A", ["q", "and", "a"]),
    "P&L": ("P and L", ["p", "and", "l"]),
    "O&M": ("O and M", ["o", "and", "m"]),
    "C&I": ("C and I", ["c", "and", "i"]),
}

# Group B: Pronounceable acronyms by convention (read as a word, NEVER spell letter-by-letter)
PRONOUNCEABLE_ACRONYMS: set[str] = {
    "NASA", "NATO", "OPEC", "UNESCO", "UNICEF", "ASEAN", "APEC", "NAFTA", "BRICS",
    "FIFA", "UEFA", "LASER", "RADAR", "SONAR", "SCUBA", "SIM", "PIN", "RAM", "ROM",
    "LAN", "WAN", "WLAN", "GIF", "JPEG", "MPEG", "ASCII", "BIOS", "CMOS", "CUDA",
    "OLED", "QLED", "COVID", "SARS", "AIDS", "STEM", "SWAT", "SEAL", "POTUS", "SCOTUS",
    "ERCOT", "CAISO", "NYISO", "DEFCON", "NORAD", "INTERPOL", "EUROPOL", "FEMA", "LIDAR",
    "GAAP", "FICO", "FAFSA", "COBRA", "HIPAA", "OSHA", "DARPA", "ARPA", "CERN", "SETI",
}

# Group C: Ambiguous / multi-convention acronyms (FERC, ISO, NEM)
# Not forced to letter-by-letter by default unless user rule overrides;
# post-check accepts either conventional word reading or letter-by-letter reading.
MULTI_CONVENTION_ACRONYMS: set[str] = {
    "FERC", "ISO", "NEM",
}

# Group D: Ordinary English words that often appear in ALL-CAPS for emphasis
# Must NEVER be treated as letter-by-letter initialisms.
ORDINARY_UPPERCASE_WORDS: set[str] = {
    "NOW", "NEVER", "POWER", "HUMAN", "BOT", "TESLA", "ENERGY", "SOLAR", "BATTERY",
    "GRID", "HOME", "FREE", "NEW", "BIG", "HUGE", "STOP", "WARNING", "BREAKING",
    "URGENT", "SECRET", "TRUTH", "FACT", "REAL", "FAKE", "ZERO", "ONE", "TWO", "THREE",
    "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ALL", "NONE", "MORE",
    "MOST", "BEST", "WORST", "FIRST", "LAST", "NEXT", "ONLY", "JUST", "EVEN", "STILL",
    "ALWAYS", "EVERY", "WHY", "HOW", "WHAT", "WHEN", "WHERE", "WHOSE", "WHOM", "WHICH",
    "THIS", "THAT", "THESE", "THOSE", "HERE", "THERE", "YES", "NO", "NOT", "AND", "OR",
    "BUT", "FOR", "WITH", "FROM", "INTO", "OVER", "UNDER", "AFTER", "BEFORE", "TODAY",
    "TOMORROW", "YESTERDAY", "YEAR", "YEARS", "MONTH", "DAY", "TIME", "LIFE", "WORLD",
    "MONEY", "COST", "PRICE", "BILL", "BILLS", "RATE", "RATES", "TAX", "SAVE", "SAVINGS",
    "PROFIT", "LOSS", "RISK", "SAFE", "FAST", "SLOW", "HIGH", "LOW", "UP", "DOWN", "OUT",
    "OFF", "ON", "IN", "TO", "BY", "AT", "OF", "AS", "IS", "ARE", "WAS", "WERE", "BE",
    "BEEN", "DO", "DOES", "DID", "CAN", "WILL", "MUST", "NEED", "WANT", "GET", "MAKE",
    "TAKE", "GIVE", "KEEP", "PAY", "BUY", "SELL", "USE", "WORK", "WORKS", "RUN", "HELP",
    "LOOK", "SEE", "KNOW", "THINK", "SAY", "TELL", "SHOW", "FIND", "CALL", "TRY", "ASK",
    "FEEL", "LEAVE", "PUT", "MEAN", "LET", "BEGIN", "SEEM", "TURN", "START", "MIGHT",
    "PART", "PLACE", "CASE", "WEEK", "COMPANY", "SYSTEM", "PROGRAM", "QUESTION", "NUMBER",
    "NIGHT", "POINT", "WATER", "ROOM", "AREA", "STORY", "ISSUE", "SIDE", "KIND", "HEAD",
    "HOUSE", "SERVICE", "HOUR", "GAME", "LINE", "END", "MEMBER", "LAW", "CAR", "CITY",
    "NAME", "PRESIDENT", "TEAM", "MINUTE", "IDEA", "BODY", "BACK", "FACE", "LEVEL",
    "OFFICE", "DOOR", "HEALTH", "PERSON", "ART", "WAR", "HISTORY", "PARTY", "RESULT",
    "CHANGE", "MORNING", "REASON", "RESEARCH", "MOMENT", "AIR", "FORCE", "PEAK", "PAYBACK",
    "TEXAS", "PRIME", "EXAMPLE", "ANNUAL", "CREDIT", "CREDITS", "UPFRONT", "INCENTIVE",
    "ROBOT", "ROBOTS", "BOTTOM", "MODEL", "POWERWALL", "MEGAPACK", "STARSHIP", "OPTIMUS",
}

# Institutional / technical head nouns that confirm a preceding unknown uppercase token is an initialism
_INSTITUTIONAL_HEAD_NOUNS: set[str] = {
    "cooperative", "coop", "co-op", "utility", "program", "programs", "agency", "commission",
    "authority", "association", "corporation", "committee", "council", "board", "bureau",
    "department", "institute", "federation", "coalition", "alliance", "initiative", "protocol",
    "standard", "standards", "certification", "regulation", "regulations", "directive", "index",
    "exchange", "network", "networks", "grid", "tariff", "tariffs", "credit", "credits",
}

# Determiners / prepositions that precede an institutional noun phrase (e.g. "the WHO", "by the SEC")
_NP_INTRODUCERS: set[str] = {
    "the", "a", "an", "by", "from", "at", "with", "of", "for", "to", "in", "into",
    "under", "through", "within", "against", "between", "joining", "enrolling",
}

# Nouns/verbs that commonly follow organization "WHO"
_WHO_ORG_FOLLOWERS: set[str] = {
    "announced", "warned", "warns", "reported", "reports", "report", "guidelines",
    "officials", "director", "chief", "experts", "data", "study", "standards",
    "recommendations", "declared", "declares", "issued", "issues", "said", "says",
    "stated", "states", "confirmed", "confirms", "estimates", "urged", "urges",
    "called", "calls", "classified", "approved", "approves", "panel", "team",
    "mission", "headquarters", "member", "members", "countries", "budget", "funding",
}

# Words that precede relative pronoun "who" (animate antecedents)
_WHO_PRONOUN_ANTECEDENTS: set[str] = {
    "people", "person", "anyone", "someone", "everyone", "no", "nobody", "those",
    "homeowners", "customers", "users", "consumers", "residents", "citizens", "americans",
    "europeans", "workers", "employees", "patients", "doctors", "voters", "investors",
    "drivers", "owners", "members", "students", "children", "parents", "men", "women",
    "man", "woman", "boy", "girl", "friend", "friends", "leader", "leaders", "officials",
    "experts", "researchers", "scientists", "engineers", "analysts", "he", "she", "they",
    "we", "you", "one", "ones", "many", "few", "others", "individuals", "households",
}

# Nouns/modifiers that follow "US" when it means United States
_US_COUNTRY_FOLLOWERS: set[str] = {
    "government", "economy", "market", "markets", "dollar", "dollars", "grid", "states",
    "department", "congress", "senate", "house", "treasury", "military", "navy", "army",
    "president", "administration", "energy", "power", "solar", "battery", "homeowners",
    "consumers", "households", "companies", "firms", "stocks", "exports", "imports",
    "tariffs", "policy", "law", "laws", "regulators", "officials", "citizens", "history",
    "court", "agency", "authorities", "utilities", "sector", "industry", "production",
    "manufacturing", "customs", "border", "embassy", "sanctions", "aid", "debt", "gdp",
    "inflation", "rates", "federal", "national", "based", "made",
}

# Verbs/prepositions that precede object pronoun "us"
_US_PRONOUN_PREDECESSORS: set[str] = {
    "help", "helped", "helping", "helps", "give", "gave", "giving", "gives", "tell",
    "told", "telling", "tells", "show", "showed", "showing", "shows", "let", "lets",
    "make", "made", "making", "makes", "allow", "allowed", "allows", "force", "forced",
    "forces", "cost", "costs", "save", "saved", "saves", "bring", "brought", "brings",
    "send", "sent", "sends", "ask", "asked", "asks", "call", "called", "calls", "join",
    "joined", "contact", "remind", "teach", "taught", "protect", "warn", "warned",
    "lead", "led", "keep", "kept", "leave", "left", "pay", "paid", "watch", "hear",
    "heard", "see", "saw", "meet", "met", "hit", "affect", "affected", "affects",
    "for", "with", "to", "from", "around", "between", "among", "against", "without",
    "like", "before", "after", "behind", "above", "below", "near", "of", "on", "upon",
}

# Nouns/modifiers that confirm "IT" means Information Technology
_IT_TECH_FOLLOWERS: set[str] = {
    "department", "departments", "infrastructure", "system", "systems", "security",
    "support", "service", "services", "budget", "budgets", "team", "teams", "staff",
    "manager", "managers", "director", "directors", "industry", "sector", "company",
    "companies", "consulting", "operations", "governance", "architecture", "professional",
    "professionals", "specialist", "specialists", "admin", "admins", "administrator",
    "administrators", "equipment", "hardware", "software", "network", "networks",
    "spending", "solution", "solutions", "strategy", "project", "projects", "leader",
    "leaders", "workforce", "outage", "outages", "modernization", "vendor", "vendors",
}

_IT_TECH_PREDECESSORS: set[str] = {
    "corporate", "enterprise", "global", "healthcare", "modern", "internal", "outsourced",
    "federal", "municipal", "managed", "cloud",
}

# Followers that confirm "SEC" means Securities and Exchange Commission
_SEC_COMMISSION_FOLLOWERS: set[str] = {
    "filing", "filings", "chair", "chairman", "commissioner", "commissioners", "rule",
    "rules", "regulation", "regulations", "investigation", "investigations", "enforcement",
    "probe", "approval", "approvals", "lawsuit", "report", "reports", "disclosure",
    "disclosures", "staff", "officials", "guidance", "mandate", "action", "complaint",
    "charges", "settlement", "fine", "fines", "registration", "form", "forms",
}

# Verified English & Vietnamese letter names for ASR post-check normalization
VERIFIED_LETTER_NAME_MAP: dict[str, set[str]] = {
    "a": {"a", "ay"},
    "b": {"b", "bee", "be", "bi"},
    "c": {"c", "cee", "see", "sea", "xi", "si"},
    "d": {"d", "dee", "di"},
    "e": {"e", "ee", "i"},
    "f": {"f", "ef", "eff", "ép"},
    "g": {"g", "gee", "ji", "gi"},
    "h": {"h", "aitch", "haitch", "hắt"},
    "i": {"i", "eye", "ai"},
    "j": {"j", "jay", "giây"},
    "k": {"k", "kay", "ca", "ka"},
    "l": {"l", "el", "ell", "eo"},
    "m": {"m", "em"},
    "n": {"n", "en"},
    "o": {"o", "oh", "ô"},
    "p": {"p", "pee", "pi"},
    "q": {"q", "cue", "queue", "kyu", "quy"},
    "r": {"r", "ar", "are"},
    "s": {"s", "es", "ess", "ét"},
    "t": {"t", "tee", "tea", "ti"},
    "u": {"u", "you", "yu"},
    "v": {"v", "vee", "vi"},
    "w": {"w", "doubleu", "doubleyou", "vêđúp"},
    "x": {"x", "ex", "ích"},
    "y": {"y", "why", "wye", "y"},
    "z": {"z", "zee", "zed", "dét"},
}


@dataclass
class PronunciationMappingEntry:
    source_span: str
    spoken_form: str
    start_index: int
    end_index: int
    category: str  # "project_rule" | "global_rule" | "verified_dict" | "auto_context" | "version_entity" | "preserve"
    mode: str      # "letter_by_letter" | "word" | "custom" | "preserve"
    expected_letters: list[str] = field(default_factory=list)
    allowed_forms: list[str] = field(default_factory=list)
    forbidden_words: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sourceSpan": self.source_span,
            "spokenForm": self.spoken_form,
            "startIndex": self.start_index,
            "endIndex": self.end_index,
            "category": self.category,
            "mode": self.mode,
            "expectedLetters": list(self.expected_letters),
            "allowedForms": list(self.allowed_forms),
            "forbiddenWords": list(self.forbidden_words),
        }


def format_letter_sequence_for_engine(
    letters: list[str] | tuple[str, ...],
    engine: str | None = None,
    language: str | None = None,
    plural_suffix: str = "",
) -> str:
    """Formats an initialism's letter sequence for the target TTS engine.

    Empirically verified across OmniVoice, Chatterbox Turbo, and Qwen3-TTS:
    space-separated uppercase letters ('G V E C', 'V P P', 'W H O') produce
    accurate, natural letter-by-letter synthesis across all 3 neural engines
    without BPE syllable merging ('G-V-ek') or hyphen/dot artifacts.
    """
    _ = (engine, language)
    upper_parts = [p.upper() if len(p) == 1 else p for p in letters]
    base = " ".join(upper_parts)
    if plural_suffix:
        return f"{base} {plural_suffix.lower()}"
    return base


def _is_all_caps_sentence(text: str) -> bool:
    """Returns True if the surrounding text is written predominantly in ALL-CAPS
    (e.g. 'WHO ARE YOU?' or 'HELP US NOW!'), where uppercase does not mark an acronym.
    """
    words = re.findall(r"[A-Za-z\u00C0-\u1EF9]{2,}", text)
    if len(words) < 2:
        return False
    upper_count = sum(1 for w in words if w.isupper())
    return (upper_count / len(words)) >= 0.70


def _extract_parenthetical_defined_acronyms(text: str) -> set[str]:
    """Detects acronyms explicitly defined in parentheses in the script, e.g.
    'Guadalupe Valley Electric Cooperative (GVEC)' -> {'GVEC'}.
    """
    defined: set[str] = set()
    for m in re.finditer(r"\(([A-Z]{2,6})\)", text):
        cand = m.group(1)
        if cand not in ORDINARY_UPPERCASE_WORDS and cand not in PRONOUNCEABLE_ACRONYMS:
            defined.add(cand)
    return defined


def sort_and_deduplicate_user_rules(rules: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Applies mandatory user rule precedence:
    1. Project scope ('project') strictly overrides Global scope ('global') on duplicate sourceText.
    2. Within each scope tier, longer `sourceText` matches first (longest-match priority).
    """
    if not rules:
        return []

    valid: list[dict[str, Any]] = []
    for r in rules:
        if not isinstance(r, dict) or not r.get("enabled", True):
            continue
        src = r.get("sourceText")
        spk = r.get("spokenText") if isinstance(r.get("spokenText"), str) else r.get("replacementText")
        if isinstance(src, str) and src.strip() and isinstance(spk, str):
            norm_r = dict(r)
            norm_r["sourceText"] = src
            norm_r["spokenText"] = spk
            valid.append(norm_r)
    if not valid:
        return []

    project_rules = [r for r in valid if r.get("scope") == "project"]
    global_rules = [r for r in valid if r.get("scope") != "project"]

    # Project rules override Global rules with the same sourceText
    project_exact_keys = {r["sourceText"].strip() for r in project_rules}
    project_ci_keys = {r["sourceText"].strip().lower() for r in project_rules if not r.get("caseSensitive", False)}

    filtered_global: list[dict[str, Any]] = []
    for gr in global_rules:
        src = gr["sourceText"].strip()
        if src in project_exact_keys or src.lower() in project_ci_keys:
            continue
        filtered_global.append(gr)

    project_rules.sort(key=lambda r: len(r["sourceText"].strip()), reverse=True)
    filtered_global.sort(key=lambda r: len(r["sourceText"].strip()), reverse=True)
    return project_rules + filtered_global


def _build_user_rule_regex(source_text: str, case_sensitive: bool) -> re.Pattern[str]:
    escaped = re.escape(source_text)
    first_is_word = bool(re.match(r"[\w\u00C0-\u1EF9]", source_text[0]))
    last_is_word = bool(re.match(r"[\w\u00C0-\u1EF9]", source_text[-1]))
    prefix = r"(?<![\w\u00C0-\u1EF9])" if first_is_word else ""
    suffix = r"(?![\w\u00C0-\u1EF9])" if last_is_word else ""
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.compile(f"{prefix}{escaped}{suffix}", flags)


def classify_contextual_token(
    token: str,
    prev_word_raw: str,
    next_word_raw: str,
    prev2_word_raw: str = "",
    is_all_caps_ctx: bool = False,
    defined_acronyms: set[str] | None = None,
    engine: str | None = None,
    language: str | None = None,
) -> tuple[str, str, str, list[str], list[str], list[str]] | None:
    """Classifies a single token in context according to Tiers 3, 4, and 5.

    Returns:
      (spoken_form, category, mode, expected_letters, allowed_forms, forbidden_words)
      or None if the token should be kept as-is without special acronym mapping.
    """
    prev_lower = re.sub(r"[^\w\u00C0-\u1EF9-]", "", prev_word_raw).lower()
    prev2_lower = re.sub(r"[^\w\u00C0-\u1EF9-]", "", prev2_word_raw).lower()
    next_lower = re.sub(r"[^\w\u00C0-\u1EF9-]", "", next_word_raw).lower()

    # 1. Group E: Ampersand initialisms (e.g. PG&E, AT&T, S&P, R&D)
    if token in AMPERSAND_INITIALISMS:
        spoken, exp_tokens = AMPERSAND_INITIALISMS[token]
        letters_only = [t for t in exp_tokens if len(t) == 1]
        return (
            spoken,
            "verified_dict",
            "letter_by_letter",
            letters_only,
            [spoken.lower(), token.lower()],
            [],
        )

    # 2. Dotted initialisms (e.g. U.S., U.S.A., W.H.O., F.B.I., G.V.E.C.)
    if re.fullmatch(r"(?:[A-Z]\.){2,6}", token):
        letters = [c.lower() for c in token if c.isalpha()]
        spoken = format_letter_sequence_for_engine(letters, engine=engine, language=language)
        return (
            spoken,
            "verified_dict",
            "letter_by_letter",
            letters,
            [spoken.lower(), "".join(letters)],
            [],
        )

    # 3. Group E: Technical unit kWh
    if token == "kWh":
        return (
            "kWh",
            "verified_dict",
            "preserve",
            [],
            ["kwh", "kilowatt hour", "kilowatt hours", "k w h"],
            [],
        )

    # 4. Mixed-case / alphanumeric verified initialisms (PhD, IoT, PCIe, B2B, V2G...)
    if token in VERIFIED_MIXED_INITIALISMS:
        parts = list(VERIFIED_MIXED_INITIALISMS[token])
        spoken = format_letter_sequence_for_engine(parts, engine=engine, language=language)
        letters_only = [p for p in parts if len(p) == 1]
        return (
            spoken,
            "verified_dict",
            "letter_by_letter",
            letters_only,
            [spoken.lower(), token.lower()],
            [],
        )

    # Check pluralized initialism (e.g. VPPs, CEOs, GPUs, CPUs, APIs, EVs, LLMs)
    plural_suffix = ""
    base_token = token
    if len(token) >= 3 and token.endswith("s") and token[:-1].isupper() and token[:-1].isalpha():
        base_token = token[:-1]
        plural_suffix = "s"

    # 5. Group D: "BOT" exception -> "bot" (prevents TTS spelling B-O-T)
    if token == "BOT":
        return (
            "bot",
            "verified_dict",
            "word",
            [],
            ["bot"],
            [],
        )

    # 6. Group B: Pronounceable acronyms by convention (NASA, NATO, OPEC...)
    if base_token in PRONOUNCEABLE_ACRONYMS:
        return (
            token,
            "verified_dict",
            "word",
            [],
            [token.lower()],
            [],
        )

    # 7. Group C: Multi-convention acronyms (FERC, ISO, NEM)
    # Keep original text unless overridden by user rules, and allow both word & letter readings in QC.
    if base_token in MULTI_CONVENTION_ACRONYMS:
        letters = [c.lower() for c in base_token]
        return (
            token,
            "verified_dict",
            "preserve",
            [],
            [token.lower(), " ".join(letters)],
            [],
        )

    # 8. Group A: Verified standard letter-by-letter initialisms (GVEC, VPP, FBI, USA, CEO, GPU, CPU, AI...)
    if base_token in VERIFIED_INITIALISMS:
        letters = [c.lower() for c in base_token]
        spoken = format_letter_sequence_for_engine(
            letters, engine=engine, language=language, plural_suffix=plural_suffix
        )
        return (
            spoken,
            "verified_dict",
            "letter_by_letter",
            letters,
            [spoken.lower(), token.lower()],
            [],
        )

    # If the token is inside an ALL-CAPS sentence/clause (e.g. "WHO ARE YOU?", "THE TEN THOUSAND DOLLAR MONEY EQUATION."),
    # do NOT auto-expand context-dependent homographs or unknown tokens as acronyms.
    if is_all_caps_ctx:
        return None

    if plural_suffix:
        return None

    # 9. Group C: Context-Dependent Homographs (WHO, US, IT, SEC)
    if token == "WHO":
        # Negative check: relative pronoun after animate noun or question start before auxiliary
        is_pronoun_ctx = (
            prev_lower in _WHO_PRONOUN_ANTECEDENTS
            or (
                not prev_lower
                and next_lower in {
                    "are", "is", "was", "were", "did", "does", "do", "can", "could",
                    "will", "would", "shall", "should", "has", "have", "had", "knows",
                    "cares", "wants", "needs", "likes", "said", "told", "made", "took",
                }
            )
        )
        is_org_ctx = (
            not is_pronoun_ctx
            and (
                prev_lower in _NP_INTRODUCERS
                or next_lower in _WHO_ORG_FOLLOWERS
                or (prev_lower == "and" and prev2_lower in {"un", "cdc", "fda", "nih", "unicef"})
            )
        )
        if is_org_ctx:
            letters = ["w", "h", "o"]
            spoken = format_letter_sequence_for_engine(letters, engine=engine, language=language)
            return (
                spoken,
                "auto_context",
                "letter_by_letter",
                letters,
                ["w h o", "world health organization"],
                ["who"],
            )
        return None

    if token == "US":
        is_pronoun_ctx = prev_lower in _US_PRONOUN_PREDECESSORS
        next_is_cap = bool(next_word_raw and next_word_raw[0].isupper())
        is_country_ctx = (
            not is_pronoun_ctx
            and (
                prev_lower in {"the", "in", "across", "within", "outside", "non"}
                or next_lower in _US_COUNTRY_FOLLOWERS
                or (next_is_cap and next_lower not in {"and", "or", "but"})
            )
        )
        if is_country_ctx:
            letters = ["u", "s"]
            spoken = format_letter_sequence_for_engine(letters, engine=engine, language=language)
            return (
                spoken,
                "auto_context",
                "letter_by_letter",
                letters,
                ["u s", "united states"],
                ["us"],
            )
        return None

    if token == "IT":
        is_tech_ctx = (
            next_lower in _IT_TECH_FOLLOWERS
            or prev_lower in _IT_TECH_PREDECESSORS
            or (prev_lower in {"in", "of", "for", "our", "their", "your"} and next_lower in _IT_TECH_FOLLOWERS)
        )
        if is_tech_ctx:
            letters = ["i", "t"]
            spoken = format_letter_sequence_for_engine(letters, engine=engine, language=language)
            return (
                spoken,
                "auto_context",
                "letter_by_letter",
                letters,
                ["i t", "information technology"],
                ["it"],
            )
        return None

    if token == "SEC":
        is_seconds_ctx = bool(re.fullmatch(r"\d+", prev_lower)) or prev_lower in {
            "a", "one", "1", "few", "wait", "per", "every",
        }
        is_commission_ctx = (
            not is_seconds_ctx
            and (
                prev_lower in {"the", "us", "u.s.", "by", "with", "from", "to"}
                or next_lower in _SEC_COMMISSION_FOLLOWERS
            )
        )
        if is_commission_ctx:
            letters = ["s", "e", "c"]
            spoken = format_letter_sequence_for_engine(letters, engine=engine, language=language)
            return (
                spoken,
                "auto_context",
                "letter_by_letter",
                letters,
                ["s e c"],
                ["sec"],
            )
        return None

    # 10. Group D: Ordinary uppercase words -> keep original
    if token in ORDINARY_UPPERCASE_WORDS:
        return None

    # 11. Tier 4: High-confidence contextual auto-detection for novel initialisms
    # Matches 2-5 uppercase letters that are explicitly defined in parentheses `(TOKEN)`
    # in the script OR appear in an institutional noun phrase frame `the <TOKEN> cooperative/utility/program/...`
    if token.isupper() and token.isalpha() and 2 <= len(token) <= 5:
        is_defined = bool(defined_acronyms and token in defined_acronyms)
        is_institutional_np = (
            prev_lower in {"the", "a", "an", "their", "this", "its", "our"}
            and next_lower in _INSTITUTIONAL_HEAD_NOUNS
        )
        if is_defined or is_institutional_np:
            letters = [c.lower() for c in token]
            spoken = format_letter_sequence_for_engine(letters, engine=engine, language=language)
            return (
                spoken,
                "auto_context",
                "letter_by_letter",
                letters,
                [spoken.lower(), token.lower()],
                [],
            )

    return None


_TOKEN_SCAN_RE = re.compile(
    r"(?:[A-Z]\.){2,6}"
    r"|[A-Z]{1,3}&[A-Z]{1,3}"
    r"|[A-Za-z0-9\u00C0-\u1EF9]+(?:-[A-Za-z0-9\u00C0-\u1EF9]+)*"
)


def _infer_expected_letters_from_spoken(source_span: str, spoken_text: str) -> list[str]:
    """If a custom user rule maps an acronym to spaced/hyphenated/dotted letters or letter names,
    extracts the expected letter sequence for post-check verification.
    """
    parts = [p.strip(".,-").lower() for p in re.split(r"[\s\-.,]+", spoken_text.strip()) if p.strip(".,-")]
    if len(parts) >= 2 and all(len(p) == 1 and p.isalpha() for p in parts):
        return parts
    # Check if parts are all verified letter names matching source_span length
    mapped: list[str] = []
    i = 0
    while i < len(parts):
        if i + 1 < len(parts) and parts[i] == "double" and parts[i + 1] in ("u", "you"):
            mapped.append("w")
            i += 2
            continue
        found_letter = None
        for let_key, names in VERIFIED_LETTER_NAME_MAP.items():
            if parts[i] in names:
                found_letter = let_key
                break
        if found_letter:
            mapped.append(found_letter)
            i += 1
        else:
            return []
    if len(mapped) >= 2 and (
        not source_span.isalpha() or len(mapped) == len(source_span)
    ):
        return mapped
    return []


def prepare_spoken_text_and_mapping(
    text: str,
    language: str | None = None,
    engine: str | None = None,
    custom_rules: list[dict[str, Any]] | None = None,
    version_span_finder: Any | None = None,
) -> dict[str, Any]:
    """Unified spoken-text normalization and pronunciation mapping pipeline.

    Strictly preserves `sourceText` while producing `spokenText` and `pronunciationMapping`.
    """
    if not text or not text.strip():
        return {
            "sourceText": text,
            "spokenText": text,
            "pronunciationMapping": [],
        }

    lang_norm = (language or "").strip().lower()
    if lang_norm in ("vi", "vietnamese"):
        lang_code = "vi"
    elif lang_norm in ("en", "english"):
        lang_code = "en"
    else:
        lang_code = "vi" if _VI_DIACRITIC_RE.search(text) else "en"

    is_all_caps_ctx = _is_all_caps_sentence(text)
    defined_acronyms = _extract_parenthetical_defined_acronyms(text)
    sorted_user_rules = sort_and_deduplicate_user_rules(custom_rules)

    # Step 1: Claim bracketed control tags `[...]` so they are never modified
    claimed_spans: list[tuple[int, int, str, PronunciationMappingEntry | None]] = []
    for m in _BRACKET_CONTROL_RE.finditer(text):
        claimed_spans.append((m.start(), m.end(), m.group(0), None))

    def _overlaps(s: int, e: int) -> bool:
        return any(s < ce and e > cs for cs, ce, _, _ in claimed_spans)

    # Step 2: Claim Tier 1 (Project) & Tier 2 (Global) user pronunciation rules
    for rule in sorted_user_rules:
        src_pat = rule["sourceText"].strip()
        spoken_rep = rule["spokenText"]
        case_sens = bool(rule.get("caseSensitive", False))
        scope = "project_rule" if rule.get("scope") == "project" else "global_rule"
        rx = _build_user_rule_regex(src_pat, case_sens)

        for m in rx.finditer(text):
            s, e = m.start(), m.end()
            if _overlaps(s, e):
                continue
            exp_letters = _infer_expected_letters_from_spoken(m.group(0), spoken_rep)
            entry = PronunciationMappingEntry(
                source_span=m.group(0),
                spoken_form=spoken_rep,
                start_index=s,
                end_index=e,
                category=scope,
                mode="letter_by_letter" if exp_letters else "custom",
                expected_letters=exp_letters,
                allowed_forms=[spoken_rep.lower(), m.group(0).lower()],
                forbidden_words=[],
            )
            claimed_spans.append((s, e, spoken_rep, entry))

    # Step 3: Claim version number suffixes (e.g. "3" in "Powerwall 3", "3.0" in "NEM 3.0")
    if version_span_finder is not None:
        for v_start, v_end, v_spoken in version_span_finder(text, lang_code):
            if not _overlaps(v_start, v_end):
                v_src = text[v_start:v_end]
                v_entry = PronunciationMappingEntry(
                    source_span=v_src,
                    spoken_form=v_spoken,
                    start_index=v_start,
                    end_index=v_end,
                    category="verified_dict",
                    mode="word",
                    expected_letters=[],
                    allowed_forms=[v_spoken.lower(), v_src.lower()],
                    forbidden_words=[],
                )
                claimed_spans.append((v_start, v_end, v_spoken, v_entry))

    # Step 4: Scan tokens across full text so contextual lookahead is preserved even near user rules
    tokens = list(_TOKEN_SCAN_RE.finditer(text))
    _known_acronyms = VERIFIED_INITIALISMS | PRONOUNCEABLE_ACRONYMS | MULTI_CONVENTION_ACRONYMS

    def _is_non_acronym_caps_word(w: str) -> bool:
        base = w[:-1] if (len(w) >= 3 and w.endswith("s") and w[:-1].isupper() and w[:-1].isalpha()) else w
        return len(base) >= 2 and base.isupper() and any(c.isalpha() for c in base) and base not in _known_acronyms

    def _same_clause_all_caps(i1: int, i2: int) -> bool:
        lo_idx, hi_idx = (i1, i2) if i1 <= i2 else (i2, i1)
        between_str = text[tokens[lo_idx].end() : tokens[hi_idx].start()]
        if re.search(r"[.!?:;…\n\r]", between_str):
            return False
        for mid_idx in range(lo_idx + 1, hi_idx):
            mid_w = tokens[mid_idx].group(0)
            if any(c.islower() for c in mid_w):
                return False
        return True

    def _is_at_sentence_start(pos: int) -> bool:
        prefix = text[:pos]
        if not prefix.strip():
            return True
        return bool(re.search(r"[.!?…\n\r]\s*[\"'“”‘’(\[]*\s*$", prefix))

    for idx, tm in enumerate(tokens):
        t_start, t_end = tm.start(), tm.end()
        if _overlaps(t_start, t_end):
            continue
        tok_str = tm.group(0)
        prev_word = tokens[idx - 1].group(0) if idx > 0 else ""
        prev2_word = tokens[idx - 2].group(0) if idx > 1 else ""
        next_word = tokens[idx + 1].group(0) if (idx + 1) < len(tokens) else ""

        token_is_all_caps_ctx = is_all_caps_ctx
        if not token_is_all_caps_ctx and tok_str.isupper() and any(c.isalpha() for c in tok_str):
            for nb_idx in (idx - 2, idx - 1, idx + 1, idx + 2):
                if 0 <= nb_idx < len(tokens) and _is_non_acronym_caps_word(tokens[nb_idx].group(0)):
                    if _same_clause_all_caps(idx, nb_idx):
                        token_is_all_caps_ctx = True
                        break

        res = classify_contextual_token(
            tok_str,
            prev_word_raw=prev_word,
            next_word_raw=next_word,
            prev2_word_raw=prev2_word,
            is_all_caps_ctx=token_is_all_caps_ctx,
            defined_acronyms=defined_acronyms,
            engine=engine,
            language=lang_code,
        )
        if res is not None:
            spoken_form, category, mode, exp_letters, allowed_forms, forbidden_words = res
            entry = PronunciationMappingEntry(
                source_span=tok_str,
                spoken_form=spoken_form,
                start_index=t_start,
                end_index=t_end,
                category=category,
                mode=mode,
                expected_letters=exp_letters,
                allowed_forms=allowed_forms,
                forbidden_words=forbidden_words,
            )
            claimed_spans.append((t_start, t_end, spoken_form, entry))
        elif (
            token_is_all_caps_ctx
            and tok_str.isupper()
            and any(c.isalpha() for c in tok_str)
            and (len(tok_str) >= 2 or tok_str == "A")
        ):
            # Normalize ALL-CAPS segments (e.g. "THE TEN THOUSAND DOLLAR MONEY EQUATION.")
            # to natural sentence casing in spoken_text so TTS does not inflate title pauses,
            # while strictly preserving sourceText in UI and SRT.
            if _is_at_sentence_start(t_start) or tok_str == "TESLA":
                norm_word = tok_str[0].upper() + tok_str[1:].lower()
            else:
                norm_word = tok_str.lower()
            claimed_spans.append((t_start, t_end, norm_word, None))
        else:
            m_sci = re.fullmatch(
                r"(piezo|magneto|thermo|electro|chemo|mechano|tribo|acousto|vibro)"
                r"(resist(?:ive|ivity|or|ors|ance)|luminescen(?:t|ce)|responsive)",
                tok_str,
                re.IGNORECASE,
            )
            if m_sci:
                hyphenated_sci = f"{m_sci.group(1)}-{m_sci.group(2).lower()}"
                claimed_spans.append((t_start, t_end, hyphenated_sci, None))

    claimed_spans.sort(key=lambda x: x[0])

    out_parts: list[str] = []
    mappings: list[PronunciationMappingEntry] = []
    cursor = 0
    for cs, ce, replacement, entry in claimed_spans:
        if cs > cursor:
            out_parts.append(text[cursor:cs])
        out_parts.append(replacement)
        if entry is not None:
            mappings.append(entry)
        cursor = ce
    if cursor < len(text):
        out_parts.append(text[cursor:])

    spoken_final = "".join(out_parts)
    return {
        "sourceText": text,
        "spokenText": spoken_final,
        "pronunciationMapping": [m.to_dict() for m in mappings],
    }


def is_single_letter_or_letter_name(raw_token: str) -> str | None:
    """If `raw_token` is a single letter ('G', 'G.') or a verified letter name ('gee', 'vee'),
    returns its canonical lowercase letter ('a'-'z'); otherwise returns None.
    """
    cleaned = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", raw_token).lower()
    if not cleaned:
        return None
    if len(cleaned) == 1 and cleaned.isalpha() and "a" <= cleaned <= "z":
        return cleaned
    for letter, names in VERIFIED_LETTER_NAME_MAP.items():
        if cleaned in names and len(cleaned) >= 2:
            return letter
    return None


def decompose_asr_token_to_letters(
    raw_token: str,
    expected_letters: list[str],
) -> tuple[list[str], bool]:
    """Decomposes a single ASR token into observed letters for acronym comparison.

    Rules:
    - Dotted/hyphenated letter sequences ('G.V.E.C.', '.H', 'G-V') split into letters if each part is a valid letter.
    - Single letter or verified letter name ('G', 'gee', 'see') -> `[letter]`, `is_syllable_blend=False`.
    - Uppercase multi-letter token ('GV', 'GVEC', 'VPP', 'GVAC') -> splits into letters ONLY if it was
      transcribed in uppercase (or matches the exact expected letter sequence), because Whisper outputs
      uppercase for recognized initialisms ('GV', 'GVAC', 'VPP').
    - Lowercase multi-letter non-letter-name word ('ek', 'key', 'sequel', 'who', 'people') ->
      NEVER decomposed into individual letters! Returned as `['<word:...>']`, `is_syllable_blend=True`.
    """
    stripped = raw_token.strip()
    core = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", stripped)
    if not core:
        return [], False

    # Check dotted or hyphenated sequence like "G.V.E.C" or "W.A" or ".H"
    if "." in core or "-" in core:
        parts = [p for p in re.split(r"[.\-]+", core) if p]
        if parts and all(len(p) == 1 and p.isalpha() for p in parts):
            return [p.lower() for p in parts], False

    single_let = is_single_letter_or_letter_name(core)
    if single_let is not None:
        # Note: if expected_letters is ["w", "h", "o"] and raw_token is lowercase "who",
        # "who" is not in VERIFIED_LETTER_NAME_MAP, so single_let is None.
        # What if core is "see" or "be" or "are" or "you"? Only treat multi-char letter names
        # as letters when that letter is actually in expected_letters!
        if len(core) == 1 or single_let in expected_letters:
            return [single_let], False

    # If the token is an ALL-CAPS alphabetic string (e.g. "GV", "GVEC", "GVAC", "VPP", "VP")
    # Whisper transcribes initialisms in uppercase.
    if core.isupper() and core.isalpha() and 2 <= len(core) <= 6:
        # However, if core is a known English word written in uppercase only because it's not an initialism,
        # wait: if core == "WHO" and expected is ["w", "h", "o"], it's the collapsed acronym token.
        return [c.lower() for c in core], False

    # If lowercase matches exact joined expected_letters (e.g. Whisper lowercase output "gvec" or "vpp")
    # AND it is not a forbidden word (like "who", "us", "it", "sec"):
    joined_expected = "".join(expected_letters)
    if core.lower() == joined_expected and core.lower() not in {"who", "us", "it", "sec"}:
        return list(expected_letters), False

    return [f"<word:{core.lower()}>"], True
