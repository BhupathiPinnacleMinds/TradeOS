export const TORI_EXTERNAL_ACTIONS = [
  'SEND_SMS',
  'SEND_EMAIL',
  'SEND_QUOTE',
  'SEND_INVOICE',
] as const;

export type ToriExternalAction = (typeof TORI_EXTERNAL_ACTIONS)[number];
export type ToriActionStatus =
  | 'DRAFT'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED';

export interface ToriActionDraft<TPayload = Record<string, unknown>> {
  id: string;
  businessId: string;
  conversationId: string;
  action: ToriExternalAction;
  status: 'DRAFT' | 'AWAITING_CONFIRMATION';
  payload: TPayload;
  createdAt: string;
}

export interface ConfirmToriActionRequest {
  actionId: string;
  confirmed: true;
}
