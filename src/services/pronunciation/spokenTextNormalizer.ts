import {
  PreparedSpokenTextResult,
  PronunciationMappingCategory,
  PronunciationMappingEntry,
  PronunciationMappingMode,
  PronunciationRule,
} from "./types";
import { buildRuleRegex } from "./matcher";

export const VERIFIED_INITIALISMS = new Set<string>([
  "GVEC", "VPP", "FBI", "CIA", "NSA", "DOJ", "DOD", "DHS", "EPA", "FDA",
  "FCC", "FTC", "FAA", "IRS", "CDC", "NIH", "NHS", "WTO", "IMF", "ECB",
  "WHO", "UN", "EU", "UK", "UAE", "USA", "USSR",
  "CEO", "CFO", "CTO", "COO", "CMO", "CIO", "CISO", "VP", "SVP", "EVP", "HR", "PR",
  "GDP", "GNP", "CPI", "PPI", "IPO", "ROI", "ROE", "EBITDA", "ETF", "APR", "APY", "LLC", "LLP",
  "CPU", "GPU", "TPU", "NPU", "APU", "RAM", "ROM", "SSD", "HDD", "NVMe", "USB", "HDMI",
  "API", "SDK", "CLI", "GUI", "UI", "UX", "IDE", "OS", "VM", "DNS", "DHCP", "HTTP", "HTTPS",
  "FTP", "SSH", "SSL", "TLS", "TCP", "UDP", "IP", "VPN", "LAN", "WAN", "CDN",
  "HTML", "CSS", "XML", "SQL", "JWT", "LLM", "NLP", "AGI", "AI", "ML", "VR", "AR", "XR",
  "IOT", "PCB", "FPGA", "ASIC", "SOC", "BIOS", "UEFI",
  "EV", "HEV", "PHEV", "BEV", "SUV", "ATV", "RV", "AWD", "FWD", "RWD", "FSD", "ABS",
  "BMS", "PCS", "HVAC", "LED", "OLED", "QLED", "LCD", "CRT", "UPS", "PV",
  "ERCOT", "CAISO", "NYISO", "MISO", "PJM", "SPP", "TVA", "BPA", "LCRA", "CPS", "PEC", "SMECO",
  "NHTSA", "NTSB", "OSHA", "FEMA", "FDIC", "CFPB", "CFTC", "FINRA", "NYSE", "CBOE",
  "CNN", "BBC", "NBC", "CBS", "ABC", "CNBC", "MSNBC", "NPR", "PBS", "WSJ", "NYT",
  "NFL", "NBA", "MLB", "NHL", "UFC", "WWE", "FIFA", "IOC", "NCAA",
  "MIT", "UCLA", "USC", "NYU", "LSU", "BYU", "SMU", "TCU",
  "DNA", "RNA", "PCR", "MRI", "ECG", "EKG", "EEG", "ICU", "ER", "HIV", "HPV", "ADHD", "OCD", "PTSD",
  "PDF", "CSV", "PNG", "JPG", "SVG", "MP3", "MP4", "WAV", "SRT", "VTT",
]);

export const VERIFIED_MIXED_INITIALISMS: Record<string, string[]> = {
  PhD: ["p", "h", "d"],
  IoT: ["i", "o", "t"],
  iOS: ["i", "o", "s"],
  macOS: ["mac", "o", "s"],
   GraphQL: ["graph", "q", "l"],
  NoSQL: ["no", "s", "q", "l"],
  PCIe: ["p", "c", "i", "e"],
  PoE: ["p", "o", "e"],
  QoS: ["q", "o", "s"],
  SaaS: ["s", "a", "a", "s"],
  PaaS: ["p", "a", "a", "s"],
  IaaS: ["i", "a", "a", "s"],
  DDoS: ["d", "d", "o", "s"],
  LiFePO4: ["l", "i", "f", "e", "p", "o", "four"],
  B2B: ["b", "two", "b"],
  B2C: ["b", "two", "c"],
  P2P: ["p", "two", "p"],
  V2G: ["v", "two", "g"],
  V2H: ["v", "two", "h"],
  V2L: ["v", "two", "l"],
  V2X: ["v", "two", "x"],
};

