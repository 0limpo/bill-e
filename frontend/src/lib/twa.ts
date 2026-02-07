/**
 * TWA (Trusted Web Activity) Detection and Google Play Billing utilities
 *
 * Used to detect if the app is running inside the Play Store TWA
 * and to handle Google Play Billing when available.
 */

/**
 * Detect if running inside a TWA (Trusted Web Activity)
 * This happens when the app is installed from Google Play Store
 */
export function isTWA(): boolean {
  if (typeof window === 'undefined') return false;

  // Method 1: Check document.referrer for android-app://
  const isFromAndroidApp = document.referrer.includes('android-app://');

  // Method 2: Check if running in standalone mode on Android
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isStandaloneAndroid = isStandalone && isAndroid;

  // Method 3: Check for TWA-specific features
  const hasDigitalGoods = 'getDigitalGoodsService' in window;

  return isFromAndroidApp || isStandaloneAndroid || hasDigitalGoods;
}

/**
 * Check if Google Play Billing is available (Digital Goods API)
 */
export function isPlayBillingAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return 'getDigitalGoodsService' in window;
}

/**
 * Get the appropriate payment method based on context
 */
export type PaymentContext = 'web' | 'twa';

export function getPaymentContext(): PaymentContext {
  return isTWA() ? 'twa' : 'web';
}

/**
 * Digital Goods API types (for future Google Play Billing implementation)
 */
export interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<ItemDetails[]>;
  listPurchases(): Promise<PurchaseDetails[]>;
  consume(purchaseToken: string): Promise<void>;
}

export interface ItemDetails {
  itemId: string;
  title: string;
  description: string;
  price: {
    currency: string;
    value: string;
  };
  type: 'product' | 'subscription';
}

export interface PurchaseDetails {
  itemId: string;
  purchaseToken: string;
}

/**
 * Get Digital Goods Service (for Google Play Billing)
 * Returns null if not available (not in TWA or API not supported)
 */
export async function getDigitalGoodsService(): Promise<DigitalGoodsService | null> {
  if (!isPlayBillingAvailable()) return null;

  try {
    // @ts-ignore - Digital Goods API
    const service = await window.getDigitalGoodsService('https://play.google.com/billing');
    return service;
  } catch (error) {
    console.error('Failed to get Digital Goods Service:', error);
    return null;
  }
}

/**
 * Product IDs for Google Play Console (configure these in Play Console)
 */
export const PLAY_PRODUCT_IDS = {
  PREMIUM_1_YEAR: 'bille_premium_1_year',
} as const;

/**
 * Purchase premium via Google Play Billing
 * This will be implemented when Google Play Billing is set up
 */
export async function purchaseWithPlayBilling(productId: string): Promise<{
  success: boolean;
  purchaseToken?: string;
  error?: string;
}> {
  const service = await getDigitalGoodsService();

  if (!service) {
    return { success: false, error: 'Google Play Billing not available' };
  }

  try {
    // Get product details
    const details = await service.getDetails([productId]);

    if (!details || details.length === 0) {
      return { success: false, error: 'Product not found' };
    }

    // Create Payment Request
    const paymentMethods = [{
      supportedMethods: 'https://play.google.com/billing',
      data: {
        sku: productId,
      },
    }];

    const paymentDetails = {
      total: {
        label: details[0].title,
        amount: details[0].price,
      },
    };

    const request = new PaymentRequest(paymentMethods, paymentDetails);
    const response = await request.show();

    // Get purchase token from response
    const { purchaseToken } = response.details;

    // Complete the payment
    await response.complete('success');

    // TODO: Send purchaseToken to backend to verify and activate premium

    return { success: true, purchaseToken };
  } catch (error: any) {
    console.error('Play Billing purchase failed:', error);
    return { success: false, error: error.message || 'Purchase failed' };
  }
}

/**
 * Check existing purchases (for restoring premium status)
 */
export async function checkExistingPurchases(): Promise<PurchaseDetails[]> {
  const service = await getDigitalGoodsService();

  if (!service) {
    return [];
  }

  try {
    return await service.listPurchases();
  } catch (error) {
    console.error('Failed to list purchases:', error);
    return [];
  }
}
