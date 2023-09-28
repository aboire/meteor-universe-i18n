import { EventEmitter } from 'events';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';

import { get, isJSONObject, set } from './utils';
import type { JSON, JSONObject } from './utils';

export interface GetCacheEntry {
  getJS(locale: string, namespace?: string, isBefore?: boolean): string;
  getJSON(locale: string, namespace?: string, diff?: string): string;
  getYML(locale: string, namespace?: string, diff?: string): string;
  updatedAt: string;
}

export interface GetCacheFunction {
  (): Record<string, GetCacheEntry>;
  (locale: string): GetCacheEntry;
}

export interface GetTranslationOptions {
  _locale?: string;
  _namespace?: string;
  _count?: number;
  [key: string]: unknown;
}

export interface LoadLocaleOptions {
  async?: boolean;
  fresh?: boolean;
  host?: string;
  pathOnHost?: string;
  queryParams?: Record<string, unknown>;
  silent?: boolean;
}

export interface Options {
  close: string;
  defaultLocale: string;
  hideMissing: boolean;
  hostUrl: string;
  ignoreNoopLocaleChanges: boolean;
  localeRegEx: RegExp;
  open: string;
  pathOnHost: string;
  sameLocaleOnServerConnection: boolean;
  translationsHeaders: Record<string, string>;
  pluralizationRules: Record<string, (count: number) => number>;
  pluralizationDivider: string;
}

export interface SetLocaleOptions extends LoadLocaleOptions {
  noDownload?: boolean;
}

