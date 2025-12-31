"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { StepReview } from "@/components/steps/StepReview";
import { StepAssign } from "@/components/steps/StepAssign";
import { StepShare } from "@/components/steps/StepShare";
import { getTranslator, detectLanguage, type Language } from "@/lib/i18n";
import { getAvatarColor, getInitials, type Item, type Charge, type Participant, type Assignment } from "@/lib/billEngine";

export default function SessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const sessionId = params.sessionId as string;
  const ownerToken = searchParams.get("owner");

  const [step, setStep] = useState(1);
  const [lang, setLang] = useState<Language>("es");
  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  const {
    session,
    loading,
    error,
    isOwner,
    currentParticipant,
    join,
    addParticipant,
    removeParticipantById,
    updateParticipantName,
    updateAssignmentQty,
    addNewItem,
    updateItemById,
    deleteItemById,
    updateSessionCharges,
    updateOriginalSubtotal,
    updateOriginalTotal,
    finalize,
    markInteraction,
  } = useSession({
    sessionId,
    ownerToken,
    pollInterval: 5000,
    interactionPause: 15000,
  });

  // Detect language
  useEffect(() => {
    setLang(detectLanguage());
  }, []);

  // Auto-advance to step 3 if finalized
  useEffect(() => {
    if (session?.status === "finalized") {
      setStep(3);
    }
  }, [session?.status]);

  const t = getTranslator(lang);

  // Convert API types to billEngine types
  const items: Item[] = (session?.items || []).map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    price_as_shown: item.price_as_shown,
    quantity: item.quantity,
    mode: item.mode,
  }));

  const priceMode = session?.price_mode || "unitario";

  const charges: Charge[] = (session?.charges || []).map((c) => ({
    id: c.id,
    name: c.name,
    value: c.value,
    valueType: c.valueType,
    isDiscount: c.isDiscount,
    distribution: c.distribution,
  }));

  const participants: Participant[] = (session?.participants || []).map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
  }));

  const assignments: Record<string, Assignment[]> = session?.assignments || {};

  // --- Handlers ---

  const handleJoin = async () => {
    if (!joinName.trim()) return;
    setJoining(true);
    await join(joinName.trim());
    setJoining(false);
  };

  const handleAddParticipant = () => {
    if (!newParticipantName.trim()) return;
    const name = newParticipantName.trim();
    // Close form immediately - optimistic update in useSession handles the rest
    setNewParticipantName("");
    setShowAddParticipant(false);
    // Fire and forget - useSession has optimistic update
    addParticipant(name);
  };

  const handleItemsChange = async (newItems: Item[]) => {
    markInteraction();
    // Find what changed
    for (const newItem of newItems) {
      const oldItem = items.find((i) => i.id === newItem.id);
      if (!oldItem) {
        // New item
        await addNewItem(newItem.name, newItem.price, newItem.quantity);
      } else if (
        oldItem.name !== newItem.name ||
        oldItem.price !== newItem.price ||
        oldItem.quantity !== newItem.quantity
      ) {
        // Updated item
        await updateItemById(newItem.id!, {
          name: newItem.name,
          price: newItem.price,
          quantity: newItem.quantity,
        });
      }
    }

    // Check for deleted items
    for (const oldItem of items) {
      if (!newItems.find((i) => i.id === oldItem.id)) {
        await deleteItemById(oldItem.id!);
      }
    }
  };

  const handleChargesChange = async (newCharges: Charge[]) => {
    markInteraction();
    await updateSessionCharges(
      newCharges.map((c) => ({
        id: c.id,
        name: c.name,
        value: c.value,
        valueType: c.valueType,
        isDiscount: c.isDiscount,
        distribution: c.distribution || "proportional",
      }))
    );
  };


  const handleFinalize = async () => {
    await finalize();
    setStep(3);
    window.scrollTo(0, 0);
  };

  const goToStep = (newStep: number) => {
    setStep(newStep);
    window.scrollTo(0, 0);
  };

  // --- Render States ---

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-destructive text-lg mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>Reintentar</Button>
        </div>
      </div>
    );
  }

  // Need to join (not owner and no current participant)
  if (!isOwner && !currentParticipant) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-2">Bill-e</h1>
            <p className="text-muted-foreground">Únete a la sesión</p>
          </div>

          <div className="bg-card rounded-2xl p-6 border border-border">
            <label className="block text-sm font-medium mb-2">Tu nombre</label>
            <input
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="Ej: Carlos"
              className="w-full px-4 py-3 bg-secondary rounded-xl text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary mb-4"
              autoFocus
            />
            <Button
              onClick={handleJoin}
              disabled={!joinName.trim() || joining}
              className="w-full h-12 font-semibold"
            >
              {joining ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Unirme"
              )}
            </Button>
          </div>

          {/* Show who's already in */}
          {participants.length > 0 && (
            <div className="mt-6">
              <p className="text-sm text-muted-foreground text-center mb-3">
                Ya están en la sesión:
              </p>
              <div className="flex justify-center gap-2 flex-wrap">
                {participants.map((p, pIndex) => (
                  <div key={p.id} className="participant-chip">
                    <div
                      className="participant-avatar"
                      style={{ backgroundColor: getAvatarColor(p.name, pIndex) }}
                    >
                      {getInitials(p.name)}
                    </div>
                    <span className="participant-name">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Main Session View ---

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">Bill-e</h1>
              {isOwner && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                  Host
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Current user */}
              {currentParticipant && (
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: getAvatarColor(currentParticipant.name, participants.findIndex(p => p.id === currentParticipant.id)) }}
                  >
                    {getInitials(currentParticipant.name)}
                  </div>
                  {editingName ? (
                    <input
                      type="text"
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      onBlur={() => {
                        if (editNameValue.trim() && editNameValue.trim() !== currentParticipant.name) {
                          updateParticipantName(currentParticipant.id, editNameValue.trim());
                        }
                        setEditingName(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (editNameValue.trim() && editNameValue.trim() !== currentParticipant.name) {
                            updateParticipantName(currentParticipant.id, editNameValue.trim());
                          }
                          setEditingName(false);
                        } else if (e.key === "Escape") {
                          setEditingName(false);
                        }
                      }}
                      className="text-sm text-muted-foreground bg-transparent border-b border-primary outline-none w-20"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setEditNameValue(currentParticipant.name);
                        setEditingName(true);
                      }}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {currentParticipant.name}
                    </button>
                  )}
                </div>
              )}

              {/* Language Toggle */}
              <button
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setLang(lang === "es" ? "en" : "es")}
              >
                {lang === "es" ? "EN" : "ES"}
              </button>
            </div>
          </div>

          {/* Step Indicator */}
          <div className="step-indicator mt-3">
            {[1, 2, 3].map((s) => (
              <button
                key={s}
                className={`step-dot ${s === step ? "active" : "inactive"}`}
                onClick={() => s <= step && goToStep(s)}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-6">
        {/* Step 1: Review (only for owner) */}
        {step === 1 && isOwner && (
          <StepReview
            items={items}
            charges={charges}
            originalSubtotal={session?.subtotal}
            originalTotal={session?.total}
            priceMode={priceMode}
            onOriginalSubtotalChange={updateOriginalSubtotal}
            onOriginalTotalChange={updateOriginalTotal}
            onItemsChange={handleItemsChange}
            onChargesChange={handleChargesChange}
            onNext={() => goToStep(2)}
            t={t}
          />
        )}

        {/* Step 1: Waiting (for participants) */}
        {step === 1 && !isOwner && (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">
              Esperando a que el host verifique la cuenta...
            </p>
            <Button variant="outline" className="mt-6" onClick={() => goToStep(2)}>
              Ir a asignar items
            </Button>
          </div>
        )}

        {/* Step 2: Assign */}
        {step === 2 && (
          <StepAssign
            items={items}
            participants={participants}
            assignments={assignments}
            onUpdateQty={updateAssignmentQty}
            onBack={() => goToStep(1)}
            onNext={isOwner ? handleFinalize : () => goToStep(3)}
            t={t}
            isOwner={isOwner}
            showAddParticipant={showAddParticipant}
            newParticipantName={newParticipantName}
            onNewParticipantNameChange={setNewParticipantName}
            onAddParticipant={handleAddParticipant}
            onToggleAddParticipant={setShowAddParticipant}
            onRemoveParticipant={removeParticipantById}
            currentParticipantId={currentParticipant?.id}
            onUpdateParticipantName={updateParticipantName}
          />
        )}

        {/* Step 3: Share */}
        {step === 3 && (
          <StepShare
            items={items}
            charges={charges}
            participants={participants}
            assignments={assignments}
            onBack={() => goToStep(2)}
            t={t}
          />
        )}
      </main>
    </div>
  );
}
