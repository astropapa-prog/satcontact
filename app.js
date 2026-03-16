/**
 * SDR Frequency Manager — Module 1
 * Vanilla JS, PWA-ready
 */

(function () {
  'use strict';

  const DATA_URL = 'data/Frequencies.xml';

  // DOM elements
  let searchInput, cardList, emptyState, statusText, groupSelect;
  let chipAll, chipRowSatellites, chipRowBandwidth, chipRowSensitivity;
  let toggleBandwidth, toggleSensitivity;
  let allEntries = [];
  let filteredEntries = [];
  let lastRenderedGroup = null;

  // Состояние фильтров по кнопкам (независимо от строки поиска)
  const selectedFilters = {
    satellites: new Set(),
    bandwidths: new Set(),
    sensitivities: new Set()
  };

  /**
   * Извлечение NORAD ID из Name (значение в квадратных скобках)
   */
  function extractNoradId(name) {
    const match = name.match(/\[(\d+)\]/);
    return match ? match[1] : null;
  }

  /**
   * Извлечение TX (Uplink) частоты из Name (значение в круглых скобках)
   * Поддержка форматов: (316.725), (317,045), (317.085)
   */
  function extractTxFreq(name) {
    const match = name.match(/\(([\d.,\s]+)\)/);
    if (!match) return null;
    const normalized = match[1].replace(',', '.').trim();
    const num = parseFloat(normalized);
    return isNaN(num) ? null : num;
  }

  /**
   * Определение статуса по ключевым словам в Name или GroupName
   */
  function getStatus(name, groupName) {
    const text = `${name || ''} ${groupName || ''}`.toLowerCase();
    if (text.includes('чувствительный')) return { label: 'Чувствительный', emoji: '🟢', class: 'status-sens' };
    if (text.includes('средняя') || text.includes('ср ')) return { label: 'Средняя', emoji: '🟡', class: 'status-med' };
    if (text.includes('тупой') || text.includes('ту ')) return { label: 'Тупой', emoji: '🔴', class: 'status-dull' };
    return { label: 'Не исследован', emoji: '⚫', class: 'status-unknown' };
  }

  /**
   * Очистка названия: удаление NORAD, TX, статусов, упоминаний "кгц"
   * Пример: "75° UFO F11 6кгц (317,045)[28117] тупой" → "75° UFO F11"
   */
  function getCleanName(name) {
    if (!name || typeof name !== 'string') return '';
    let clean = name
      .replace(/\s*\[[\d]+\]\s*/g, '')           // NORAD [28117]
      .replace(/\s*\([\d.,\s]+\)\s*/g, '')       // TX (317.045)
      .replace(/\s*(чувствительный|средняя|ср|тупой|ту)\s*$/gi, '')
      .replace(/\s*\d+\s*кгц\s*/gi, '')          // 6кгц, 8 кгц, 575 кгц
      .replace(/\s*кгц\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return clean;
  }

  /**
   * Извлечение градусов из clean name для сортировки (-29, 13, 75)
   */
  function extractDegrees(cleanName) {
    const match = cleanName.match(/^(-?\d+)\s*°/);
    return match ? parseInt(match[1], 10) : 999;
  }

  /**
   * Форматирование частоты: 243625000 → "243.625 MHz"
   */
  function formatFreq(hz) {
    const mhz = (hz / 1e6).toFixed(3);
    return `${mhz} MHz`;
  }

  /**
   * Форматирование FilterBandwidth: 32000 → "32k", 6000 → "6k"
   */
  function formatBandwidth(bw) {
    const num = parseInt(bw, 10);
    if (isNaN(num)) return String(bw);
    if (num >= 1000) return `${num / 1000}k`;
    return `${num}`;
  }

  /**
   * Парсинг XML и преобразование в массив объектов
   */
  function parseXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const entries = doc.querySelectorAll('MemoryEntry');
    const result = [];

    entries.forEach((el) => {
      const name = el.querySelector('Name')?.textContent?.trim() || '';
      const groupName = el.querySelector('GroupName')?.textContent?.trim() || '';
      const frequency = el.querySelector('Frequency')?.textContent?.trim() || '0';
      const detectorType = el.querySelector('DetectorType')?.textContent?.trim() || '';
      const filterBandwidth = el.querySelector('FilterBandwidth')?.textContent?.trim() || '';

      const noradId = extractNoradId(name);
      const txFreq = extractTxFreq(name);
      const cleanName = getCleanName(name);
      const status = getStatus(name, groupName);
      const bandwidthFormatted = formatBandwidth(filterBandwidth);

      result.push({
        name,
        cleanName,
        groupName,
        frequency: parseInt(frequency, 10) || 0,
        detectorType,
        filterBandwidth,
        bandwidthFormatted,
        noradId,
        txFreq,
        status,
        degrees: extractDegrees(cleanName)
      });
    });

    return result;
  }

  /**
   * Генерация уникальных групп из GroupName (для выпадающего списка)
   */
  function getUniqueGroups(entries) {
    const seen = new Set();
    const list = [];
    entries.forEach((e) => {
      const g = e.groupName || '(Без группы)';
      if (!seen.has(g)) {
        seen.add(g);
        list.push(g);
      }
    });
    if (list.length > 1) list.sort((a, b) => a.localeCompare(b));
    return list;
  }

  /**
   * Генерация уникальных спутников для кнопок (сортировка по градусам)
   */
  function getUniqueSatellites(entries) {
    const seen = new Set();
    const list = [];
    entries.forEach((e) => {
      if (e.cleanName && !seen.has(e.cleanName)) {
        seen.add(e.cleanName);
        list.push({ cleanName: e.cleanName, degrees: e.degrees });
      }
    });
    list.sort((a, b) => a.degrees - b.degrees);
    return list.map((s) => s.cleanName);
  }

  /**
   * Генерация уникальных полос пропускания (сортировка по возрастанию)
   */
  function getUniqueBandwidths(entries) {
    const seen = new Set();
    const list = [];
    entries.forEach((e) => {
      const bw = parseInt(e.filterBandwidth, 10);
      if (!isNaN(bw) && !seen.has(bw)) {
        seen.add(bw);
        list.push({ raw: bw, formatted: e.bandwidthFormatted });
      }
    });
    list.sort((a, b) => a.raw - b.raw);
    return list.map((b) => b.formatted);
  }

  /**
   * Фильтрация по выбранным кнопкам (множественный выбор)
   * Внутри категории: OR. Между категориями: AND.
   */
  function filterByButtons(entries) {
    const hasSat = selectedFilters.satellites.size > 0;
    const hasBw = selectedFilters.bandwidths.size > 0;
    const hasSens = selectedFilters.sensitivities.size > 0;
    if (!hasSat && !hasBw && !hasSens) return entries;

    return entries.filter((e) => {
      const matchSat = !hasSat || selectedFilters.satellites.has(e.cleanName);
      const matchBw = !hasBw || selectedFilters.bandwidths.has(e.bandwidthFormatted);
      const matchSens = !hasSens || selectedFilters.sensitivities.has(e.status.label);
      return matchSat && matchBw && matchSens;
    });
  }

  /**
   * Фильтрация по частоте (только цифры, без точек/запятых)
   * Сопоставление RX и TX частот по подстроке цифр
   */
  function filterByFrequency(entries, freqInput) {
    const digits = (freqInput || '').replace(/\D/g, '');
    if (!digits) return entries;

    return entries.filter((e) => {
      const rxDigits = String(e.frequency);
      if (rxDigits.includes(digits)) return true;
      if (e.txFreq != null) {
        const txDigits = String(Math.round(e.txFreq * 1000));
        if (txDigits.includes(digits)) return true;
      }
      return false;
    });
  }

  /**
   * Создание HTML карточки
   */
  function createCardHtml(entry) {
    const rxFreq = formatFreq(entry.frequency);
    const txLine = entry.txFreq ? `TX: ${entry.txFreq.toFixed(3)} MHz` : '';
    const noradHtml = entry.noradId
      ? `<span class="freq-card__norad">NORAD ${entry.noradId}</span>`
      : '';

    const statusBadge = `<span class="badge badge--${entry.status.class}">${entry.status.emoji} ${entry.status.label}</span>`;
    const detectorBadge = entry.detectorType
      ? `<span class="badge badge--detector">${entry.detectorType}</span>`
      : '';
    const bwBadge = entry.bandwidthFormatted
      ? `<span class="badge badge--bandwidth">${entry.bandwidthFormatted}</span>`
      : '';

    return `
      <article class="freq-card" data-norad="${entry.noradId || ''}" data-searchable="${escapeHtml(entry.cleanName + ' ' + rxFreq + ' ' + (entry.noradId || ''))}">
        <div class="freq-card__top">
          <span class="freq-card__name">${escapeHtml(entry.cleanName || '—')}</span>
        </div>
        <div class="freq-card__freq-block">
          <span class="freq-card__rx">${escapeHtml(rxFreq)}</span>
          ${txLine ? `<span class="freq-card__tx">${escapeHtml(txLine)}</span>` : ''}
        </div>
        <div class="freq-card__footer">
          <div class="freq-card__badges">
            ${detectorBadge}
            ${bwBadge}
            ${statusBadge}
          </div>
          ${noradHtml}
        </div>
      </article>
    `;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Отрисовка списка карточек
   * @param {Array} entries - отфильтрованные записи
   * @param {number} [totalInGroup] - всего в выбранной группе (для статус-бара)
   */
  function renderCards(entries, totalInGroup) {
    if (!cardList) return;
    cardList.innerHTML = entries.map(createCardHtml).join('');

    if (emptyState) {
      emptyState.hidden = entries.length > 0;
    }

    if (statusText) {
      const total = totalInGroup !== undefined ? totalInGroup : allEntries.length;
      statusText.textContent = `Показано: ${entries.length} из ${total}`;
    }
  }

  /**
   * Заполнение выпадающего списка групп
   */
  function renderGroupSelect() {
    if (!groupSelect) return;
    const groups = getUniqueGroups(allEntries);
    groupSelect.innerHTML = '<option value="">Все группы</option>' +
      groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    groupSelect.addEventListener('change', () => applyFilter());
  }

  /**
   * Генерация кнопок-чипсов на основе актуального списка (отфильтрованного по группе)
   * @param {Array} entries - записи выбранной группы (или все при "Все группы")
   */
  function renderFilterChips(entries) {
    const satellites = getUniqueSatellites(entries);
    const bandwidths = getUniqueBandwidths(entries);

    if (chipRowSatellites) {
      chipRowSatellites.innerHTML = satellites
        .map((s) => {
          const active = selectedFilters.satellites.has(s) ? ' chip--active' : '';
          return `<button type="button" class="chip${active}" data-category="satellite" data-filter="${escapeHtml(s)}">${escapeHtml(s)}</button>`;
        })
        .join('');
    }

    if (chipRowBandwidth) {
      chipRowBandwidth.innerHTML = bandwidths
        .map((b) => {
          const active = selectedFilters.bandwidths.has(b) ? ' chip--active' : '';
          return `<button type="button" class="chip${active}" data-category="bandwidth" data-filter="${escapeHtml(b)}">${escapeHtml(b)}</button>`;
        })
        .join('');
    }

    bindChipClicks();
  }

  /**
   * Получить Set фильтров по родительскому ряду чипса (надёжнее, чем data-category)
   */
  function getFilterSetForChip(btn) {
    const parent = btn.closest('.chip-scroll');
    if (!parent) return null;
    if (parent.id === 'chipRowSatellites') return selectedFilters.satellites;
    if (parent.id === 'chipRowBandwidth') return selectedFilters.bandwidths;
    if (parent.id === 'chipRowSensitivity') return selectedFilters.sensitivities;
    return null;
  }

  /**
   * Обновление визуального состояния всех кнопок-фильтров
   * Категория определяется по родительскому ряду, а не по data-атрибуту
   */
  function updateChipActiveStates() {
    document.querySelectorAll('.chip[data-filter]').forEach((btn) => {
      const set = getFilterSetForChip(btn);
      const val = btn.dataset.filter;
      if (!set || val == null) return;
      if (set.has(val)) {
        btn.classList.add('chip--active');
      } else {
        btn.classList.remove('chip--active');
      }
    });
  }

  /**
   * Сброс всех фильтров и сворачивание рядов (для кнопки ВСЕ)
   */
  function resetAllAndCollapse() {
    selectedFilters.satellites.clear();
    selectedFilters.bandwidths.clear();
    selectedFilters.sensitivities.clear();
    if (searchInput) searchInput.value = '';
    if (chipRowBandwidth) {
      chipRowBandwidth.classList.add('chip-row--collapsed');
    }
    if (chipRowSensitivity) {
      chipRowSensitivity.classList.add('chip-row--collapsed');
    }
    if (toggleBandwidth) {
      toggleBandwidth.classList.remove('active');
      toggleBandwidth.setAttribute('aria-pressed', 'false');
    }
    if (toggleSensitivity) {
      toggleSensitivity.classList.remove('active');
      toggleSensitivity.setAttribute('aria-pressed', 'false');
    }
  }

  /**
   * Привязка панели управления (ВСЕ, тумблеры)
   */
  function bindControlPanel() {
    if (chipAll) {
      chipAll.addEventListener('click', () => {
        resetAllAndCollapse();
        applyFilter();
        chipAll.blur();
      });
    }
    if (toggleBandwidth && chipRowBandwidth) {
      toggleBandwidth.addEventListener('click', () => {
        const isCollapsed = chipRowBandwidth.classList.contains('chip-row--collapsed');
        chipRowBandwidth.classList.toggle('chip-row--collapsed', !isCollapsed);
        toggleBandwidth.classList.toggle('active', isCollapsed);
        toggleBandwidth.setAttribute('aria-pressed', String(isCollapsed));
        if (!isCollapsed) {
          selectedFilters.bandwidths.clear();
          applyFilter();
        }
        toggleBandwidth.blur();
      });
    }
    if (toggleSensitivity && chipRowSensitivity) {
      toggleSensitivity.addEventListener('click', () => {
        const isCollapsed = chipRowSensitivity.classList.contains('chip-row--collapsed');
        chipRowSensitivity.classList.toggle('chip-row--collapsed', !isCollapsed);
        toggleSensitivity.classList.toggle('active', isCollapsed);
        toggleSensitivity.setAttribute('aria-pressed', String(isCollapsed));
        if (!isCollapsed) {
          selectedFilters.sensitivities.clear();
          applyFilter();
        }
        toggleSensitivity.blur();
      });
    }
  }

  /**
   * Горизонтальный скролл колёсиком мыши на десктопе
   */
  function bindHorizontalScroll() {
    document.querySelectorAll('.chip-scroll').forEach((el) => {
      el.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0 && el.scrollWidth > el.clientWidth) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    });
  }

  /**
   * Обработка кликов по чипсам — переключение выбора (toggle)
   * Категория определяется по родительскому ряду
   */
  function bindChipClicks() {
    document.querySelectorAll('.chip').forEach((btn) => {
      btn.replaceWith(btn.cloneNode(true));
    });
    document.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const set = getFilterSetForChip(btn);
        const filter = btn.dataset.filter;
        if (!set || !filter) return;
        if (set.has(filter)) {
          set.delete(filter);
        } else {
          set.add(filter);
        }
        if (set.has(filter)) {
          btn.classList.add('chip--active');
        } else {
          btn.classList.remove('chip--active');
        }
        btn.blur();
        applyFilter();
      });
    });
  }

  /**
   * Применение фильтра и перерисовка
   */
  function applyFilter() {
    const freqInput = searchInput ? searchInput.value.trim() : '';
    const group = groupSelect ? groupSelect.value : '';
    let base = allEntries;
    if (group) {
      base = base.filter((e) => (e.groupName || '(Без группы)') === group);
    }
    if (lastRenderedGroup !== group) {
      lastRenderedGroup = group;
      selectedFilters.satellites.clear();
      selectedFilters.bandwidths.clear();
      selectedFilters.sensitivities.clear();
      renderFilterChips(base);
    }
    let result = filterByButtons(base);
    result = filterByFrequency(result, freqInput);
    filteredEntries = result;
    renderCards(filteredEntries, base.length);
    updateChipActiveStates();
  }

  /**
   * Загрузка XML и инициализация
   */
  async function loadData() {
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xmlText = await res.text();
      allEntries = parseXml(xmlText);
      filteredEntries = [...allEntries];

      renderGroupSelect();
      bindControlPanel();
      bindHorizontalScroll();
      applyFilter();
      bindSearchInput();
    } catch (err) {
      console.error('Load error:', err);
      if (statusText) statusText.textContent = `Ошибка загрузки: ${err.message}`;
      if (cardList) cardList.innerHTML = '';
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.innerHTML = '<p>Не удалось загрузить data/Frequencies.xml. Проверьте путь и доступность файла.</p>';
      }
    }
  }

  /**
   * Обработка ввода частоты (только цифры, без точек/запятых)
   */
  function bindSearchInput() {
    if (!searchInput) return;
    searchInput.addEventListener('input', () => {
      searchInput.value = searchInput.value.replace(/\D/g, '');
      applyFilter();
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        applyFilter();
        searchInput.blur();
      }
    });
  }

  /**
   * Инициализация при загрузке DOM
   */
  function init() {
    searchInput = document.getElementById('searchInput');
    cardList = document.getElementById('cardList');
    emptyState = document.getElementById('emptyState');
    statusText = document.getElementById('statusText');
    groupSelect = document.getElementById('groupSelect');
    chipAll = document.getElementById('chipAll');
    chipRowSatellites = document.getElementById('chipRowSatellites');
    chipRowBandwidth = document.getElementById('chipRowBandwidth');
    chipRowSensitivity = document.getElementById('chipRowSensitivity');
    toggleBandwidth = document.getElementById('toggleBandwidth');
    toggleSensitivity = document.getElementById('toggleSensitivity');

    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
