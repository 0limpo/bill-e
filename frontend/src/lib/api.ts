/**
 * api.ts
 * API client for Bill-e backend
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://bill-e-backend-lfwp.onrender.com";

// --- Types ---

export interface SessionResponse {
  id: string;
  is_owner: boolean;
  status: "assigning" | "finalized";
  host_step: number;  // 1=Review, 2=Assign, 3=Share
  participants: ApiParticipant[];
  items: ApiItem[];
  assignments: Record<string, ApiAssignment[]>;
  charges: ApiCharge[];
  subtotal: number;
  total: number;
  decimal_places: number;
  number_format: string;
  price_mode: "unitario" | "total_linea";
  expires_at: string;
  last_updated: string;
  totals: { participant_id: string; total: number }[];
  tip_mode?: string;
  tip_value?: number;
  tip_percentage?: number;
  has_tip?: boolean;
  // Host session tracking (only for owners)
  host_sessions_used?: number;
  host_sessions_limit?: number;
  host_is_premium?: boolean;
}

export interface ApiParticipant {
  id: string;
  name: string;
  phone?: string;
  role: "owner" | "editor";
  joined_at: string;
}

export interface ApiItem {
  id: string;
  name: string;
  price: number;
  price_as_shown?: number;  // Precio como aparece en la boleta
  quantity: number;
  mode: "individual" | "grupal";
}

export interface ApiAssignment {
  participant_id: string;
  quantity: number;
}

export interface ApiCharge {
  id: string;
  name: string;
  value: number;
  valueType: "fixed" | "percent";
  distribution: "proportional" | "per_person" | "fixed_per_person";
  isDiscount: boolean;
}

export interface PollResponse {
  has_changes: boolean;
  participants: ApiParticipant[];
  assignments: Record<string, ApiAssignment[]>;
  items: ApiItem[];
  status: "assigning" | "finalized";
  host_step: number;  // 1=Review, 2=Assign, 3=Share
  totals: { participant_id: string; total: number }[];
  charges: ApiCharge[];
  tip_mode?: string;
  tip_value?: number;
  tip_percentage?: number;
  has_tip?: boolean;
  number_format?: string;
  last_updated: string;
}

// --- Helper ---

/**
 * Get or create a unique device ID for this browser
 */
export function getDeviceId(): string {
  const DEVICE_ID_KEY = "bill-e-device-id";
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `API error: ${response.status}`);
  }

  return response.json();
}

// --- Session Endpoints ---

/**
 * Load collaborative session data
 */
export async function loadSession(
  sessionId: string,
  ownerToken?: string
): Promise<SessionResponse> {
  let url = `/api/session/${sessionId}/collaborative`;
  if (ownerToken) {
    const deviceId = getDeviceId();
    url += `?owner=${ownerToken}&device_id=${deviceId}`;
  }
  return apiRequest<SessionResponse>(url);
}

/**
 * Poll for session changes (real-time sync)
 */
export async function pollSession(
  sessionId: string,
  lastUpdate: string
): Promise<PollResponse> {
  return apiRequest<PollResponse>(
    `/api/session/${sessionId}/poll?last_update=${encodeURIComponent(lastUpdate)}`
  );
}

// --- Participant Endpoints ---

export interface JoinSessionResponse {
  participant?: ApiParticipant;
  is_existing?: boolean;
  is_owner?: boolean;
  sessions_used?: number;
  sessions_remaining?: number;
  // Limit reached response
  status?: "limit_reached";
  free_limit?: number;
  requires_payment?: boolean;
}

/**
 * Join a session as a participant
 */
export async function joinSession(
  sessionId: string,
  name: string,
  phone?: string
): Promise<JoinSessionResponse> {
  const deviceId = getDeviceId();
  return apiRequest(`/api/session/${sessionId}/join`, {
    method: "POST",
    body: JSON.stringify({ name, phone, device_id: deviceId }),
  });
}

export interface SelectParticipantResponse {
  status: "ok" | "limit_reached";
  sessions_used?: number;
  sessions_remaining?: number;
  free_limit?: number;
  requires_payment?: boolean;
}

/**
 * Select an existing participant (checks device limit)
 */
export async function selectExistingParticipant(
  sessionId: string,
  participantId: string
): Promise<SelectParticipantResponse> {
  const deviceId = getDeviceId();
  return apiRequest<SelectParticipantResponse>(`/api/session/${sessionId}/select-participant`, {
    method: "POST",
    body: JSON.stringify({ participant_id: participantId, device_id: deviceId }),
  });
}

/**
 * Update participant name
 */
