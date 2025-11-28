/**
 * Google Analytics 4 Integration for Bill-e
 * Tracks user behavior, conversions, and key metrics
 */

// Google Analytics 4 Measurement ID (replace with your actual ID)
const GA_MEASUREMENT_ID = process.env.REACT_APP_GA_MEASUREMENT_ID || 'G-XXXXXXXXXX';

/**
 * Initialize Google Analytics 4
 */
export const initGA = () => {
  // Check if GA is already loaded
  if (window.gtag) {
    console.log('✅ Google Analytics already initialized');
    return;
  }

  // Load GA4 script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  // Initialize gtag
  window.dataLayer = window.dataLayer || [];
  window.gtag = function() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: false, // We'll send manually
    cookie_flags: 'SameSite=None;Secure'
  });

  console.log('✅ Google Analytics 4 initialized');
};

/**
 * Track page views
 */
export const trackPageView = (path, title) => {
  if (!window.gtag) {
    console.warn('⚠️ GA not initialized');
    return;
  }

  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title,
    page_location: window.location.href
  });

  console.log('📊 Page view tracked:', path);
};

/**
 * Track custom events
 */
export const trackEvent = (eventName, eventParams = {}) => {
  if (!window.gtag) {
    console.warn('⚠️ GA not initialized');
    return;
  }

  // Add timestamp to all events
  const params = {
    ...eventParams,
    timestamp: new Date().toISOString()
  };

  window.gtag('event', eventName, params);
  console.log('📊 Event tracked:', eventName, params);

  // Also send to our backend analytics
  sendToBackendAnalytics(eventName, params);
};

/**
 * Track session creation
 */
export const trackSessionCreation = (sessionId, source = 'web') => {
  trackEvent('session_created', {
    event_category: 'Session',
    event_label: sessionId,
    source: source,
    session_id: sessionId
  });
};

/**
 * Track session load
 */
export const trackSessionLoad = (sessionId, itemCount, total, source = 'web') => {
  trackEvent('session_loaded', {
    event_category: 'Session',
    event_label: sessionId,
    session_id: sessionId,
    item_count: itemCount,
    total_amount: total,
    source: source
  });
};

/**
 * Track OCR usage
 */
export const trackOCRUsage = (sessionId, success, itemCount, processingTime) => {
  trackEvent('ocr_used', {
    event_category: 'OCR',
    event_label: success ? 'success' : 'failure',
    session_id: sessionId,
    success: success,
    item_count: itemCount,
    processing_time_ms: processingTime
  });

  // Track conversion for successful OCR
  if (success) {
    trackEvent('ocr_success', {
      event_category: 'Conversion',
      value: itemCount,
      currency: 'CLP'
    });
  }
};

/**
 * Track item assignment
 */
export const trackItemAssignment = (sessionId, itemId, personId) => {
  trackEvent('item_assigned', {
    event_category: 'Interaction',
    event_label: 'item_assignment',
    session_id: sessionId,
    item_id: itemId,
    person_id: personId
  });
};

/**
 * Track person addition
 */
export const trackPersonAdded = (sessionId, personCount) => {
  trackEvent('person_added', {
    event_category: 'Interaction',
    event_label: 'add_person',
    session_id: sessionId,
    total_people: personCount
  });
};

/**
 * Track sharing
 */
export const trackShare = (sessionId, method = 'copy_link') => {
  trackEvent('share', {
    event_category: 'Engagement',
    event_label: method,
    session_id: sessionId,
    method: method
  });
};

/**
 * Track calculation completion
 */
export const trackCalculationComplete = (sessionId, peopleCount, itemCount, totalAmount, tipAmount) => {
  trackEvent('calculation_complete', {
    event_category: 'Conversion',
    event_label: sessionId,
    session_id: sessionId,
    people_count: peopleCount,
    item_count: itemCount,
    total_amount: totalAmount,
    tip_amount: tipAmount,
    value: totalAmount
  });

  // Track as conversion
  trackEvent('conversion', {
    event_category: 'Conversion',
    event_label: 'bill_split_complete',
    value: totalAmount,
    currency: 'CLP'
  });
};

