/**
 * INTEGRATION GUIDE: Analytics in App.js
 *
 * Add these imports and tracking calls to your App.js
 * This file shows WHERE to add analytics tracking
 */

// 1. ADD IMPORT AT TOP OF APP.JS
import {
  initGA,
  trackPageView,
  trackSessionLoad,
  trackPersonAdded,
  trackItemAssignment,
  trackCalculationComplete,
  trackShare,
  trackTipChange,
  trackItemEdit,
  trackError,
  trackFunnelStep,
  trackEngagement
} from './analytics';

// 2. INITIALIZE GA ON APP MOUNT (in main App component or index.js)
useEffect(() => {
  initGA();
}, []);

// 3. TRACK PAGE VIEW when session loads
useEffect(() => {
  if (id) {
    trackPageView(`/s/${id}`, `Session ${id}`);
  }
}, [id]);

// 4. IN loadSessionData() - after successful load
const loadSessionData = async (sessionId) => {
  const startTime = performance.now();

  try {
    setLoading(true);
    const response = await fetch(`...`);

    if (!response.ok) {
      throw new Error('Sesión no encontrada o expirada');
    }

    const data = await response.json();
    setSessionData(data);

    // ✅ TRACK SESSION LOAD
    const loadTime = performance.now() - startTime;
    trackSessionLoad(
      sessionId,
      data.items?.length || 0,
      data.total || 0,
      data.phone_number ? 'whatsapp' : 'web'
    );

    // Track funnel step
    trackFunnelStep('session_loaded', sessionId, {
      item_count: data.items?.length || 0,
      total: data.total || 0,
      load_time_ms: loadTime
    });

    // ... rest of your code
  } catch (error) {
    // ✅ TRACK ERROR
    trackError('session_load_failed', error.message, sessionId);
    setError(error.message);
  } finally {
    setLoading(false);
  }
};

// 5. IN addPerson() - after adding person
const addPerson = () => {
  if (newPersonName.trim() && !people.find(p => p.name === newPersonName.trim())) {
    const newPeople = [...people, { name: newPersonName.trim(), amount: 0 }];
    setPeople(newPeople);
    setNewPersonName('');

    // ✅ TRACK PERSON ADDED
    trackPersonAdded(id, newPeople.length);
    trackFunnelStep('person_added', id, {
      person_count: newPeople.length
    });

    calculatePersonAmounts(assignments);
  }
};

// 6. IN toggleItemAssignment() - after assignment change
const toggleItemAssignment = (itemName, personName) => {
  const currentAssignments = assignments[itemName] || [];
  const isAssigned = currentAssignments.includes(personName);

  const updatedAssignments = {
    ...assignments,
    [itemName]: isAssigned
      ? currentAssignments.filter(name => name !== personName)
      : [...currentAssignments, personName]
  };

  setAssignments(updatedAssignments);

  // ✅ TRACK ITEM ASSIGNMENT
  if (!isAssigned) { // Only track when assigning (not unassigning)
    trackItemAssignment(id, itemName, personName);
  }

  // Check if this is first assignment (funnel step)
  const totalAssignments = Object.values(updatedAssignments)
    .reduce((sum, arr) => sum + arr.length, 0);

  if (totalAssignments === 1) {
    trackFunnelStep('items_assigned', id, {
      first_assignment: itemName
    });
  }

  calculatePersonAmounts(updatedAssignments);
};

// 7. IN calculatePersonAmounts() - after calculation complete
const calculatePersonAmounts = (currentAssignments) => {
  if (!sessionData || people.length === 0) return;

  const totalTip = parseFloat(customTipAmount) || 0;

  // ... your calculation logic ...

  setPeople(updatedPeople);

  // ✅ TRACK CALCULATION COMPLETE (only if people have amounts)
  const hasAssignments = updatedPeople.some(p => p.amount > 0);
  if (hasAssignments) {
    trackCalculationComplete(
      id,
      people.length,
      sessionData.items?.length || 0,
      getCurrentTotal(),
      totalTip
    );

    trackFunnelStep('calculation_viewed', id, {
      people_count: people.length,
      total: getCurrentTotal()
    });
  }
};

// 8. ADD SHARE BUTTON CLICK HANDLER
const handleShareClick = async () => {
  const url = window.location.href;

  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Bill-e - Divide tu cuenta',
        text: `Ayúdame a dividir esta cuenta de $${formatCurrency(getCurrentTotal())}`,
        url: url
      });

      // ✅ TRACK SHARE
      trackShare(id, 'native_share');
    } else {
      // Fallback to copy
      await navigator.clipboard.writeText(url);
      alert('Link copiado al portapapeles');

      // ✅ TRACK SHARE
      trackShare(id, 'copy_link');
    }

    trackFunnelStep('share_initiated', id);

  } catch (error) {
    trackError('share_failed', error.message, id);
  }
};

// 9. IN TIP CHANGE HANDLER
const handleTipChange = (newTipAmount) => {
  const oldTip = customTipAmount;
  setCustomTipAmount(newTipAmount);

  // ✅ TRACK TIP CHANGE
  trackTipChange(id, parseFloat(oldTip) || 0, parseFloat(newTipAmount) || 0, false);

  calculatePersonAmounts(assignments);
};

// 10. IN ITEM EDIT HANDLER (if you have one)
const handleItemEdit = (itemName, field, newValue) => {
  const item = sessionData.items.find(i => i.name === itemName);
  const oldValue = item[field];

  // ... your edit logic ...

  // ✅ TRACK ITEM EDIT
  trackItemEdit(id, itemName, field, oldValue, newValue);
};

// 11. TRACK ENGAGEMENT TIME (on component unmount)
useEffect(() => {
  const startTime = Date.now();

  return () => {
    const timeSpent = Math.floor((Date.now() - startTime) / 1000);
    if (timeSpent > 5) { // Only track if spent more than 5 seconds
      trackEngagement(id, timeSpent);
    }
  };
}, [id]);

// 12. ERROR BOUNDARY (optional but recommended)
class ErrorBoundary extends React.Component {
  componentDidCatch(error, errorInfo) {
    trackError('react_error', error.message, null);
  }

  render() {
    return this.props.children;
  }
}

export default ErrorBoundary;
