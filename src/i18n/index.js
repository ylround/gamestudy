import zh from './zh.js';
import en from './en.js';

export const DICTS = { zh, en };
export const LANGS = ['zh', 'en'];

let current = 'zh';
const listeners = new Set();

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (!DICTS[lang] || lang === current) return current;
  current = lang;
  for (const listener of listeners) listener(current);
  return current;
}

export function onLangChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasKey(key, lang = current) {
  return Boolean(DICTS[lang] && Object.prototype.hasOwnProperty.call(DICTS[lang], key));
}

function joinList(items, lang) {
  const values = items.map((item) => localize(item, lang));
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]}${t('list.and', {}, lang)}${values[1]}`;
  return `${values.slice(0, -1).join(t('list.sep', {}, lang))}${t('list.and', {}, lang)}${values[values.length - 1]}`;
}

function formatParam(value, lang) {
  if (Array.isArray(value)) return joinList(value, lang);
  if (value && typeof value === 'object' && value.key) return t(value.key, value.params || {}, lang);
  return String(value);
}

/** Translate a key and interpolate `{name}` parameters. */
export function t(key, params = {}, lang = current) {
  const dict = DICTS[lang] || DICTS.zh;
  let template = dict[key];
  if (template == null) template = DICTS.en[key];
  if (template == null) return key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in params)) return match;
    return formatParam(params[name], lang);
  });
}

/**
 * Localise a question fragment: a plain string stays as-is, while an object
 * `{ key, params }` is translated. Arrays are joined with the language's
 * list separators.
 */
export function localize(value, lang = current) {
  if (Array.isArray(value)) return joinList(value, lang);
  if (value && typeof value === 'object' && value.key) return t(value.key, value.params || {}, lang);
  return value == null ? '' : String(value);
}
