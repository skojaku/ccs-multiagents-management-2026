export function el(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text != null) element.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value == null || value === false) continue;
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (options.children) element.append(...options.children.filter(Boolean));
  return element;
}

export function createField(label, control, description) {
  const caption = el('div', { className: 'field__caption' });
  caption.append(el('span', { className: 'field__label', text: label }));
  if (description) caption.append(el('span', { className: 'field__description', text: description }));
  return el('label', { className: 'field', children: [caption, control] });
}

export function createSlider({ label, value, min, max, step = 0.01, onInput }) {
  const range = el('input', { className: 'slider', attrs: { type: 'range', min, max, step, value } });
  const number = el('input', { className: 'number', attrs: { type: 'number', min, max, step, value } });
  const sync = (next) => {
    const clamped = Math.min(max, Math.max(min, Number(next)));
    range.value = String(clamped);
    number.value = String(clamped);
    onInput?.(clamped);
  };
  range.addEventListener('input', () => sync(range.value));
  number.addEventListener('change', () => sync(number.value));
  const row = el('div', { className: 'slider-row', children: [range, number] });
  return { root: createField(label, row), setValue: sync };
}

export function createSegmented({ label, value, options, onChange }) {
  const group = el('div', { className: 'segmented', attrs: { role: 'group', 'aria-label': label } });
  const buttons = new Map();
  const select = (next) => {
    for (const [buttonValue, button] of buttons) button.dataset.active = String(buttonValue === next);
    onChange?.(next);
  };
  for (const option of options) {
    const button = el('button', { className: 'segmented__button', text: option.label, attrs: { type: 'button' } });
    button.dataset.active = String(option.value === value);
    button.addEventListener('click', () => select(option.value));
    buttons.set(option.value, button);
    group.append(button);
  }
  return { root: createField(label, group), setValue: select };
}

export function createChecklist({ label, options, selected, onChange }) {
  const selectedSet = new Set(selected);
  const list = el('div', { className: 'checklist' });
  for (const option of options) {
    const input = el('input', { attrs: { type: 'checkbox' } });
    input.checked = selectedSet.has(option.value);
    input.addEventListener('change', () => {
      if (input.checked) selectedSet.add(option.value);
      else selectedSet.delete(option.value);
      onChange?.(new Set(selectedSet));
    });
    list.append(el('label', { className: 'check', children: [input, el('span', { text: option.label })] }));
  }
  return { root: createField(label, list), selected: selectedSet };
}

export function createSearch({ placeholder, onInput, onSubmit }) {
  const form = el('form', { className: 'search' });
  const input = el('input', { className: 'search__input', attrs: { type: 'search', placeholder } });
  const clear = el('button', { className: 'search__clear', text: 'Clear', attrs: { type: 'button' } });
  input.addEventListener('input', () => onInput?.(input.value));
  clear.addEventListener('click', () => {
    input.value = '';
    onInput?.('');
    input.focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit?.(input.value);
  });
  form.append(input, clear);
  return { root: form, input };
}

export function createHoverCard(viewer) {
  const title = el('div', { className: 'hover-card__title' });
  const body = el('div', { className: 'hover-card__body' });
  const root = el('aside', { className: 'hover-card is-empty', children: [title, body] });
  viewer.append(root);
  return {
    setEmpty() {
      root.classList.add('is-empty');
      title.textContent = '';
      body.replaceChildren();
    },
    setNode(label, rows) {
      root.classList.remove('is-empty');
      title.textContent = label;
      body.replaceChildren(...rows.map(([key, value]) => el('div', {
        className: 'hover-card__row',
        children: [el('span', { text: key }), el('strong', { text: String(value ?? '') })],
      })));
    },
  };
}
