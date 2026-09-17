import { formatAppointmentLocation } from '../../../mobile/src/utils/appointmentLocation';

describe('New Appointment location preview', () => {
  const emptyAddress = {
    accessInstructions: '',
    addressLine1: '',
    addressLine2: '',
    postcode: '',
    state: 'NSW' as const,
    suburb: '',
  };

  it('does not accept a default state alone as a selected location', () => {
    expect(formatAppointmentLocation(emptyAddress)).toBe('');
  });

  it('shows only a complete address from the current customer draft', () => {
    expect(
      formatAppointmentLocation({
        ...emptyAddress,
        addressLine1: '1 Crilly Street',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      }),
    ).toBe('1 Crilly Street, Tarneit, VIC, 3029');
  });

  it('rejects placeholder and incomplete addresses', () => {
    expect(
      formatAppointmentLocation({
        ...emptyAddress,
        addressLine1: 'Address to be confirmed',
        postcode: '3029',
        state: 'VIC',
        suburb: 'Tarneit',
      }),
    ).toBe('');
    expect(
      formatAppointmentLocation({
        ...emptyAddress,
        addressLine1: '1 Crilly Street',
        postcode: '0000',
        suburb: 'Tarneit',
      }),
    ).toBe('');
  });
});
