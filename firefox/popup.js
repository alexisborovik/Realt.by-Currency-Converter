document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('currencySelect');
  const rateTitle = document.getElementById('rateTitle');
  const rateValue = document.getElementById('rateValue');
  const updateTime = document.getElementById('updateTime');

  let allRates = {};

  // Функция для отображения курса на основе выбранной валюты
  function displayRate(currency) {
    if (allRates[currency]) {
      let rate = allRates[currency];
      
      // Российский рубль нагляднее показывать как "Курс за 100 RUB"
      if (currency === 'RUB') {
        rateTitle.textContent = 'Курс НБРБ за 100 RUB:';
        rateValue.textContent = `${(rate * 100).toFixed(4)} BYN`;
      } else {
        rateTitle.textContent = `Курс НБРБ за 1 ${currency}:`;
        rateValue.textContent = `${rate.toFixed(4)} BYN`;
      }
    }
  }

  // Запрашиваем актуальные данные из фонового скрипта
  chrome.runtime.sendMessage({ action: 'get_current_data' }, (response) => {
    if (response) {
      allRates = response.rates;
      select.value = response.selectedCurrency;
      
      displayRate(response.selectedCurrency);
      updateTime.textContent = `Обновлено: ${response.lastUpdated}`;
    }
  });

  // Слушаем изменение выбора валюты пользователем
  select.addEventListener('change', () => {
    const newCurrency = select.value;
    
    // Сохраняем выбор в хранилище расширения
    chrome.storage.local.set({ selectedCurrency: newCurrency }, () => {
      displayRate(newCurrency);
    });
  });
});