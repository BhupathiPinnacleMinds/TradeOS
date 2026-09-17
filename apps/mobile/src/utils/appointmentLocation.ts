import type { AustralianState } from '@tradieos/shared';
import { AUSTRALIAN_STATES } from '@tradieos/shared';

export type ResolvedLocation = {
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: AustralianState | '';
  postcode: string;
  accessInstructions: string;
};

export function isPlaceholderAddressText(value?: string | null) {
  const text = value?.trim().toLowerCase() ?? '';
  return text === 'address to be confirmed' || text === 'to be confirmed';
}

export function formatAppointmentLocation(location: ResolvedLocation) {
  if (
    !location.addressLine1.trim() ||
    isPlaceholderAddressText(location.addressLine1) ||
    !location.suburb.trim() ||
    !AUSTRALIAN_STATES.includes(location.state as AustralianState) ||
    !/^\d{4}$/.test(location.postcode.trim()) ||
    location.postcode.trim() === '0000'
  ) {
    return '';
  }
  return [
    location.addressLine1,
    location.addressLine2,
    location.suburb,
    location.state,
    location.postcode,
  ]
    .filter(Boolean)
    .join(', ');
}