export const AMPERSAND_INITIALISMS: Record<string, { spoken: string; letters: string[] }> = {
  "PG&E": { spoken: "P G and E", letters: ["p", "g", "e"] },
  "AT&T": { spoken: "A T and T", letters: ["a", "t", "t"] },
  "S&P": { spoken: "S and P", letters: ["s", "p"] },
  "R&D": { spoken: "R and D", letters: ["r", "d"] },
  "M&A": { spoken: "M and A", letters: ["m", "a"] },
  "P&L": { spoken: "P and L", letters: ["p", "l"] },
  "Q&A": { spoken: "Q and A", letters: ["q", "a"] },
  "O&M": { spoken: "O and M", letters: ["o", "m"] },
  "C&I": { spoken: "C and I", letters: ["c", "i"] },
};

export const PRONOUNCEABLE_ACRONYMS = new Set<string>([
  "NASA", "NATO", "OPEC", "UNESCO", "UNICEF", "FIFA", "LASER", "RADAR", "SONAR",
  "SCUBA", "PIN", "RAM", "ROM", "SIM", "GIF", "JPEG", "MPEG", "BIOS", "CMOS",
  "DARPA", "ARPA", "FEMA", "OSHA", "NAFTA", "ASEAN", "BRICS", "CERN", "NORAD",
  "PAC", "SUPERPAC", "STEM", "SWAT", "POTUS", "SCOTUS", "FLOTUS", "DAQ", "NASDAQ",
  "GAAP", "FICO", "LIBOR", "SOFR", "CAD", "CAM", "LIDAR",
]);

export const MULTI_CONVENTION_ACRONYMS = new Set<string>([
  "FERC", "ISO", "NEM", "NERC", "WECC", "SERC", "TRE", "PUCT", "CPUC", "IEEE",
]);

export const ORDINARY_UPPERCASE_WORDS = new Set<string>([
  "NOW", "NEVER", "POWER", "HUMAN", "TESLA", "ROBOT", "BOTTOM", "TRUE", "FALSE",
  "YES", "NO", "NOT", "AND", "OR", "BUT", "FOR", "NOR", "YET", "SO",
  "THE", "THIS", "THAT", "THESE", "THOSE", "HERE", "THERE", "WHERE", "WHEN", "WHY", "HOW",
  "WHAT", "WHICH", "ALL", "ANY", "SOME", "ONE", "TWO", "THREE", "FOUR", "FIVE",
  "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ZERO", "BIG", "NEW", "OLD", "GOOD", "BAD",
  "HIGH", "LOW", "UP", "DOWN", "IN", "OUT", "ON", "OFF", "OVER", "UNDER", "AGAIN",
  "MORE", "MOST", "LESS", "LEAST", "ONLY", "JUST", "EVEN", "STILL", "ALREADY",
  "ALWAYS", "OFTEN", "SOMETIMES", "TODAY", "TOMORROW", "YESTERDAY", "TONIGHT",
  "YEAR", "YEARS", "MONTH", "WEEK", "DAY", "DAYS", "HOUR", "HOURS", "TIME", "TIMES",
  "LIFE", "WORLD", "WORK", "HOME", "HOUSE", "CAR", "CARS", "GRID", "ENERGY", "SOLAR",
  "BATTERY", "SYSTEM", "MODEL", "MODELS", "PRICE", "COST", "COSTS", "RATE", "RATES",
  "BILL", "BILLS", "CASH", "MONEY", "BANK", "MARKET", "NEWS", "BREAKING", "ALERT",
  "WARNING", "DANGER", "STOP", "START", "GO", "RUN", "FAST", "SLOW", "FREE", "LIVE",
  "REAL", "FAKE", "FINAL", "FIRST", "LAST", "NEXT", "BEST", "WORST", "TOP", "FULL",
  "EMPTY", "OPEN", "CLOSE", "CLOSED", "SAFE", "RISK", "HUGE", "MASSIVE", "GIANT",
  "TINY", "SMALL", "LARGE", "GREAT", "MEGA", "ULTRA", "SUPER", "PRO", "MAX", "PLUS",
  "MINI", "AIR", "LITE",
]);

