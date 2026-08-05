export type UnsavedChangesConfirmationHandlers = {
  leave(): void;
  stay(): void;
};

export type UnsavedChangesNavigationGuardOptions<Action> = {
  dispatch(action: Action): void;
  getHasSaved(): boolean;
  getIsDirty(): boolean;
  getIsSaving(): boolean;
  getIsMounted(): boolean;
  onBeforeConfirmation?(): void;
  onDiscard?(): void;
  onStay?(): void;
  requestConfirmation(handlers: UnsavedChangesConfirmationHandlers): void;
};

export type UnsavedChangesNavigationGuard<Action> = {
  cleanup(): void;
  handleBeforeRemove(action: Action, preventDefault: () => void): boolean;
  handlePreventedAction(action: Action): boolean;
  isConfirmationOpen(): boolean;
};

export function createUnsavedChangesNavigationGuard<Action>({
  dispatch,
  getHasSaved,
  getIsDirty,
  getIsMounted,
  getIsSaving,
  onBeforeConfirmation,
  onDiscard,
  onStay,
  requestConfirmation,
}: UnsavedChangesNavigationGuardOptions<Action>): UnsavedChangesNavigationGuard<Action> {
  let allowNextRemoval = false;
  let confirmationOpen = false;
  let leaving = false;
  let pendingAction: Action | null = null;

  function resetConfirmation() {
    confirmationOpen = false;
    leaving = false;
    pendingAction = null;
  }

  function shouldPreventRemoval() {
    return (
      getIsMounted() &&
      !allowNextRemoval &&
      getIsDirty() &&
      !getIsSaving() &&
      !getHasSaved()
    );
  }

  function handlePreventedAction(action: Action) {
    if (!shouldPreventRemoval()) return false;

    if (confirmationOpen) return true;

    onBeforeConfirmation?.();
    pendingAction = action;
    confirmationOpen = true;
    leaving = false;

    requestConfirmation({
      leave() {
        if (leaving) return;
        leaving = true;

        if (!getIsMounted()) {
          resetConfirmation();
          return;
        }

        const actionToDispatch = pendingAction;
        confirmationOpen = false;
        pendingAction = null;

        if (!actionToDispatch) {
          leaving = false;
          return;
        }

        allowNextRemoval = true;
        onDiscard?.();
        dispatch(actionToDispatch);
      },
      stay() {
        if (leaving) return;
        if (!confirmationOpen && !pendingAction) return;
        resetConfirmation();
        allowNextRemoval = false;
        onStay?.();
      },
    });

    return true;
  }

  return {
    cleanup() {
      resetConfirmation();
      allowNextRemoval = false;
    },
    handleBeforeRemove(action, preventDefault) {
      if (!shouldPreventRemoval()) return false;

      preventDefault();
      return handlePreventedAction(action);
    },
    handlePreventedAction,
    isConfirmationOpen() {
      return confirmationOpen;
    },
  };
}