/**
 * Track errors
 */
export const trackError = (errorType, errorMessage, sessionId = null) => {
  trackEvent('error', {
    event_category: 'Error',
    event_label: errorType,
    error_type: errorType,
    error_message: errorMessage,
    session_id: sessionId
  });
};

/**
 * Track tip change
 */
export const trackTipChange = (sessionId, oldTip, newTip, isPercentage) => {
  trackEvent('tip_changed', {
    event_category: 'Interaction',
    event_label: 'tip_adjustment',
    session_id: sessionId,
    old_tip: oldTip,
    new_tip: newTip,
    is_percentage: isPercentage
  });
};

/**
 * Track item edit
 */
export const trackItemEdit = (sessionId, itemId, field, oldValue, newValue) => {
  trackEvent('item_edited', {
    event_category: 'Interaction',
    event_label: 'item_modification',
    session_id: sessionId,
    item_id: itemId,
    field: field,
    old_value: oldValue,
    new_value: newValue
  });
};

/**
 * Track session expiration
 */
export const trackSessionExpired = (sessionId) => {
  trackEvent('session_expired', {
    event_category: 'Session',
    event_label: 'expired',
    session_id: sessionId
  });
};

/**
 * Track timing events
 */
export const trackTiming = (category, variable, value, label) => {
  if (!window.gtag) return;

  window.gtag('event', 'timing_complete', {
    name: variable,
    value: value,
    event_category: category,
    event_label: label
  });
};

/**
 * Send analytics to backend for additional processing
 */
const sendToBackendAnalytics = async (eventName, eventParams) => {
  try {
    const backendUrl = process.env.REACT_APP_API_URL || 'https://bill-e-backend-lfwp.onrender.com';

    await fetch(`${backendUrl}/api/analytics/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event_name: eventName,
        event_params: eventParams,
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString()
      })
    });
  } catch (error) {
    // Silently fail - analytics shouldn't break the app
    console.warn('Failed to send analytics to backend:', error);
  }
};

/**
 * Track user flow through the funnel
 */
export const trackFunnelStep = (step, sessionId, metadata = {}) => {
  const funnelSteps = {
    'session_created': 1,
    'session_loaded': 2,
    'person_added': 3,
    'items_assigned': 4,
    'calculation_viewed': 5,
    'share_initiated': 6
  };

  trackEvent('funnel_step', {
    event_category: 'Funnel',
    event_label: step,
    step_number: funnelSteps[step] || 0,
    step_name: step,
    session_id: sessionId,
    ...metadata
  });
};

/**
 * Track user engagement time
 */
export const trackEngagement = (sessionId, timeSpentSeconds) => {
  trackEvent('user_engagement', {
    event_category: 'Engagement',
    event_label: 'time_on_session',
    session_id: sessionId,
    engagement_time_seconds: timeSpentSeconds,
    value: timeSpentSeconds
  });
};

/**
 * Track WhatsApp source
 */
export const trackWhatsAppSource = (sessionId, phoneNumber) => {
  trackEvent('whatsapp_session', {
    event_category: 'Source',
    event_label: 'whatsapp',
    session_id: sessionId,
    source: 'whatsapp',
    medium: 'chat'
  });
};

/**
 * Set user properties
 */
export const setUserProperty = (property, value) => {
  if (!window.gtag) return;

  window.gtag('set', 'user_properties', {
    [property]: value
  });
};

/**
 * Track performance metrics
 */
export const trackPerformance = (metric, value, sessionId) => {
  trackTiming('Performance', metric, value, sessionId);
};

// Export all tracking functions
export default {
  initGA,
  trackPageView,
  trackEvent,
  trackSessionCreation,
  trackSessionLoad,
  trackOCRUsage,
  trackItemAssignment,
  trackPersonAdded,
  trackShare,
  trackCalculationComplete,
  trackError,
  trackTipChange,
  trackItemEdit,
  trackSessionExpired,
  trackTiming,
  trackFunnelStep,
  trackEngagement,
  trackWhatsAppSource,
  setUserProperty,
  trackPerformance
};