const i18n = {
  _contextualLocale: new Meteor.EnvironmentVariable<string | undefined>(),
  _deps: new Tracker.Dependency(),
  _emitChange(locale?: string) {
    i18n._events.emit('changeLocale', locale ?? i18n._locale);
    i18n._deps.changed();
  },
  _events: new EventEmitter(),
  _formatgetters: {
    getJS: () => '',
    getJSON: () => '',
    getYML: () => '',
  } as Pick<GetCacheEntry, 'getJS' | 'getJSON' | 'getYML'>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _getConnectionId(connection?: Meteor.Connection | null) {
    // Actual implementation is only on the server.
    return undefined as string | undefined;
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _getConnectionLocale(connection?: Meteor.Connection | null) {
    // Actual implementation is only on the server.
    return undefined as string | undefined;
  },
  _isLoaded: {} as Record<string, boolean>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _loadLocaleWithAncestors(locale: string, options?: SetLocaleOptions) {
    // Actual implementation is only on the client.
    return Promise.resolve();
  },
  _locale: 'en',
  _logger(error: unknown) {
    console.error(error);
  },
  _normalizeWithAncestors(locale = '') {
    if (!(locale in i18n._normalizeWithAncestorsCache)) {
      const locales: string[] = [];
      const parts = locale.split(/[-_]/);
      while (parts.length) {
        const locale = parts.join('-');
        if (i18n.options.localeRegEx.exec(locale)) {
          const formattedLocale = locale
            .split(/[-_]/)
            .map((part, index) =>
              index ? part.toUpperCase() : part.toLowerCase(),
            )
            .join('-');

          locales.push(formattedLocale);
        }

        parts.pop();
      }

      i18n._normalizeWithAncestorsCache[locale] = locales;
    }

    return i18n._normalizeWithAncestorsCache[locale];
  },
  _normalizeWithAncestorsCache: {} as Record<string, readonly string[]>,
  _translations: {} as JSONObject,
  _ts: 0,
  _interpolateTranslation(
    variables: Record<string, unknown>,
    translation: string,
  ) {
    let interpolatedTranslation = translation;
    Object.entries(variables).forEach(([key, value]) => {
      const tag = i18n.options.open + key + i18n.options.close;
      if (interpolatedTranslation.includes(tag)) {
        interpolatedTranslation = interpolatedTranslation
          .split(tag)
          .join(value as string);
      }
    });
    return interpolatedTranslation;
  },
  _normalizeGetTranslation(locales: string[], key: string) {
    let translation: unknown;
    locales.some(locale =>
      i18n._normalizeWithAncestors(locale).some(locale => {
        translation = get(i18n._translations, `${locale}.${key}`);
        return translation !== undefined;
      }),
    );
    // changement pour pouvoir renvoyer un objet
    // const translationWithHideMissing = translation
    //   ? `${translation}`
    //   : i18n.options.hideMissing
    //     ? ''
    //     : key;

    const translationWithHideMissing = translation
      ? translation
      : i18n.options.hideMissing
        ? ''
        : key;

    return translationWithHideMissing;
  },
  _pluralizeTranslation(translation: string, locale: string, count?: number) {
    const pluralizationRules = _i18n.options.pluralizationRules;
    if (count !== undefined) {
      const index = pluralizationRules?.[locale]?.(count) ?? count;

      const options = translation.split(_i18n.options.pluralizationDivider);
      const pluralized = options[Math.min(index, options.length - 1)];
      return pluralized;
    }
    return translation;
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  __(...args: unknown[]) {
    // This will be aliased to i18n.getTranslation.
    return '';
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addTranslation(locale: string, ...args: unknown[]) {
    // This will be aliased to i18n.addTranslations.
    return {};
  },
  addTranslations(locale: string, ...args: unknown[]) {
    const translation = args.pop() as JSONObject;
    const path = args.join('.').replace(/(^\.)|(\.\.)|(\.$)/g, '');

    if (typeof translation === 'string') {
      set(i18n._translations, `${i18n.normalize(locale)}.${path}`, translation);
    } else if (typeof translation === 'object' && !!translation) {
      Object.keys(translation)
        .sort()
        .forEach(key => {
          i18n.addTranslations(locale, `${path}.${key}`, translation[key]);
        });
    }

    return i18n._translations;
  },
  getAllKeysForLocale(locale?: string, exactlyThis = false) {
    if (locale === undefined) {
      locale = i18n.getLocale();
    }

    const keys: Record<string, boolean> = Object.create(null);
    function walk(path: string[], data: JSON) {
      if (isJSONObject(data)) {
        for (const [key, value] of Object.entries(data)) {
          path.push(key);
          walk(path, value);
          path.pop();
        }
      } else {
        keys[path.join('.')] = true;
      }
    }

    const path: string[] = [];
    walk(path, i18n._translations[locale]);

    const index = locale.indexOf('-');
    if (!exactlyThis && index >= 2) {
      locale = locale.substr(0, index);
      walk(path, i18n._translations[locale]);
    }

    return Object.keys(keys);
  },
  getCache: (() => ({})) as GetCacheFunction,
  getLocales() {
    return Object.keys(i18n._translations);
  },
  getLocale() {
    return (
      i18n._contextualLocale.get() ?? i18n._locale ?? i18n.options.defaultLocale
    );
  },
  getTranslation(...args: unknown[]) {
    const maybeOptions = args[args.length - 1];
    const hasOptions = typeof maybeOptions === 'object' && !!maybeOptions;
    const keys = hasOptions ? args.slice(0, -1) : args;
    const options = hasOptions ? (maybeOptions as GetTranslationOptions) : {};

    const key = keys.filter(key => key && typeof key === 'string').join('.');
    const { defaultLocale } = i18n.options;
    const { _locale: locale = i18n.getLocale(), ...variables } = options;

    const translation = i18n._normalizeGetTranslation(
      [locale, defaultLocale],
      key,
    );

    if (typeof translation === 'object') {
      return translation;
    } else if (typeof translation === 'string') {
      const interpolatedTranslation = i18n._interpolateTranslation(
        variables,
        translation,
      );
      const pluralizedTranslation = i18n._pluralizeTranslation(
        interpolatedTranslation,
        locale,
        variables._count,
      );

      return pluralizedTranslation;
    }
  },
  getTranslations(key?: string, locale?: string) {
    if (locale === undefined) {
      locale = i18n.getLocale();
    }

    const path = locale ? (key ? `${locale}.${key}` : locale) : key ?? '';
    return get(i18n._translations, path) ?? {};
  },
  isLoaded(locale?: string) {
    return i18n._isLoaded[locale ?? i18n.getLocale()];
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadLocale(locale: string, options?: LoadLocaleOptions) {
    // Actual implementation is only on the client.
    return Promise.resolve<HTMLScriptElement | undefined>(undefined);
  },
  normalize(locale: string) {
    return i18n._normalizeWithAncestors(locale)[0] as string | undefined;
  },
  offChangeLocale(fn: (locale: string) => void) {
    i18n._events.removeListener('changeLocale', fn);
  },
  onChangeLocale(fn: (locale: string) => void) {
    i18n._events.on('changeLocale', fn);
  },
  onceChangeLocale(fn: (locale: string) => void) {
    i18n._events.once('changeLocale', fn);
  },
  options: {
    close: '}',
    defaultLocale: 'en',
    hideMissing: false,
    hostUrl: '/',
    ignoreNoopLocaleChanges: false,
    localeRegEx: /^[aA-zZ]{2}(-[aA-zZ]{2})?$/,
    open: '{$',
    pathOnHost: 'universe/locale/',
    sameLocaleOnServerConnection: true,
    translationsHeaders: { 'Cache-Control': 'max-age=2628000' },
    pluralizationRules: {},
    pluralizationDivider: ' | ',
  } as Options,
  runWithLocale<T>(locale = '', fn: () => T): T {
    return i18n._contextualLocale.withValue(i18n.normalize(locale), fn);
  },
  setLocale(locale: string, options?: SetLocaleOptions) {
    const normalizedLocale = i18n.normalize(locale);
    if (!normalizedLocale) {
      const message = `Unrecognized locale "${locale}"`;
      i18n._logger(message);
      return Promise.reject(message);
    }

    if (
      i18n.options.ignoreNoopLocaleChanges &&
      i18n.getLocale() === normalizedLocale
    ) {
      return Promise.resolve();
    }

    i18n._locale = normalizedLocale;

    let promise = i18n._loadLocaleWithAncestors(normalizedLocale, options);
    if (!options?.silent) {
      promise = promise.then(() => {
        i18n._emitChange();
      });
    }

    return promise;
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setLocaleOnConnection(locale: string, connectionId?: string) {
    // Actual implementation is only on the server.
  },
  setOptions(options: Partial<Options>) {
    Object.assign(i18n.options, options);
  },
};

i18n.__ = i18n.getTranslation;
i18n.addTranslation = i18n.addTranslations;

export { i18n };
export default i18n;
