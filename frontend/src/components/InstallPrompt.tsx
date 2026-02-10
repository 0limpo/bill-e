'use client';

import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type BrowserType = 'ios-safari' | 'ios-other' | 'android-firefox' | 'installable' | 'unknown';

function detectBrowser(): BrowserType {
  if (typeof window === 'undefined') return 'unknown';

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);
  const isFirefox = /Firefox/.test(ua);

  if (isIOS && isSafari) return 'ios-safari';
  if (isIOS && !isSafari) return 'ios-other';
  if (isAndroid && isFirefox) return 'android-firefox';

  return 'unknown';
}

interface InstallPromptProps {
  t?: (key: string) => string;
}

export function InstallPrompt({ t }: InstallPromptProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [browser, setBrowser] = useState<BrowserType>('unknown');
  const [showInstructions, setShowInstructions] = useState(false);

  // Fallback translator if t is not provided
  const tr = t || ((key: string) => key);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    setBrowser(detectBrowser());

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  // Don't show if already installed
  if (isInstalled) return null;

  // Native install prompt available (Chrome, Edge, Samsung Internet)
  if (deferredPrompt) {
    return (
      <button
        onClick={handleInstall}
        className="flex items-center gap-3 px-4 py-3 bg-primary/10 hover:bg-primary/20 rounded-xl transition-colors w-full max-w-sm"
      >
        <span className="text-2xl">📲</span>
        <div className="text-left">
          <p className="text-sm font-medium text-foreground">
            {tr("install.addToHome")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tr("install.addToHomeDesc")}
          </p>
        </div>
      </button>
    );
  }

  // Manual instructions for unsupported browsers
  const instructions: Record<string, { icon: string; steps: string[] }> = {
    'ios-safari': {
      icon: '📤',
      steps: [
        tr("install.iosSafari1"),
        tr("install.iosSafari2"),
        tr("install.iosSafari3"),
      ]
    },
    'ios-other': {
      icon: '🧭',
      steps: [
        tr("install.iosOther1"),
        tr("install.iosOther2"),
        tr("install.iosOther3"),
      ]
    },
    'android-firefox': {
      icon: '🦊',
      steps: [
        tr("install.androidFirefox1"),
        tr("install.androidFirefox2"),
        tr("install.androidFirefox3"),
      ]
    }
  };

  const browserInstructions = instructions[browser];

  // Don't show anything for unknown browsers on desktop
  if (!browserInstructions) return null;

  return (
    <div className="w-full max-w-sm">
      <button
        onClick={() => setShowInstructions(!showInstructions)}
        className="flex items-center gap-3 px-4 py-3 bg-primary/10 hover:bg-primary/20 rounded-xl transition-colors w-full"
      >
        <span className="text-2xl">{browserInstructions.icon}</span>
        <div className="text-left flex-1">
          <p className="text-sm font-medium text-foreground">
            {tr("install.addToHome")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tr("install.addToHomeDesc")}
          </p>
        </div>
        <span className="text-muted-foreground text-sm">
          {showInstructions ? '▲' : '▼'}
        </span>
      </button>

      {showInstructions && (
        <div className="mt-2 px-4 py-3 bg-card border border-border rounded-xl">
          <p className="text-xs text-muted-foreground mb-2">{tr("install.howTo")}</p>
          <ol className="space-y-1">
            {browserInstructions.steps.map((step, i) => (
              <li key={i} className="text-sm text-foreground flex gap-2">
                <span className="text-muted-foreground">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