const INSTITUTIONAL_HEAD_NOUNS = new Set<string>([
  "cooperative", "co-op", "coop", "utility", "program", "initiative", "commission",
  "authority", "agency", "department", "board", "council", "association", "federation",
  "alliance", "coalition", "syndicate", "corporation", "committee", "institute",
  "foundation", "organization", "organisation", "bureau", "office", "ministry",
  "administration", "network", "grid", "market", "tariff", "standard", "protocol",
  "directive", "regulation", "act", "report", "guidelines",
]);

const US_NOUN_FOLLOWERS = new Set<string>([
  "government", "economy", "dollar", "dollars", "treasury", "senate", "congress",
  "president", "military", "navy", "army", "marines", "air", "citizens", "consumers",
  "households", "homeowners", "market", "markets", "states", "state", "department",
  "Supreme", "court", "federal", "officials", "regulators", "grid", "energy",
  "exports", "imports", "tariffs", "sanctions", "debt", "gdp", "inflation", "stocks",
  "equities", "bonds", "yields", "manufacturing", "production", "oil", "gas",
  "utilities", "customers", "workers", "voters", "public", "law", "laws", "policy",
  "policies", "constitution", "border", "history", "territory", "soil", "allies",
  "troops", "forces", "intelligence", "embassy", "administration", "agency", "census",
  "postal", "patent", "customs", "attorney", "marshal", "marshals", "mint", "chamber",
]);

const US_OBJECT_PREDECESSORS = new Set<string>([
  "help", "helped", "helps", "helping", "tell", "told", "tells", "telling",
  "give", "gave", "gives", "giving", "show", "showed", "shows", "showing",
  "let", "lets", "letting", "make", "made", "makes", "making", "allow", "allowed",
  "allows", "force", "forced", "forces", "cost", "costs", "save", "saved", "saves",
  "bring", "brought", "brings", "send", "sent", "sends", "ask", "asked", "asks",
  "call", "called", "calls", "join", "joined", "contact", "remind", "teach", "taught",
  "protect", "warn", "warned", "lead", "led", "keep", "kept", "leave", "left",
  "pay", "paid", "watch", "hear", "heard", "see", "saw", "meet", "met", "hit",
  "affect", "affected", "affects", "for", "with", "to", "from", "around", "between",
  "among", "against", "without", "like", "before", "after", "behind", "above", "below",
  "near", "of", "on", "upon",
]);

const IT_TECH_FOLLOWERS = new Set<string>([
  "department", "departments", "infrastructure", "system", "systems", "security",
  "support", "service", "services", "budget", "budgets", "team", "teams", "staff",
  "manager", "managers", "director", "directors", "industry", "sector", "company",
  "companies", "consulting", "operations", "governance", "architecture", "professional",
  "professionals", "specialist", "specialists", "admin", "admins", "administrator",
  "administrators", "equipment", "hardware", "software", "network", "networks",
  "spending", "solution", "solutions", "strategy", "project", "projects", "leader",
  "leaders", "workforce", "outage", "outages", "modernization", "vendor", "vendors",
]);

const IT_TECH_PREDECESSORS = new Set<string>([
  "corporate", "enterprise", "global", "healthcare", "modern", "internal", "outsourced",
  "federal", "municipal", "managed", "cloud",
]);

const SEC_COMMISSION_FOLLOWERS = new Set<string>([
  "filing", "filings", "chair", "chairman", "commissioner", "commissioners", "rule",
  "rules", "regulation", "regulations", "investigation", "investigations", "enforcement",
  "probe", "approval", "approvals", "lawsuit", "report", "reports", "disclosure",
  "disclosures", "staff", "officials", "guidance", "mandate", "action", "complaint",
  "charges", "settlement", "fine", "fines", "registration", "form", "forms",
]);

const EN_DIGITS: Record<string, string> = {
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
  "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
};

const EN_TEENS_TENS: Record<number, string> = {
  10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen",
  15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen",
  20: "twenty",
};

const VI_DIGITS: Record<string, string> = {
  "0": "không", "1": "một", "2": "hai", "3": "ba", "4": "bốn",
  "5": "năm", "6": "sáu", "7": "bảy", "8": "tám", "9": "chín",
};

const VI_TEENS_TENS: Record<number, string> = {
  10: "mười", 11: "mười một", 12: "mười hai", 13: "mười ba", 14: "mười bốn",
  15: "mười lăm", 16: "mười sáu", 17: "mười bảy", 18: "mười tám", 19: "mười chín",
  20: "hai mươi",
};

