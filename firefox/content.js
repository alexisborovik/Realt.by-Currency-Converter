let currentRate = 3.25;
let currentCurrency = 'USD';
let ratesList = {};

// Символы для валют
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  RUB: '₽'
};

// 1. Сначала загружаем ранее сохраненные значения
chrome.storage.local.get(['rates', 'selectedCurrency'], (result) => {
  if (result.rates) {
    ratesList = result.rates;
  }
  if (result.selectedCurrency) {
    currentCurrency = result.selectedCurrency;
  }
  
  currentRate = ratesList[currentCurrency] || getFallbackRate(currentCurrency);
  runConversion();
});

// 2. Запрашиваем свежие данные у фонового воркера
chrome.runtime.sendMessage({ action: 'get_current_data' }, (response) => {
  if (response && response.rates) {
    ratesList = response.rates;
    currentCurrency = response.selectedCurrency;
    const freshRate = ratesList[currentCurrency] || getFallbackRate(currentCurrency);

    if (freshRate !== currentRate) {
      currentRate = freshRate;
      resetAndConvert();
    }
  }
});

// 3. Подписка на изменение валюты на лету
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
      resetAndConvert();
    }
  }
});

// Дефолтные курсы на всякий случай
function getFallbackRate(currency) {
  if (currency === 'EUR') return 3.50;
  if (currency === 'RUB') return 0.035;
  return 3.25; // USD
}

function resetAndConvert() {
  document.querySelectorAll('[data-original-text]').forEach(el => {
    el.textContent = el.getAttribute('data-original-text');
    el.removeAttribute('data-original-text');
    el.classList.remove('converted-price');
  });
  convertPrices(currentRate, currentCurrency);
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

function convertPrices(rate, currency) {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  const priceRegex = /(\d[\d\s]*)\s*(?:ƃ)/g;
  const symbol = CURRENCY_SYMBOLS[currency] || '$';

  while (node = walker.nextNode()) {
    const text = node.nodeValue;
    const parent = node.parentNode;

    if (parent && 
        parent.tagName !== 'SCRIPT' && 
        parent.tagName !== 'STYLE' && 
        parent.tagName !== 'TEXTAREA' &&
        !parent.classList.contains('converted-price')) {
      
      if (priceRegex.test(text)) {
        priceRegex.lastIndex = 0;

        if (!parent.hasAttribute('data-original-text')) {
          parent.setAttribute('data-original-text', text);
        }

        const originalText = parent.getAttribute('data-original-text');
        
        const newText = originalText.replace(priceRegex, (match, p1) => {
          const rawPrice = p1.replace(/\s/g, ''); 
          const priceInByn = parseFloat(rawPrice);

          if (!isNaN(priceInByn) && priceInByn > 100) {
            const priceInConverted = Math.round(priceInByn / rate);
            const formattedPrice = priceInConverted.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
            
            // Форматируем вывод: для USD и EUR знак валюты ставим СЛЕВА (~$10 000), а для RUB — СПРАВА (~10 000 ₽)
            const resultString = (currency === 'RUB') 
              ? `${match} (~${formattedPrice} ${symbol})` 
              : `${match} (~${symbol}${formattedPrice})`;

            return resultString;
          }
          return match;
        });

        if (newText !== text) {
          node.nodeValue = newText;
          parent.classList.add('converted-price');
        }
      }
    }
  }
}