export async function updateParticipant(
  sessionId: string,
  participantId: string,
  name: string
): Promise<{ success: boolean }> {
  return apiRequest(`/api/session/${sessionId}/participant/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/**
 * Remove participant from session
 */
export async function removeParticipant(
  sessionId: string,
  participantId: string,
  ownerToken: string
): Promise<{ success: boolean }> {
  return apiRequest(`/api/session/${sessionId}/participant/${participantId}`, {
    method: "DELETE",
    body: JSON.stringify({ owner_token: ownerToken }),
  });
}

/**
 * Add participant manually (owner only)
 */
export async function addParticipantManual(
  sessionId: string,
  ownerToken: string,
  name: string,
  phone?: string
): Promise<{ participant: ApiParticipant }> {
  return apiRequest(`/api/session/${sessionId}/add-participant-manual`, {
    method: "POST",
    body: JSON.stringify({ owner_token: ownerToken, name, phone }),
  });
}

// --- Item Endpoints ---

/**
 * Add new item to session
 */
export async function addItem(
  sessionId: string,
  ownerToken: string,
  item: { name: string; price: number; quantity: number }
): Promise<{ item: ApiItem }> {
  return apiRequest(`/api/session/${sessionId}/add-item`, {
    method: "POST",
    body: JSON.stringify({
      owner_token: ownerToken,
      ...item,
    }),
  });
}

/**
 * Update item details
 */
export async function updateItem(
  sessionId: string,
  ownerToken: string | null,
  itemId: string,
  updates: Partial<{ name: string; price: number; quantity: number; mode: "individual" | "grupal" }>
): Promise<{ success: boolean }> {
  return apiRequest(`/api/session/${sessionId}/update-item`, {
    method: "POST",
    body: JSON.stringify({
      owner_token: ownerToken,
      item_id: itemId,
      updates,
    }),
  });
}

/**
 * Delete item from session
 */
export async function deleteItem(
  sessionId: string,
  itemId: string,
  ownerToken: string
): Promise<{ success: boolean }> {
  return apiRequest(`/api/session/${sessionId}/items/${itemId}`, {
    method: "DELETE",
    body: JSON.stringify({ owner_token: ownerToken }),
  });
}

// --- Assignment Endpoints ---

/**
 * Assign/unassign item to participant
 */
export async function assignItem(
  sessionId: string,
  itemId: string,
  participantId: string,
  quantity: number,
  isAssigned: boolean,
  updatedBy: string
): Promise<{ success: boolean }> {
  return apiRequest(`/api/session/${sessionId}/assign`, {
    method: "POST",
    body: JSON.stringify({
      item_id: itemId,
      participant_id: participantId,
      quantity,
      is_assigned: isAssigned,
      updated_by: updatedBy,
    }),
  });
}

// --- Charges/Totals Endpoints ---

/**
 * Update charges (tips, taxes, discounts)
 */
export async function updateCharges(
  sessionId: string,
  ownerToken: string,
  charges: ApiCharge[]
): Promise<{ success: boolean }> {
  return apiRequest(`/api/session/${sessionId}/update-totals`, {
    method: "POST",
    body: JSON.stringify({
      owner_token: ownerToken,
      charges,
    }),
  });
}

/**
 * Update original subtotal (OCR value)
 */
export async function updateSubtotal(
  sessionId: string,
  ownerToken: string,
  subtotal: number
): Promise<{ success: boolean }> {
  return apiRequest(`/api/session/${sessionId}/update-totals`, {
    method: "POST",
    body: JSON.stringify({
      owner_token: ownerToken,
      subtotal,
    }),
  });
}

/**
 * Update original total (OCR value)
 */
export async function updateTotal(
  sessionId: string,
  ownerToken: string,
  total: number
): Promise<{ success: boolean }> {
  return apiRequest(`/api/session/${sessionId}/update-totals`, {
    method: "POST",
    body: JSON.stringify({
      owner_token: ownerToken,
      total,
    }),
  });
}

// --- Session Status Endpoints ---

/**
 * Finalize/close the bill
 */
export interface FinalizeSessionResponse {
  success?: boolean;
  error?: string;
  sessions_used?: number;
  free_limit?: number;
  requires_payment?: boolean;
  host_sessions_used?: number;
  host_sessions_remaining?: number;
}

export async function finalizeSession(
  sessionId: string,
  ownerToken: string
): Promise<FinalizeSessionResponse> {
  return apiRequest(`/api/session/${sessionId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ owner_token: ownerToken }),
  });
}

/**
 * Reopen a finalized session
 */
export async function reopenSession(
  sessionId: string,
  ownerToken: string
): Promise<{ success: boolean }> {
  return apiRequest(`/api/session/${sessionId}/reopen`, {
    method: "POST",
    body: JSON.stringify({ owner_token: ownerToken }),
  });
}

/**
 * Update host's current step (owner only)
 */