function versionTokenToWords(verStr: string, lang: "en" | "vi"): string {
  const digMap = lang === "vi" ? VI_DIGITS : EN_DIGITS;
  const teenMap = lang === "vi" ? VI_TEENS_TENS : EN_TEENS_TENS;
  const pointWord = lang === "vi" ? "chấm" : "point";

  function intPartToWord(part: string): string {
    const val = Number.parseInt(part, 10);
    if (!Number.isNaN(val)) {
      if (val >= 0 && val <= 9) return digMap[String(val)];
      if (teenMap[val]) return teenMap[val];
    }
    return part.split("").map((ch) => digMap[ch] ?? ch).join(" ");
  }

  if (verStr.includes(".")) {
    const parts = verStr.split(".");
    const spokenParts = [intPartToWord(parts[0])];
    for (const frac of parts.slice(1)) {
      spokenParts.push(pointWord);
      if (frac.length === 1 && digMap[frac]) {
        spokenParts.push(digMap[frac]);
      } else {
        spokenParts.push(intPartToWord(frac));
      }
    }
    return spokenParts.join(" ");
  }
  return intPartToWord(verStr);
}

const VERSION_NUMBER_RE = new RegExp(
  "\\b(?<head>" +
    "Powerwall|Megapack|Supercharger|Cybercab|Cybertruck|Starship|Falcon|" +
    "Model\\s+[A-Z]|Model|" +
    "iPhone|iPad|MacBook|AirPods|Apple\\s+Watch|Vision\\s+Pro|HomePod|" +
    "Galaxy\\s+S|Galaxy\\s+Z|Galaxy|Pixel|PlayStation|Xbox|" +
    "Windows|macOS|iOS|iPadOS|watchOS|Android|Ubuntu|" +
    "GPT|Claude|Gemini|Llama|Qwen|DeepSeek|OmniVoice|Chatterbox|" +
    "NEM|IEEE|USB|HDMI|PCIe|Wi-?Fi|Bluetooth|Web|HTTP|" +
    "Version|Ver|Release|Gen|Generation|Phase|Stage|Tier|Mark|Mk|Type|Level|" +
    "Phiên\\s+bản|Thế\\s+hệ|Đời|Giai\\s+đoạn|Cấp\\s+độ|Tầng|Bước" +
  ")\\s+(?<ver>\\d{1,2}(?:\\.\\d{1,2}){0,2})\\b(?![.\\d])" +
  "(?!\\s*(?:%|°C|°F|(?:percent|phần\\s+trăm|kWh|MWh|GWh|kW|MW|GW|Hz|mAh|Ah|" +
    "GB|TB|MB|KB|GHz|MHz|fps|ms|sec|seconds|minutes|hours|days|weeks|months|years|" +
    "giây|phút|giờ|ngày|tuần|tháng|năm|triệu|tỷ|nghìn|ngàn|đồng|USD|EUR|" +
    "dollars?|cents?|bucks?|kg|mg|lb|lbs|oz|km|cm|mm|mi|ft|" +
    "degrees?|độ)\\b))",
  "giu"
);

function isAllCapsSentence(text: string): boolean {
  const words = text.match(/[A-Za-z\u00C0-\u1EF9]{2,}/g) ?? [];
  if (words.length < 3) return false;
  const upperCount = words.filter((w) => w === w.toUpperCase()).length;
  return upperCount / words.length >= 0.75;
}

function extractParentheticalDefinedAcronyms(text: string): Set<string> {
  const defined = new Set<string>();
  const rx = /\(([A-Z]{2,6})\)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const cand = m[1];
    if (!ORDINARY_UPPERCASE_WORDS.has(cand) && !PRONOUNCEABLE_ACRONYMS.has(cand)) {
      defined.add(cand);
    }
  }
  return defined;
}

export function formatLetterSequenceForEngine(
  letters: string[],
  pluralSuffix: string = ""
): string {
  const upperParts = letters.map((p) => (p.length === 1 ? p.toUpperCase() : p));
  const base = upperParts.join(" ");
  return pluralSuffix ? `${base} ${pluralSuffix.toLowerCase()}` : base;
}

export interface PrepareSpokenTextOptions {
  language?: string;
  engine?: string;
  rules?: PronunciationRule[];
}

