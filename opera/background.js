const API_URLS = {
  USD: 'https://api.nbrb.by/exrates/rates/USD?parammode=2',
  EUR: 'https://api.nbrb.by/exrates/rates/EUR?parammode=2',
  RUB: 'https://api.nbrb.by/exrates/rates/RUB?parammode=2'
};

// Функция для получения курсов всех трех валют
async function updateAllRates() {
  const rates = {};
  const today = new Date().toLocaleDateString();

  for (const [currency, url] of Object.entries(API_URLS)) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Ошибка загрузки ${currency}`);
      const data = await response.json();
      
      // Вычисляем курс за ОДНУ единицу валюты (учитываем Cur_Scale, который у RUB равен 100)
      const ratePerUnit = data.Cur_OfficialRate / data.Cur_Scale;
      rates[currency] = ratePerUnit;
    } catch (error) {
      console.error(`Ошибка при получении курса ${currency}:`, error);
    }
  }

  // Если удалось получить хотя бы один свежий курс, обновляем базу
  if (Object.keys(rates).length > 0) {
    const storageData = await chrome.storage.local.get(['rates']);
    const existingRates = storageData.rates || {};
    
    // Объединяем полученные курсы со старыми на случай, если какой-то запрос сорвался
    const updatedRates = { ...existingRates, ...rates };
    
    await chrome.storage.local.set({ 
      rates: updatedRates, 
      lastUpdated: today 
    });
    return { rates: updatedRates, source: 'НБРБ (свежий)' };
  }

  // Резервный вариант: если совсем нет сети, берем из кэша
  const cached = await chrome.storage.local.get(['rates']);
  const defaultRates = { USD: 3.25, EUR: 3.50, RUB: 0.035 }; // Дефолтные курсы
  return {
    rates: cached.rates || defaultRates,
    source: cached.rates ? 'Кэш' : 'По умолчанию'
  };
}

// Слушаем сообщения от контентного скрипта и popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get_current_data') {
    updateAllRates().then(async (result) => {
      // Читаем текущую выбранную пользователем валюту (по умолчанию USD)
      const settings = await chrome.storage.local.get(['selectedCurrency']);
      const selectedCurrency = settings.selectedCurrency || 'USD';
      
      sendResponse({
        rates: result.rates,
        selectedCurrency: selectedCurrency,
        lastUpdated: result.source === 'НБРБ (свежий)' ? new Date().toLocaleDateString() : 'Кэш',
        source: result.source
      });
    });
    return true; // для асинхронного ответа
  }
});