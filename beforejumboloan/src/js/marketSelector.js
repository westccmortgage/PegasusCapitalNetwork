/**
 * marketSelector.js
 * Renders the market <select> from config and notifies on change.
 * Kept tiny and dependency-free so it can be reused on any page.
 */

import { MARKETS, getMarket } from '../config/markets.js';
import { money } from './lib/format.js';

/**
 * @param {HTMLSelectElement} selectEl
 * @param {(market:Object)=>void} onChange
 * @param {string} [initialId]
 * @returns {{ getMarket: ()=>Object, setMarket:(id:string)=>void }}
 */
export function mountMarketSelector(selectEl, onChange, initialId = MARKETS[0].id) {
  selectEl.innerHTML = '';
  for (const m of MARKETS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    const limit = m.highBalanceLimit > m.conformingLimit ? m.highBalanceLimit : m.conformingLimit;
    opt.textContent = `${m.label} — limit ${money(limit)}`;
    selectEl.appendChild(opt);
  }
  selectEl.value = initialId;

  const emit = () => onChange(getMarket(selectEl.value));
  selectEl.addEventListener('change', emit);

  return {
    getMarket: () => getMarket(selectEl.value),
    setMarket: (id) => {
      selectEl.value = id;
      emit();
    },
  };
}

export default mountMarketSelector;