export async function updateHostStep(
  sessionId: string,
  ownerToken: string,
  step: number
): Promise<{ success: boolean; host_step: number }> {
  return apiRequest(`/api/session/${sessionId}/host-step`, {
    method: "POST",
    body: JSON.stringify({ owner_token: ownerToken, step }),
  });
}

// --- Session Creation ---

export interface CreateSessionResponse {
  session_id: string;
  expires_at: string;
  frontend_url: string;
}

export interface OCRResponse {
  success: boolean;
  items: Array<{
    name: string;
    price: number;
    quantity: number;
  }>;
  subtotal: number;
  total: number;
  tip?: number;
  charges?: ApiCharge[];
  raw_text?: string;
}

/**
 * Create a new empty session
 */
export async function createSession(): Promise<CreateSessionResponse> {
  return apiRequest<CreateSessionResponse>("/api/session", {
    method: "POST",
  });
}

/**
 * Process receipt image with OCR
 */
export async function processOCR(
  sessionId: string,
  imageBase64: string
): Promise<OCRResponse> {
  return apiRequest<OCRResponse>(`/api/session/${sessionId}/ocr`, {
    method: "POST",
    body: JSON.stringify({ image: imageBase64 }),
  });
}

/**
 * Create collaborative session with OCR data
 */
export async function createCollaborativeSession(
  data: {
    owner_phone?: string;
    items: Array<{ name: string; price: number; quantity: number }>;
    total: number;
    subtotal: number;
    tip?: number;
    charges?: ApiCharge[];
    raw_text?: string;
    decimal_places?: number;
  }
): Promise<{ session_id: string; owner_token: string; frontend_url: string }> {
  const deviceId = getDeviceId();
  return apiRequest("/api/session/collaborative", {
    method: "POST",
    body: JSON.stringify({ ...data, device_id: deviceId }),
  });
}

// --- Analytics ---

/**
 * Send analytics event
 */
export async function trackEvent(
  eventName: string,
  eventData: Record<string, unknown>
): Promise<void> {
  try {
    await apiRequest(`/api/analytics/event`, {
      method: "POST",
      body: JSON.stringify({
        event: eventName,
        data: eventData,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Silent fail for analytics
    console.debug("Analytics event failed:", eventName);
  }
}

// --- Polling Hook Helper ---

/**
 * Create a polling controller for real-time sync
 */
export function createPollingController(
  sessionId: string,
  onUpdate: (data: PollResponse) => void,
  interval: number = 3000
) {
  let lastUpdate = "";
  let lastInteraction = 0;
  let timeoutId: NodeJS.Timeout | null = null;
  let isRunning = false;

  const poll = async () => {
    if (!isRunning) return;

    // Skip if user interacted recently (prevents race conditions)
    if (Date.now() - lastInteraction < 8000) {
      timeoutId = setTimeout(poll, interval);
      return;
    }

    try {
      const data = await pollSession(sessionId, lastUpdate);
      if (data.has_changes) {
        lastUpdate = data.last_updated;
        onUpdate(data);
      }
    } catch (err) {
      console.error("Polling error:", err);
    }

    if (isRunning) {
      timeoutId = setTimeout(poll, interval);
    }
  };

  return {
    start: () => {
      isRunning = true;
      poll();
    },
    stop: () => {
      isRunning = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
    markInteraction: () => {
      lastInteraction = Date.now();
    },
    setLastUpdate: (ts: string) => {
      lastUpdate = ts;
    },
  };
}

// --- Editor Verification Endpoints ---

export interface EditorStatusResponse {
  status: "premium" | "needs_code" | "paywall";
  free_remaining?: number;
  is_premium: boolean;
}

export interface RequestCodeResponse {
  status: "premium" | "code_sent" | "paywall";
  message: string;
  free_remaining?: number;
}

export interface VerifyCodeResponse {
  status: "verified";
  message: string;
  free_remaining: number;
}

/**
 * Check editor status (premium, needs code, or paywall)
 */
export async function getEditorStatus(
  phone: string,
  sessionId: string
): Promise<EditorStatusResponse> {
  return apiRequest<EditorStatusResponse>(
    `/api/editor/status?phone=${encodeURIComponent(phone)}&session_id=${sessionId}`
  );
}

/**
 * Request verification code via WhatsApp
 */
export async function requestEditorCode(
  phone: string,
  sessionId: string
): Promise<RequestCodeResponse> {
  return apiRequest<RequestCodeResponse>("/api/editor/request-code", {
    method: "POST",
    body: JSON.stringify({ phone, session_id: sessionId }),
  });
}

/**
 * Verify the code received via WhatsApp
 */
export async function verifyEditorCode(
  phone: string,
  code: string,
  sessionId: string
): Promise<VerifyCodeResponse> {
  return apiRequest<VerifyCodeResponse>("/api/editor/verify-code", {
    method: "POST",
    body: JSON.stringify({ phone, code, session_id: sessionId }),
  });
}
