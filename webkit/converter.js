(function () {
  var CONVERTED_CLASS = "kzt-rub-converted";
  var PROCESSED_ATTR = "data-kzt-rub-processed";
  var KZT_SYMBOL = "₸";
  var KZT_TG = "тг";
  var KZT_TENGE = "тенге";
  var CYRILLIC_T = "Т";
  var APPROX_SIGN = "≈";
  var RUB_SYMBOL = "₽";
  
  var kztToRubRate = 1 / 6; // Аварийный курс

  var KZT_SUFFIX_RE = new RegExp(
    "(\\d[\\d\\s.,]*)\\s*(?:" + KZT_SYMBOL + "|" + KZT_TG + "|" + KZT_TENGE + "|[T" + CYRILLIC_T + "])(?![A-Za-zА-Яа-яЁё])", "i"
  );
  var KZT_PREFIX_RE = new RegExp(
    "(?:" + KZT_SYMBOL + "|" + KZT_TG + "|" + KZT_TENGE + "|[T" + CYRILLIC_T + "])\\s*(\\d[\\d\\s.,]*)", "i"
  );
  var KZT_ANY_PRICE_RE = new RegExp(
    "(\\d[\\d\\s.,]*)\\s*(?:" + KZT_SYMBOL + "|" + KZT_TG + "|" + KZT_TENGE + "|[T" + CYRILLIC_T + "])(?![A-Za-zА-Яа-яЁё])|(?:" + KZT_SYMBOL + "|" + KZT_TG + "|" + KZT_TENGE + "|[T" + CYRILLIC_T + "])\\s*(\\d[\\d\\s.,]*)",
    "gi"
  );
  
  var PRICE_SELECTORS = [
    ".discount_final_price", ".discount_original_price", ".game_purchase_price",
    ".search_price", ".col.search_price", ".match_price", ".tab_price",
    ".tab_item_discount_price", ".search_result_row .price",
    '[class*="StoreSalePriceBox"]', '[class*="StoreSalePrice"]', '[class*="SalePrice"]',
    '[class*="discount_prices"]', '[class*="discount_block"]', 
    '.home_page_content .price', '.capsule .price', ".game_area_purchase_game .price"
  ];
  
  var SKIP_TAGS = { SCRIPT: true, STYLE: true, TEXTAREA: true, INPUT: true, BUTTON: true };

  // --- МУЛЬТИ-ИСТОЧНИК КУРСА ---

  async function loadSteamRate() {
    // 1. Пытаемся получить курс ЦБ РФ
    try {
      console.info("[kzt_rub_converter] Fetching CBR rate...");
      var response = await fetch("https://www.cbr-xml-daily.ru/daily_json.js");
      var data = await response.json();
      
      if (data && data.Valute && data.Valute.KZT) {
        var kzt = data.Valute.KZT;
        var rub = data.Valute.RUB;
        kztToRubRate = (kzt.Value / kzt.Nominal) / (rub.Value / rub.Nominal);
        console.info("[kzt_rub_converter] CBR rate loaded: 1 KZT =", kztToRubRate, "RUB");
        refreshDOM();
        return;
      }
    } catch (e) {
      console.warn("[kzt_rub_converter] CBR failed (CORS/Network), trying er-api...", e);
    }

    // 2. Пытаемся получить курс от Open Exchange Rates (отлично работает с CORS)
    try {
      var response2 = await fetch("https://open.er-api.com/v6/latest/KZT");
      var data2 = await response2.json();
      
      if (data2 && data2.result === "success" && data2.rates && data2.rates.RUB) {
        kztToRubRate = data2.rates.RUB;
        console.info("[kzt_rub_converter] er-api rate loaded: 1 KZT =", kztToRubRate, "RUB");
        refreshDOM();
        return;
      }
    } catch (e) {
      console.warn("[kzt_rub_converter] er-api failed, trying FazerCards...", e);
    }

    // 3. Пытаемся получить курс кошелька Steam
    try {
      var response3 = await fetch("https://reseller.fazercards.com/api/v2/steam-topup/public-rates");
      var data3 = await response3.json();
      if (data3 && data3.ok && data3.rates && data3.rates.KZT && data3.rates.RUB) {
        kztToRubRate = data3.rates.RUB / data3.rates.KZT;
        console.info("[kzt_rub_converter] FazerCards rate loaded: 1 KZT =", kztToRubRate, "RUB");
        refreshDOM();
        return;
      }
    } catch (e) {
      console.error("[kzt_rub_converter] All rate sources failed, using fallback 1/6", e);
    }
  }

  function refreshDOM() {
    scanPrices(document);
    scanTextPrices(document);
  }

  // --- ПАРСИНГ И ОБРАБОТКА ---

  function isInsideSkippedTag(element) {
    var node = element;
    while (node && node.nodeType === 1) {
      if (SKIP_TAGS[node.tagName]) return true;
      node = node.parentElement;
    }
    return false;
  }

  function isInsideProcessedArea(element) {
    var node = element;
    while (node && node.nodeType === 1) {
      if (node.hasAttribute && node.hasAttribute(PROCESSED_ATTR)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function parseKztNumber(text) {
    var normalized = String(text || "").replace(/\u00a0/g, " ").trim();
    if (!normalized) return null;
    normalized = normalized.replace(/\s+/g, "");
    if (/[,.]\d{2}$/.test(normalized)) normalized = normalized.replace(/[,.]\d{2}$/, "");
    var numeric = normalized.replace(/[^\d]/g, "");
    if (!numeric) return null;
    return parseInt(numeric, 10);
  }

  function parseKztPrice(text) {
    var normalized = String(text || "").replace(/\u00a0/g, " ").trim();
    if (!normalized || normalized.indexOf(APPROX_SIGN) !== -1 || normalized.indexOf(RUB_SYMBOL) !== -1) return null;
    var match = normalized.match(KZT_SUFFIX_RE) || normalized.match(KZT_PREFIX_RE);
    if (!match || !match[1]) return null;
    return parseKztNumber(match[1]);
  }

  function formatRub(value) {
    return APPROX_SIGN + " " + new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + " " + RUB_SYMBOL;
  }

  function findAnchorNode(element) {
    var converted = element.querySelector(":scope > ." + CONVERTED_CLASS);
    if (converted) return null;
    if (element.classList && element.classList.contains(CONVERTED_CLASS)) return null;
    for (var child = element.lastElementChild; child; child = child.previousElementSibling) {
      if (child.classList && child.classList.contains(CONVERTED_CLASS)) continue;
      if (child.textContent && child.textContent.trim()) return child;
    }
    return element;
  }

  function processPriceElement(element) {
    if (!element || element.nodeType !== 1 || isInsideSkippedTag(element)) return;
    if (element.querySelector("." + CONVERTED_CLASS) || isInsideProcessedArea(element)) return;

    var price = parseKztPrice(element.textContent);
    if (price === null) return;

    element.setAttribute(PROCESSED_ATTR, "1");
    var rubValue = Math.round(price * kztToRubRate);

    var converted = document.createElement("span");
    converted.className = CONVERTED_CLASS;
    converted.textContent = formatRub(rubValue);

    var anchor = findAnchorNode(element);
    if (anchor && anchor !== element && anchor.parentNode === element) {
      anchor.insertAdjacentElement("afterend", converted);
    } else {
      element.appendChild(converted);
    }
  }

  function processTextNode(textNode) {
    if (!textNode || textNode.nodeType !== 3) return;
    var parent = textNode.parentElement;
    if (!parent || isInsideSkippedTag(parent) || isInsideProcessedArea(parent) ||
        parent.classList.contains(CONVERTED_CLASS) || parent.querySelector(":scope > ." + CONVERTED_CLASS)) return;

    var text = textNode.nodeValue;
    var fragment = document.createDocumentFragment();
    var lastIndex = 0;
    var match;
    var found = false;

    KZT_ANY_PRICE_RE.lastIndex = 0;

    while ((match = KZT_ANY_PRICE_RE.exec(text)) !== null) {
      var amountText = match[1] || match[2];
      var price = parseKztNumber(amountText);
      if (price === null) continue;

      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      fragment.appendChild(document.createTextNode(match[0]));

      var rubValue = Math.round(price * kztToRubRate);
      var converted = document.createElement("span");
      converted.className = CONVERTED_CLASS;
      converted.textContent = formatRub(rubValue);
      fragment.appendChild(converted);

      lastIndex = KZT_ANY_PRICE_RE.lastIndex;
      found = true;
    }

    if (!found) return;

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
    parent.setAttribute(PROCESSED_ATTR, "1");
  }

  function scanPrices(root) {
    var scope = root && root.nodeType === 1 ? root : document;
    var elements = [];
    var i, j, found;

    if (scope.nodeType === 1 && scope.matches) {
      for (i = 0; i < PRICE_SELECTORS.length; i += 1) {
        if (scope.matches(PRICE_SELECTORS[i])) { elements.push(scope); break; }
      }
    }

    for (i = 0; i < PRICE_SELECTORS.length; i += 1) {
      found = scope.querySelectorAll ? scope.querySelectorAll(PRICE_SELECTORS[i]) : [];
      for (j = 0; j < found.length; j += 1) elements.push(found[j]);
    }

    for (i = 0; i < elements.length; i += 1) processPriceElement(elements[i]);
  }

  function scanTextPrices(root) {
    var scope = root && root.nodeType === 1 ? root : document;
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: function (textNode) {
        if (!textNode.nodeValue || !textNode.nodeValue.match(KZT_ANY_PRICE_RE)) return NodeFilter.FILTER_REJECT;
        if (!textNode.parentElement || isInsideSkippedTag(textNode.parentElement) || isInsideProcessedArea(textNode.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (var i = 0; i < nodes.length; i += 1) processTextNode(nodes[i]);
  }

  function start() {
    document.documentElement.setAttribute("data-kzt-rub-converter", "loaded");
    console.info("[kzt_rub_converter] Converter started");

    loadSteamRate();

    // Первичный скан
    scanPrices(document);
    scanTextPrices(document);

    // Повторный скан (когда DOM догрузится)
    setTimeout(function() {
      scanPrices(document);
      scanTextPrices(document);
    }, 1500);

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        if (mutations[i].type === "characterData" && mutations[i].target && mutations[i].target.parentElement) {
          processTextNode(mutations[i].target);
          processPriceElement(mutations[i].target.parentElement);
        }
        for (var j = 0; j < mutations[i].addedNodes.length; j += 1) {
          var node = mutations[i].addedNodes[j];
          if (node && node.nodeType === 1 && !isInsideSkippedTag(node)) {
            scanPrices(node);
            scanTextPrices(node);
          }
        }
      }
    });

    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
