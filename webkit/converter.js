(function () {
  var FALLBACK_RUB_PER_KZT = 1 / 6;
  var CONFIG = window.KZT_RUB_CONVERTER_CONFIG || {};
  var RUB_PER_KZT = Number(CONFIG.rubPerKzt) > 0 ? Number(CONFIG.rubPerKzt) : FALLBACK_RUB_PER_KZT;
  var RATE_SOURCE = CONFIG.source || "Offline converter";
  var CONVERTED_CLASS = "kzt-rub-converted";
  var PROCESSED_ATTR = "data-kzt-rub-processed";
  var KZT_SYMBOL = "₸";
  var KZT_TG = "тг";
  var KZT_TENGE = "тенге";
  var CYRILLIC_T = "Т";
  var APPROX_SIGN = "≈";
  var RUB_SYMBOL = "₽";
  var KZT_SUFFIX_RE = new RegExp(
    "(\\d[\\d\\s.,]*)\\s*(?:" + KZT_SYMBOL + "|" + KZT_TG + "|" + KZT_TENGE + "|[T" + CYRILLIC_T + "])(?![A-Za-zА-Яа-яЁё])",
    "i"
  );
  var KZT_PREFIX_RE = new RegExp(
    "(?:" + KZT_SYMBOL + "|" + KZT_TG + "|" + KZT_TENGE + "|[T" + CYRILLIC_T + "])\\s*(\\d[\\d\\s.,]*)",
    "i"
  );
  var KZT_ANY_PRICE_RE = new RegExp(
    "(\\d[\\d\\s.,]*)\\s*(?:" + KZT_SYMBOL + "|" + KZT_TG + "|" + KZT_TENGE + "|[T" + CYRILLIC_T + "])(?![A-Za-zА-Яа-яЁё])|(?:" + KZT_SYMBOL + "|" + KZT_TG + "|" + KZT_TENGE + "|[T" + CYRILLIC_T + "])\\s*(\\d[\\d\\s.,]*)",
    "gi"
  );
  var PRICE_SELECTORS = [
    ".discount_final_price",
    ".discount_original_price",
    ".game_purchase_price",
    ".game_area_purchase_game .price",
    ".search_price",
    ".col.search_price",
    ".match_price",
    ".match_subtitle",
    ".tab_price",
    ".tab_item_discount_price",
    ".tab_item_top_tags + .tab_price",
    ".search_result_row .price",
    ".search_suggestion_contents .match_price",
    ".popup_menu_item .match_price",
    '[class*="StoreSalePriceBox"]',
    '[class*="StoreSalePrice"]',
    '[class*="SalePrice"]',
    '[class*="FinalPrice"]',
    '[class*="discount_final_price"]',
    '[class*="price"]',
    '[class*="Price"]',
    "[data-price-final]"
  ];
  var SKIP_TAGS = {
    SCRIPT: true,
    STYLE: true,
    TEXTAREA: true,
    INPUT: true
  };

  function isInsideSkippedTag(element) {
    var node = element;

    while (node && node.nodeType === 1) {
      if (SKIP_TAGS[node.tagName]) {
        return true;
      }
      node = node.parentElement;
    }

    return false;
  }

  function isInsideProcessedArea(element) {
    var node = element;

    while (node && node.nodeType === 1) {
      if (node.hasAttribute && node.hasAttribute(PROCESSED_ATTR)) {
        return true;
      }
      node = node.parentElement;
    }

    return false;
  }

  function logRate(message, level) {
    var method = level === "warn" ? "warn" : "info";

    if (window.console && window.console[method]) {
      window.console[method]("[kzt_rub_converter] " + message);
    }
  }

  function extractCandidateText(text) {
    if (!text) {
      return null;
    }

    var normalized = String(text).replace(/\u00a0/g, " ").trim();
    if (!normalized) {
      return null;
    }

    var lowered = normalized.toLowerCase();
    if (
      lowered.indexOf(KZT_SYMBOL.toLowerCase()) === -1 &&
      lowered.indexOf(KZT_TG) === -1 &&
      lowered.indexOf(KZT_TENGE) === -1 &&
      normalized.indexOf("T") === -1 &&
      normalized.indexOf(CYRILLIC_T) === -1
    ) {
      return null;
    }

    return normalized;
  }

  function parseKztNumber(text) {
    var normalized = String(text || "").replace(/\u00a0/g, " ").trim();
    var numeric;

    if (!normalized) {
      return null;
    }

    normalized = normalized.replace(/\s+/g, "");

    if (/[,.]\d{2}$/.test(normalized)) {
      normalized = normalized.replace(/[,.]\d{2}$/, "");
    }

    numeric = normalized.replace(/[^\d]/g, "");
    if (!numeric) {
      return null;
    }

    return parseInt(numeric, 10);
  }

  function parseKztPrice(text) {
    var candidate = extractCandidateText(text);
    var match;

    if (!candidate) {
      return null;
    }

    if (candidate.indexOf(APPROX_SIGN) !== -1 || candidate.indexOf(RUB_SYMBOL) !== -1) {
      return null;
    }

    match = candidate.match(KZT_SUFFIX_RE);
    if (!match) {
      match = candidate.match(KZT_PREFIX_RE);
    }

    if (!match || !match[1]) {
      return null;
    }

    return parseKztNumber(match[1]);
  }

  function formatRub(value) {
    return APPROX_SIGN + " " + new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 0
    }).format(value) + " " + RUB_SYMBOL;
  }

  function findAnchorNode(element) {
    var converted;
    var child;

    if (!element || element.nodeType !== 1) {
      return null;
    }

    converted = element.querySelector(":scope > ." + CONVERTED_CLASS);
    if (converted) {
      return null;
    }

    if (element.classList && element.classList.contains(CONVERTED_CLASS)) {
      return null;
    }

    for (child = element.lastElementChild; child; child = child.previousElementSibling) {
      if (child.classList && child.classList.contains(CONVERTED_CLASS)) {
        continue;
      }

      if (child.textContent && child.textContent.trim()) {
        return child;
      }
    }

    return element;
  }

  function processPriceElement(element) {
    var price;
    var rubValue;
    var converted;
    var anchor;

    if (!element || element.nodeType !== 1 || isInsideSkippedTag(element)) {
      return;
    }

    if (element.querySelector("." + CONVERTED_CLASS) || isInsideProcessedArea(element)) {
      return;
    }

    price = parseKztPrice(element.textContent);
    if (price === null) {
      return;
    }

    rubValue = Math.round(price * RUB_PER_KZT);
    converted = document.createElement("span");
    converted.className = CONVERTED_CLASS;
    converted.textContent = formatRub(rubValue);

    anchor = findAnchorNode(element);
    if (anchor && anchor !== element && anchor.parentNode === element) {
      anchor.insertAdjacentElement("afterend", converted);
      element.setAttribute(PROCESSED_ATTR, "1");
      return;
    }

    element.appendChild(converted);
    element.setAttribute(PROCESSED_ATTR, "1");
  }

  function processTextNode(textNode) {
    var text;
    var parent;
    var fragment;
    var lastIndex = 0;
    var match;
    var amountText;
    var price;
    var converted;
    var found = false;

    if (!textNode || textNode.nodeType !== 3) {
      return;
    }

    parent = textNode.parentElement;
    if (
      !parent ||
      isInsideSkippedTag(parent) ||
      isInsideProcessedArea(parent) ||
      parent.classList.contains(CONVERTED_CLASS) ||
      parent.querySelector(":scope > ." + CONVERTED_CLASS)
    ) {
      return;
    }

    text = textNode.nodeValue;
    if (!extractCandidateText(text)) {
      return;
    }

    fragment = document.createDocumentFragment();
    KZT_ANY_PRICE_RE.lastIndex = 0;

    while ((match = KZT_ANY_PRICE_RE.exec(text)) !== null) {
      amountText = match[1] || match[2];
      price = parseKztNumber(amountText);

      if (price === null) {
        continue;
      }

      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      fragment.appendChild(document.createTextNode(match[0]));

      converted = document.createElement("span");
      converted.className = CONVERTED_CLASS;
      converted.textContent = formatRub(Math.round(price * RUB_PER_KZT));
      fragment.appendChild(converted);

      lastIndex = KZT_ANY_PRICE_RE.lastIndex;
      found = true;
    }

    if (!found) {
      return;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
    parent.setAttribute(PROCESSED_ATTR, "1");
  }

  function scanTextPrices(root) {
    var scope = root && root.nodeType === 1 ? root : document.body || document.documentElement;
    var walker;
    var node;
    var nodes = [];
    var i;

    if (!scope || isInsideSkippedTag(scope)) {
      return;
    }

    walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: function (textNode) {
        if (!textNode.nodeValue || !extractCandidateText(textNode.nodeValue)) {
          return NodeFilter.FILTER_REJECT;
        }

        if (!textNode.parentElement || isInsideSkippedTag(textNode.parentElement) || isInsideProcessedArea(textNode.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }

        if (
          textNode.parentElement.classList.contains(CONVERTED_CLASS) ||
          textNode.parentElement.querySelector(":scope > ." + CONVERTED_CLASS)
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    while ((node = walker.nextNode())) {
      nodes.push(node);
    }

    for (i = 0; i < nodes.length; i += 1) {
      processTextNode(nodes[i]);
    }
  }

  function scanPrices(root) {
    var scope = root && root.nodeType === 1 ? root : document;
    var elements = [];
    var i;
    var selector;
    var found;
    var j;

    if (scope.nodeType === 1 && scope.matches) {
      for (i = 0; i < PRICE_SELECTORS.length; i += 1) {
        if (scope.matches(PRICE_SELECTORS[i])) {
          elements.push(scope);
          break;
        }
      }
    }

    for (i = 0; i < PRICE_SELECTORS.length; i += 1) {
      selector = PRICE_SELECTORS[i];
      found = scope.querySelectorAll ? scope.querySelectorAll(selector) : [];
      for (j = 0; j < found.length; j += 1) {
        elements.push(found[j]);
      }
    }

    for (i = 0; i < elements.length; i += 1) {
      processPriceElement(elements[i]);
    }

    scanTextPrices(scope);
  }

  function start() {
    var observer;

    document.documentElement.setAttribute("data-kzt-rub-converter", "loaded");
    if (window.console && window.console.info) {
      window.console.info("[kzt_rub_converter] converter.js loaded", window.location.href);
    }

    logRate("Using exchange rate source: " + RATE_SOURCE + " (" + RUB_PER_KZT + ")");

    scanPrices(document);

    observer = new MutationObserver(function (mutations) {
      var i;
      var j;
      var mutation;
      var node;

      for (i = 0; i < mutations.length; i += 1) {
        mutation = mutations[i];

        if (mutation.type === "characterData" && mutation.target && mutation.target.parentElement) {
          processTextNode(mutation.target);
          processPriceElement(mutation.target.parentElement);
        }

        for (j = 0; j < mutation.addedNodes.length; j += 1) {
          node = mutation.addedNodes[j];
          if (!node || node.nodeType !== 1 || isInsideSkippedTag(node)) {
            continue;
          }
          scanPrices(node);
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
