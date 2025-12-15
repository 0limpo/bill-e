import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translations
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';
import zh from './locales/zh.json';
import hi from './locales/hi.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import bn from './locales/bn.json';
import ru from './locales/ru.json';
import ja from './locales/ja.json';
import de from './locales/de.json';
import id from './locales/id.json';

const resources = {
  es: { translation: es },
  en: { translation: en },
  pt: { translation: pt },
  zh: { translation: zh },
  hi: { translation: hi },
  fr: { translation: fr },
  ar: { translation: ar },
  bn: { translation: bn },
  ru: { translation: ru },
  ja: { translation: ja },
  de: { translation: de },
  id: { translation: id }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['es', 'en', 'pt', 'zh', 'hi', 'fr', 'ar', 'bn', 'ru', 'ja', 'de', 'id'],

    detection: {
      order: ['navigator', 'htmlTag'],
      caches: []
    },

    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