export function prepareSpokenText(
  sourceText: string,
  options: PrepareSpokenTextOptions = {}
): PreparedSpokenTextResult {
  if (!sourceText || !sourceText.trim()) {
    return {
      sourceText,
      spokenText: sourceText,
      pronunciationMapping: [],
    };
  }

  const langNorm = (options.language ?? "").trim().toLowerCase();
  const langCode: "en" | "vi" =
    langNorm === "vi" || langNorm === "vietnamese"
      ? "vi"
      : langNorm === "en" || langNorm === "english"
      ? "en"
      : /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(
          sourceText
        )
      ? "vi"
      : "en";

  const isAllCapsCtx = isAllCapsSentence(sourceText);
  const definedAcronyms = extractParentheticalDefinedAcronyms(sourceText);

  // Deduplicate & sort user rules: Project > Global, then longest match first
  const validRules = (options.rules ?? []).filter(
    (r) => r.enabled && r.sourceText && r.sourceText.trim().length > 0
  );
  const projectRules = validRules.filter((r) => r.scope === "project");
  const projectKeysLower = new Set(
    projectRules.map((r) => r.sourceText.trim().toLowerCase())
  );
  const dedupRules = [
    ...projectRules,
    ...validRules.filter(
      (r) =>
        r.scope !== "project" &&
        !projectKeysLower.has(r.sourceText.trim().toLowerCase())
    ),
  ].sort((a, b) => {
    const tierA = a.scope === "project" ? 0 : 1;
    const tierB = b.scope === "project" ? 0 : 1;
    if (tierA !== tierB) return tierA - tierB;
    return b.sourceText.trim().length - a.sourceText.trim().length;
  });

  interface ClaimedReplacement {
    start: number;
    end: number;
    replacement: string;
    entry: PronunciationMappingEntry | null;
  }

  const claimed: ClaimedReplacement[] = [];
  const overlaps = (s: number, e: number): boolean =>
    claimed.some((c) => s < c.end && e > c.start);

  // Step 1: Protect bracketed inline tags `[...]`
  const bracketRx = /\[[^[\]\n]{1,64}\]/g;
  let bm: RegExpExecArray | null;
  while ((bm = bracketRx.exec(sourceText)) !== null) {
    claimed.push({
      start: bm.index,
      end: bm.index + bm[0].length,
      replacement: bm[0],
      entry: null,
    });
  }

  // Step 2: Claim Tier 1 (Project) & Tier 2 (Global) user pronunciation rules
  for (const rule of dedupRules) {
    const rx = buildRuleRegex(rule);
    let m: RegExpExecArray | null;
    while ((m = rx.exec(sourceText)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      if (!overlaps(s, e)) {
        const category: PronunciationMappingCategory =
          rule.scope === "project" ? "project_rule" : "global_rule";
        const parts = rule.spokenText
          .trim()
          .split(/[\s\-.,]+/)
          .filter(Boolean);
        const isLetterSeq =
          parts.length >= 2 && parts.every((p) => /^[A-Za-z]$/.test(p));
        const expectedLetters = isLetterSeq
          ? parts.map((p) => p.toLowerCase())
          : undefined;
        claimed.push({
          start: s,
          end: e,
          replacement: rule.spokenText,
          entry: {
            sourceSpan: m[0],
            spokenForm: rule.spokenText,
            startIndex: s,
            endIndex: e,
            category,
            mode: isLetterSeq ? "letter_by_letter" : "custom",
            expectedLetters,
            allowedForms: [rule.spokenText.toLowerCase(), m[0].toLowerCase()],
          },
        });
      }
      if (m[0].length === 0) rx.lastIndex++;
    }
  }

  // Step 3: Claim version number suffixes (e.g. "3" in "Powerwall 3", "3.0" in "NEM 3.0")
  VERSION_NUMBER_RE.lastIndex = 0;
  let vm: RegExpExecArray | null;
  while ((vm = VERSION_NUMBER_RE.exec(sourceText)) !== null) {
    const fullMatch = vm[0];
    const verStr = vm.groups?.ver ?? "";
    const verStart = vm.index + fullMatch.lastIndexOf(verStr);
    const verEnd = verStart + verStr.length;
    if (verStr && !overlaps(verStart, verEnd)) {
      const spokenVer = versionTokenToWords(verStr, langCode);
      claimed.push({
        start: verStart,
        end: verEnd,
        replacement: spokenVer,
        entry: {
          sourceSpan: verStr,
          spokenForm: spokenVer,
          startIndex: verStart,
          endIndex: verEnd,
          category: "version_entity",
          mode: "word",
          allowedForms: [spokenVer.toLowerCase(), verStr.toLowerCase()],
        },
      });
    }
  }

  // Step 4: Scan tokens across full text for Tiers 3, 4, 5
  const tokenScanRx =
    /(?:[A-Z]\.){2,6}|[A-Z]{1,3}&[A-Z]{1,3}|[A-Za-z0-9\u00C0-\u1EF9]+(?:-[A-Za-z0-9\u00C0-\u1EF9]+)*/g;
  const tokens: Array<{ text: string; start: number; end: number }> = [];
  let tm: RegExpExecArray | null;
  while ((tm = tokenScanRx.exec(sourceText)) !== null) {
    tokens.push({
      text: tm[0],
      start: tm.index,
      end: tm.index + tm[0].length,
    });
  }

  const isNonAcronymCapsWord = (w: string): boolean => {
    const base =
      w.length >= 3 && w.endsWith("s") && /^[A-Z]+$/.test(w.slice(0, -1))
        ? w.slice(0, -1)
        : w;
    return (
      base.length >= 2 &&
      base === base.toUpperCase() &&
      /[A-Z]/.test(base) &&
      !VERIFIED_INITIALISMS.has(base) &&
      !PRONOUNCEABLE_ACRONYMS.has(base) &&
      !MULTI_CONVENTION_ACRONYMS.has(base)
    );
  };

  const sameClauseAllCaps = (i1: number, i2: number): boolean => {
    const loIdx = Math.min(i1, i2);
    const hiIdx = Math.max(i1, i2);
    const betweenStr = sourceText.slice(tokens[loIdx].end, tokens[hiIdx].start);
    if (/[.!?:;…\n\r]/.test(betweenStr)) return false;
    for (let midIdx = loIdx + 1; midIdx < hiIdx; midIdx++) {
      if (/[a-z\u00E0-\u1EF9]/.test(tokens[midIdx].text)) return false;
    }
    return true;
  };

  const isAtSentenceStart = (pos: number): boolean => {
    const prefix = sourceText.slice(0, pos);
    if (!prefix.trim()) return true;
    return /[.!?…\n\r]\s*["'“”‘’(\[]*\s*$/.test(prefix);
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (overlaps(tok.start, tok.end)) continue;

    const token = tok.text;
    const prevLower = (tokens[i - 1]?.text ?? "").replace(/[^\w\u00C0-\u1EF9-]/g, "").toLowerCase();
    const prev2Lower = (tokens[i - 2]?.text ?? "").replace(/[^\w\u00C0-\u1EF9-]/g, "").toLowerCase();
    const nextLower = (tokens[i + 1]?.text ?? "").replace(/[^\w\u00C0-\u1EF9-]/g, "").toLowerCase();

    let tokenIsAllCapsCtx = isAllCapsCtx;
    if (
      !tokenIsAllCapsCtx &&
      token === token.toUpperCase() &&
      /[A-Z]/.test(token)
    ) {
      for (const nbIdx of [i - 2, i - 1, i + 1, i + 2]) {
        if (
          nbIdx >= 0 &&
          nbIdx < tokens.length &&
          isNonAcronymCapsWord(tokens[nbIdx].text) &&
          sameClauseAllCaps(i, nbIdx)
        ) {
          tokenIsAllCapsCtx = true;
          break;
        }
      }
    }

    let classification: {
      spokenForm: string;
      category: PronunciationMappingCategory;
      mode: PronunciationMappingMode;
      expectedLetters?: string[];
      allowedForms?: string[];
      forbiddenWords?: string[];
    } | null = null;

    if (AMPERSAND_INITIALISMS[token]) {
      const amp = AMPERSAND_INITIALISMS[token];
      classification = {
        spokenForm: amp.spoken,
        category: "verified_dict",
        mode: "letter_by_letter",
        expectedLetters: amp.letters,
        allowedForms: [amp.spoken.toLowerCase(), token.toLowerCase()],
      };
    } else if (/^(?:[A-Z]\.){2,6}$/.test(token)) {
      const letters = token
        .replace(/\./g, "")
        .split("")
        .map((c) => c.toLowerCase());
      const spoken = formatLetterSequenceForEngine(letters);
      classification = {
        spokenForm: spoken,
        category: "verified_dict",
        mode: "letter_by_letter",
        expectedLetters: letters,
        allowedForms: [spoken.toLowerCase(), letters.join("")],
      };
    } else if (VERIFIED_MIXED_INITIALISMS[token]) {
      const parts = VERIFIED_MIXED_INITIALISMS[token];
      const spoken = formatLetterSequenceForEngine(parts);
      classification = {
        spokenForm: spoken,
        category: "verified_dict",
        mode: "letter_by_letter",
        expectedLetters: parts.filter((p) => p.length === 1),
        allowedForms: [spoken.toLowerCase(), token.toLowerCase()],
      };
    } else {
      let baseToken = token;
      let pluralSuffix = "";
      if (
        token.length >= 3 &&
        token.endsWith("s") &&
        /^[A-Z]+$/.test(token.slice(0, -1))
      ) {
        baseToken = token.slice(0, -1);
        pluralSuffix = "s";
      }

      if (token === "BOT") {
        classification = {
          spokenForm: "bot",
          category: "verified_dict",
          mode: "word",
          allowedForms: ["bot"],
        };
      } else if (PRONOUNCEABLE_ACRONYMS.has(baseToken)) {
        classification = {
          spokenForm: token,
          category: "verified_dict",
          mode: "word",
          allowedForms: [token.toLowerCase()],
        };
      } else if (MULTI_CONVENTION_ACRONYMS.has(baseToken)) {
        const letters = baseToken.split("").map((c) => c.toLowerCase());
        classification = {
          spokenForm: token,
          category: "verified_dict",
          mode: "preserve",
          allowedForms: [token.toLowerCase(), letters.join(" ")],
        };
      } else if (
        VERIFIED_INITIALISMS.has(baseToken) &&
        !["WHO", "US", "IT", "SEC"].includes(baseToken)
      ) {
        const letters = baseToken.split("").map((c) => c.toLowerCase());
        const spoken = formatLetterSequenceForEngine(letters, pluralSuffix);
        classification = {
          spokenForm: spoken,
          category: "verified_dict",
          mode: "letter_by_letter",
          expectedLetters: letters,
          allowedForms: [spoken.toLowerCase(), baseToken.toLowerCase()],
        };
      } else if (tokenIsAllCapsCtx) {
        classification = null;
      } else if (token === "WHO") {
        const isOrgCtx =
          ["the", "from", "by", "at", "with", "said", "says", "told", "un"].includes(prevLower) ||
          (prev2Lower === "according" && prevLower === "to") ||
          [
            "director", "director-general", "chief", "officials", "guidelines",
            "report", "data", "warning", "declared", "announced", "recommends",
            "estimates", "panel", "experts", "team", "headquarters", "member", "members",
          ].includes(nextLower);
        if (isOrgCtx) {
          const letters = ["w", "h", "o"];
          const spoken = formatLetterSequenceForEngine(letters);
          classification = {
            spokenForm: spoken,
            category: "auto_context",
            mode: "letter_by_letter",
            expectedLetters: letters,
            allowedForms: ["w h o", "double u h o", "world health organization"],
            forbiddenWords: ["who"],
          };
        }
      } else if (token === "US") {
        const isPronounObj = US_OBJECT_PREDECESSORS.has(prevLower);
        const isCountryCtx =
          !isPronounObj &&
          (["the", "in", "across", "into", "outside", "within", "both"].includes(prevLower) ||
            US_NOUN_FOLLOWERS.has(nextLower));
        if (isCountryCtx) {
          const letters = ["u", "s"];
          const spoken = formatLetterSequenceForEngine(letters);
          classification = {
            spokenForm: spoken,
            category: "auto_context",
            mode: "letter_by_letter",
            expectedLetters: letters,
            allowedForms: ["u s", "united states"],
            forbiddenWords: ["us"],
          };
        }
      } else if (token === "IT") {
        const isTechCtx =
          IT_TECH_FOLLOWERS.has(nextLower) ||
          IT_TECH_PREDECESSORS.has(prevLower) ||
          (["in", "of", "for", "our", "their", "your"].includes(prevLower) &&
            IT_TECH_FOLLOWERS.has(nextLower));
        if (isTechCtx) {
          const letters = ["i", "t"];
          const spoken = formatLetterSequenceForEngine(letters);
          classification = {
            spokenForm: spoken,
            category: "auto_context",
            mode: "letter_by_letter",
            expectedLetters: letters,
            allowedForms: ["i t", "information technology"],
            forbiddenWords: ["it"],
          };
        }
      } else if (token === "SEC") {
        const isSecondsCtx =
          /^\d+$/.test(prevLower) ||
          ["a", "one", "1", "few", "wait", "per", "every"].includes(prevLower);
        const isCommissionCtx =
          !isSecondsCtx &&
          (["the", "us", "u.s.", "by", "with", "from", "to"].includes(prevLower) ||
            SEC_COMMISSION_FOLLOWERS.has(nextLower));
        if (isCommissionCtx) {
          const letters = ["s", "e", "c"];
          const spoken = formatLetterSequenceForEngine(letters);
          classification = {
            spokenForm: spoken,
            category: "auto_context",
            mode: "letter_by_letter",
            expectedLetters: letters,
            allowedForms: ["s e c"],
            forbiddenWords: ["sec"],
          };
        }
      } else if (
        !ORDINARY_UPPERCASE_WORDS.has(token) &&
        /^[A-Z]{2,5}$/.test(token)
      ) {
        const isDefined = definedAcronyms.has(token);
        const isInstitutionalNp =
          ["the", "a", "an", "their", "this", "its", "our"].includes(prevLower) &&
          INSTITUTIONAL_HEAD_NOUNS.has(nextLower);
        if (isDefined || isInstitutionalNp) {
          const letters = token.split("").map((c) => c.toLowerCase());
          const spoken = formatLetterSequenceForEngine(letters);
          classification = {
            spokenForm: spoken,
            category: "auto_context",
            mode: "letter_by_letter",
            expectedLetters: letters,
            allowedForms: [spoken.toLowerCase(), token.toLowerCase()],
          };
        }
      }
    }

    if (classification) {
      claimed.push({
        start: tok.start,
        end: tok.end,
        replacement: classification.spokenForm,
        entry: {
          sourceSpan: token,
          spokenForm: classification.spokenForm,
          startIndex: tok.start,
          endIndex: tok.end,
          category: classification.category,
          mode: classification.mode,
          expectedLetters: classification.expectedLetters,
          allowedForms: classification.allowedForms,
          forbiddenWords: classification.forbiddenWords,
        },
      });
    } else if (
      tokenIsAllCapsCtx &&
      token === token.toUpperCase() &&
      /[A-Z]/.test(token) &&
      (token.length >= 2 || token === "A")
    ) {
      const normWord =
        isAtSentenceStart(tok.start) || token === "TESLA"
          ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
          : token.toLowerCase();
      claimed.push({
        start: tok.start,
        end: tok.end,
        replacement: normWord,
        entry: null,
      });
    } else {
      const mSci =
        /^(piezo|magneto|thermo|electro|chemo|mechano|tribo|acousto|vibro)(resist(?:ive|ivity|or|ors|ance)|luminescen(?:t|ce)|responsive)$/i.exec(
          token
        );
      if (mSci) {
        claimed.push({
          start: tok.start,
          end: tok.end,
          replacement: `${mSci[1]}-${mSci[2].toLowerCase()}`,
          entry: null,
        });
      }
    }
  }

  if (claimed.length === 0) {
    return {
      sourceText,
      spokenText: sourceText,
      pronunciationMapping: [],
    };
  }

  claimed.sort((a, b) => a.start - b.start);
  let spokenText = "";
  let lastIdx = 0;
  const mapping: PronunciationMappingEntry[] = [];

  for (const c of claimed) {
    if (c.start < lastIdx) continue;
    spokenText += sourceText.slice(lastIdx, c.start) + c.replacement;
    lastIdx = c.end;
    if (c.entry) {
      mapping.push(c.entry);
    }
  }
  spokenText += sourceText.slice(lastIdx);

  return {
    sourceText,
    spokenText,
    pronunciationMapping: mapping,
  };
}
