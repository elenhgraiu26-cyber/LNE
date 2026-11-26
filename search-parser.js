(function (root) {
  const rates = { USD: 1, EUR: 0.92, GBP: 0.79 };
  const squareFeetPerSquareMeter = 10.7639;
  const featureAliases = [
    { tag: "Traditional architecture", aliases: ["traditional architecture", "παραδοσιακη αρχιτεκτονικη", "architettura tradizionale", "architecture traditionnelle", "traditionelle architektur", "arquitectura tradicional"] },
    { tag: "Near metro", aliases: ["near metro transit", "near metro", "near a metro", "near the metro", "near transit", "close to metro", "close to the metro", "metro nearby", "κοντα σε μετρο", "διπλα στο μετρο", "vicino alla metro", "pres du metro", "u bahn nahe", "cerca del metro"] },
    { tag: "Quiet area", aliases: ["quiet area", "quiet neighborhood", "quiet neighbourhood", "ησυχη περιοχη", "zona tranquilla", "quartier calme", "ruhige lage", "zona tranquila"] },
    { tag: "New build", aliases: ["new build", "newly built", "νεοδμητο", "nuova costruzione", "construction recente", "neubau", "obra nueva"] },
    { tag: "Sea view", aliases: ["sea view", "sea views", "ocean view", "view of the sea", "θεα θαλασσα", "θεα στη θαλασσα", "vista mare", "vue sur mer", "meerblick", "vistas al mar"] },
    { tag: "Penthouse", aliases: ["penthouse", "ρετιρε", "attico", "appartement en dernier etage", "atico"] },
    { tag: "Investment", aliases: ["investment", "επενδυτικο", "investimento", "investissement", "anlageobjekt", "inversion"] },
    { tag: "Balcony", aliases: ["balcony", "balconies", "terrace", "terrace", "μπαλκονι", "βεραντα", "balcone", "balcon", "balkon", "balcon"] },
    { tag: "Garden", aliases: ["garden", "κηπος", "κηπο", "giardino", "jardin", "garten"] }
  ];
  const areaUnitPattern = "(?:sq\\.?\\s*(?:m|meters?|metres?|ft|feet|foot)|sqm|sqft|m²|m2|ft²|ft2|square\\s*(?:meters?|metres?|feet|foot)|τ\\.?\\s*μ\\.?|τετραγωνικα\\s+μετρα)";
  const currencyPattern = "(?:€|\\$|£|eur|euros?|usd|dollars?|gbp|pounds?)";
  const numberPattern = "\\d+(?:(?:,|\\.)\\d{3})*(?:[.,]\\d+)?";
  const stopWords = new Set([
    "a", "an", "and", "apartment", "apartments", "at", "flat", "flats", "find", "for", "home", "homes", "house", "houses",
    "above", "at", "below", "between", "euros", "exact", "exactly", "from", "i", "in", "least", "less", "looking", "max", "maximum", "me", "min", "minimum",
    "more", "most", "near", "of", "or", "over", "please", "price", "property", "properties", "rent", "search", "than", "the", "to",
    "under", "up", "want", "with",
    "διαμερισμα", "διαμερισματα", "ζηταω", "κατοικια", "κατοικιες", "με", "μου", "να", "σε", "σπιτι", "σπιτια", "στο", "στη",
    "στην", "τα", "το", "των", "ψαχνω", "για", "και", "ενα", "μια", "με", "και", "εχω", "θελω", "κοντα", "απο", "ακριβως"
  ]);
  const genericUnitWords = new Set([
    "bed", "beds", "bedroom", "bedrooms", "bath", "baths", "bathroom", "bathrooms", "br",
    "υπνοδωματιο", "υπνοδωματια", "μπανιο", "μπανια", "δωματιο", "δωματια"
  ]);
  const genericHomeWords = new Set([
    "apartment", "flat", "home", "house", "property", "διαμερισμα", "κατοικια", "σπιτι"
  ]);

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase()
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseNumber(value) {
    const text = value.replace(/\s/g, "");
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) return Number(text.replace(/,/g, ""));
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) return Number(text.replace(/\./g, "").replace(",", "."));
    return Number(text.replace(",", "."));
  }

  function currencyCode(value, defaultCurrency) {
    if (!value) return defaultCurrency;
    if (value.includes("€") || /\beur|euro/.test(value)) return "EUR";
    if (value.includes("£") || /\bgbp|pound/.test(value)) return "GBP";
    return "USD";
  }

  function convertToUsd(value, currency, converter) {
    if (converter) return converter(value, currency, "USD");
    return value / rates[currency];
  }

  function mergeBound(current, next, bound) {
    if (!Number.isFinite(next) || next < 0) return current;
    if (!current) return { min: null, max: null, [bound]: next };
    const previous = current[bound];
    current[bound] = previous === null ? next : bound === "min" ? Math.max(previous, next) : Math.min(previous, next);
    return current;
  }

  function parseQuery(query, convertCurrency, defaultCurrency = "EUR") {
    let remaining = normalize(query);
    const filters = {
      area: null,
      budget: null,
      bedrooms: null,
      bathrooms: null,
      features: [],
      location: null
    };

    const addArea = (min, max, unit) => {
      const factor = /ft|feet|foot/.test(unit) ? squareFeetPerSquareMeter : 1;
      if (min !== null) filters.area = mergeBound(filters.area, min / factor, "min");
      if (max !== null) filters.area = mergeBound(filters.area, max / factor, "max");
    };
    const addBudget = (min, max, currency) => {
      if (min !== null) filters.budget = mergeBound(filters.budget, convertToUsd(min, currency, convertCurrency), "min");
      if (max !== null) filters.budget = mergeBound(filters.budget, convertToUsd(max, currency, convertCurrency), "max");
    };

    const areaRange = new RegExp(`(${numberPattern})\\s*(${areaUnitPattern})?\\s*(?:-|\\bto\\b|\\band\\b|εως)\\s*(${numberPattern})\\s*(${areaUnitPattern})`, "gu");
    remaining = remaining.replace(areaRange, (whole, first, firstUnit = "", second, secondUnit = "") => {
      const unit = firstUnit || secondUnit;
      addArea(parseNumber(first), parseNumber(second), unit);
      return " ";
    });

    const bedroomRangePattern = new RegExp(`(${numberPattern})\\s*(?:-|\\bto\\b)\\s*(${numberPattern})\\s*(?:bedrooms?|beds?|υπνοδωματια|υπνοδωματιο|δωματια|δωματιο)`, "gu");
    remaining = remaining.replace(bedroomRangePattern, (whole, lower, upper) => {
      filters.bedrooms = { min: parseNumber(lower), max: parseNumber(upper) };
      return " ";
    });

    const bathroomRangePattern = new RegExp(`(${numberPattern})\\s*(?:-|\\bto\\b)\\s*(${numberPattern})\\s*(?:bathrooms?|baths?|μπανια|μπανιο)`, "gu");
    remaining = remaining.replace(bathroomRangePattern, (whole, lower, upper) => {
      filters.bathrooms = { min: parseNumber(lower), max: parseNumber(upper) };
      return " ";
    });

    const moneyRange = new RegExp(`(${currencyPattern})?\\s*(${numberPattern})\\s*(?:-|\\bto\\b)\\s*(${currencyPattern})?\\s*(${numberPattern})\\s*(${currencyPattern})?`, "gu");
    remaining = remaining.replace(moneyRange, (whole, prefixCurrency = "", first, middleCurrency = "", second, suffixCurrency = "") => {
      const currency = currencyCode(`${prefixCurrency} ${middleCurrency} ${suffixCurrency}`, defaultCurrency);
      const lower = parseNumber(first);
      const upper = parseNumber(second);
      const hasCurrency = Boolean(prefixCurrency || middleCurrency || suffixCurrency);
      if (!hasCurrency && Math.max(lower, upper) <= 200) addArea(lower, upper, "sqm");
      else addBudget(lower, upper, currency);
      return " ";
    });

    const numericBedroomPattern = new RegExp(`(?:(?:at\\s+least|minimum|min|more\\s+than|over|τουλαχιστον|πανω\\s+απο)\\s*)?(${numberPattern})(\\s*\\+)?\\s*[- ]?\\s*(?:bedrooms?|beds?|br|υπνοδωματια|υπνοδωματιο|δωματια|δωματιο)`, "gu");
    remaining = remaining.replace(numericBedroomPattern, (whole, value, plus = "") => {
      const count = parseNumber(value);
      const isMinimum = Boolean(plus) || /(?:at least|minimum|min|more than|over|τουλαχιστον|πανω απο)/.test(whole);
      filters.bedrooms = isMinimum
        ? mergeBound(filters.bedrooms, count, "min")
        : { min: count, max: count };
      return " ";
    });

    const numericBathroomPattern = new RegExp(`(?:(?:at\\s+least|minimum|min|more\\s+than|over|τουλαχιστον|πανω\\s+απο)\\s*)?(${numberPattern})(\\s*\\+)?\\s*[- ]?\\s*(?:bathrooms?|baths?|μπανια|μπανιο)`, "gu");
    remaining = remaining.replace(numericBathroomPattern, (whole, value, plus = "") => {
      const count = parseNumber(value);
      const isMinimum = Boolean(plus) || /(?:at least|minimum|min|more than|over|τουλαχιστον|πανω απο)/.test(whole);
      filters.bathrooms = isMinimum
        ? mergeBound(filters.bathrooms, count, "min")
        : { min: count, max: count };
      return " ";
    });

    const simpleLimitPattern = new RegExp(`(<=|≥|>=|≤|<|>|under|below|less\\s+than|up\\s+to|at\\s+most|maximum|max|no\\s+more\\s+than|over|above|more\\s+than|at\\s+least|minimum|min|μεχρι|εως|το\\s+πολυ|λιγοτερο\\s+απο|πανω\\s+απο|τουλαχιστον|κατω\\s+απο)\\s*(${currencyPattern})?\\s*(${numberPattern})\\s*(${areaUnitPattern}|${currencyPattern})?`, "gu");
    remaining = remaining.replace(simpleLimitPattern, (whole, operator, prefixCurrency = "", rawValue, suffix = "") => {
      const value = parseNumber(rawValue);
      const suffixIsArea = new RegExp(areaUnitPattern, "u").test(suffix);
      const money = `${prefixCurrency} ${suffix}`;
      const hasCurrency = new RegExp(currencyPattern, "u").test(money);
      const isMin = /^(?:>|≥|>=|over|above|more than|at least|minimum|min|πανω|τουλαχιστον)/.test(operator);
      if (suffixIsArea || (!hasCurrency && value <= 200)) {
        addArea(isMin ? value : null, isMin ? null : value, suffix);
      } else {
        addBudget(isMin ? value : null, isMin ? null : value, currencyCode(money, defaultCurrency));
      }
      return " ";
    });

    for (const feature of featureAliases) {
      for (const alias of [...feature.aliases].sort((a, b) => b.length - a.length)) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "gu");
        if (pattern.test(remaining)) {
          filters.features.push(feature.tag);
          remaining = remaining.replace(pattern, "$1 ");
        }
      }
    }

    remaining = remaining
      .replace(new RegExp(areaUnitPattern, "gu"), " ")
      .replace(new RegExp(currencyPattern, "gu"), " ")
      .replace(/(?:<=|>=|≤|≥|<|>|[€$£])/gu, " ")
      .replace(/[^\p{L}\p{N}' -]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const locationMarker = /(?:^|\s)(?:in|at|around|within|near|στο|στη|στην|σε|στης|κοντα\s+σε|περιοχη)\s+([\p{L}\p{N}][\p{L}\p{N}' -]*?)(?=\s+(?:and|with|near|και|με|κοντα)\s+|$)/u.exec(remaining);
    if (locationMarker) {
      const locationWords = locationMarker[1].split(/\s+/).filter((word) => !stopWords.has(word) && !genericHomeWords.has(word));
      const locationText = locationWords.join(" ");
      if (locationWords.length && !["park", "parks", "school", "schools", "shop", "shops", "metro", "beach", "coffee"].includes(locationText)) {
        filters.location = locationText;
        remaining = remaining.replace(locationMarker[0], " ");
      }
    }
    const textTerms = remaining.split(" ").filter((word) => word && !stopWords.has(word) && !genericUnitWords.has(word) && !genericHomeWords.has(word));
    filters.features = [...new Set(filters.features)];
    return { filters, textTerms };
  }

  root.parseQuery = parseQuery;
  if (typeof module !== "undefined" && module.exports) module.exports = { parseQuery };
})(typeof globalThis !== "undefined" ? globalThis : this);
