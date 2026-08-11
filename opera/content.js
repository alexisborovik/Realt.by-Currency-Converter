let currentRate = 3.25;
let currentCurrency = 'USD';
let ratesList = {};

const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  RUB: '₽'
};

// Умное хранилище оригинальных текстов для каждого текстового узла.
const originalTexts = new WeakMap();

// 1. Загружаем сохраненные курсы и валюту
chrome.storage.local.get(['rates', 'selectedCurrency'], (result) => {
  if (result.rates) ratesList = result.rates;
  if (result.selectedCurrency) currentCurrency = result.selectedCurrency;
  currentRate = ratesList[currentCurrency] || getFallbackRate(currentCurrency);
  runConversion();
});

// 2. Запрашиваем свежие данные у фонового скрипта
chrome.runtime.sendMessage({ action: 'get_current_data' }, (response) => {
  if (response && response.rates) {
    ratesList = response.rates;
    currentCurrency = response.selectedCurrency;
    const freshRate = ratesList[currentCurrency] || getFallbackRate(currentCurrency);
    if (freshRate !== currentRate) {
      currentRate = freshRate;
      convertPrices(currentRate, currentCurrency);
    }
  }
});

// 3. Следим за переключением валюты в Popup на лету
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    let changed = false;
    if (changes.selectedCurrency) {
      currentCurrency = changes.selectedCurrency.newValue;
      changed = true;
    }
    if (changes.rates) {
      ratesList = changes.rates.newValue;
      changed = true;
    }
    if (changed) {
      currentRate = ratesList[currentCurrency] || getFallbackRate(currentCurrency);
      convertPrices(currentRate, currentCurrency);
    }
  }
});

function getFallbackRate(currency) {
  if (currency === 'EUR') return 3.50;
  if (currency === 'RUB') return 0.035;
  return 3.25;
}

function runConversion() {
  convertPrices(currentRate, currentCurrency);
  if (!window.priceObserver) {
    window.priceObserver = new MutationObserver(() => {
      convertPrices(currentRate, currentCurrency);
    });
    window.priceObserver.observe(document.body, { childList: true, subtree: true });
  }
}

// Форматирование больших чисел в компактный вид для карты (например, 183700 -> "$184k")
function formatCompact(value, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] || '$';
  
  if (currency === 'RUB') {
    // Для российских рублей используем строгие русские сокращения "млн" и "т."
    if (value >= 1000000) {
      const millions = value / 1000000;
      // Если число круглое (например, 15.0), убираем ноль после запятой для красоты
      const formatted = millions % 1 === 0 ? millions.toString() : millions.toFixed(1);
      return `${formatted} млн ${symbol}`; // Выведет, например: "16 млн ₽" или "1.5 млн ₽"
    }
    if (value >= 1000) {
      return `${Math.round(value / 1000)} т. ${symbol}`; // Выведет, например: "280 т. ₽"
    }
    return `${Math.round(value)} ${symbol}`;
  } else {
    // Для USD/EUR используем стандартный международный формат (K / M)
    if (value >= 1000000) {
      const millions = value / 1000000;
      const formatted = millions % 1 === 0 ? millions.toString() : millions.toFixed(1);
      return `${symbol}${formatted}M`; // Выведет, например: "$1.2M"
    }
    if (value >= 1000) {
      return `${symbol}${Math.round(value / 1000)}K`; // Выведет, например: "$184K"
    }
    return `${symbol}${Math.round(value)}`;
  }
}

function convertPrices(rate, currency) {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  // Ищет: Число -> Опционально (т. / млн.) -> Символ валюты (р. / руб. / Б / б / ⃅ / ƃ / Ƃ / Br / BYN)
  const complexPriceRegex = /(\d[\d\s,.]*)\s*(т\.?|млн\.?)?\s*(?:р\.|руб\.|[Бб⃅ƃƂ]|Br|BYN)/gi;
  const foreignSymbol = CURRENCY_SYMBOLS[currency] || '$';

  while (node = walker.nextNode()) {
    const text = node.nodeValue;
    const parent = node.parentNode;

    // Игнорируем технические теги
    if (parent && 
        parent.tagName !== 'SCRIPT' && 
        parent.tagName !== 'STYLE' && 
        parent.tagName !== 'TEXTAREA') {
      
      let originalText = originalTexts.get(node);

      // Если мы видим этот узел впервые, либо если сайт обновил его значение (и в нем нет нашей скобки конвертации)
      const hasConversionMarker = text.includes('(~');
      if (!originalText || !hasConversionMarker) {
        originalText = text;
        originalTexts.set(node, originalText);
      }

      if (complexPriceRegex.test(originalText)) {
        complexPriceRegex.lastIndex = 0; // Сброс индекса регулярного выражения

        const newText = originalText.replace(complexPriceRegex, (match, numStr, modifier) => {
          const cleanNumStr = numStr.replace(/\s/g, '').replace(',', '.');
          let priceInByn = parseFloat(cleanNumStr);

          if (isNaN(priceInByn)) return match;

          let isCompactModifierUsed = false;

          // Конвертируем тысячи и миллионы в реальные числа для расчета
          if (modifier) {
            const modLower = modifier.toLowerCase();
            if (modLower.startsWith('т')) {
              priceInByn = priceInByn * 1000;
              isCompactModifierUsed = true;
            } else if (modLower.startsWith('млн')) {
              priceInByn = priceInByn * 1000000;
              isCompactModifierUsed = true;
            }
          }

          if (priceInByn < 100) return match; // Игнорируем слишком мелкие цифры

          const priceInConverted = priceInByn / rate;
          let foreignPart = '';

          // Если в исходном тексте использовался сокращенный модификатор (т. или млн) — пишем сокращенно
          if (isCompactModifierUsed) {
            foreignPart = ` (~${formatCompact(priceInConverted, currency)})`;
          } else {
            // Для обычных объявлений, где цена написана полностью, пишем полную сумму со всеми нулями
            const roundedConverted = Math.round(priceInConverted);
            const formattedPrice = roundedConverted.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
            
            foreignPart = (currency === 'RUB') 
              ? ` (~${formattedPrice} ${foreignSymbol})` 
              : ` (~${foreignSymbol}${formattedPrice})`;
          }

          return `${match}${foreignPart}`;
        });

        if (newText !== text) {
          node.nodeValue = newText;
        }
      }
    }
  }
}