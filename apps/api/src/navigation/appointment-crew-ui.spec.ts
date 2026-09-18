import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('appointment crew mobile UI contracts', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');
  const mobileSource = (screen: string) =>
    readFileSync(
      join(repoRoot, 'apps', 'mobile', 'src', 'screens', screen),
      'utf8',
    );

  it('keeps single selection as the default and requires two crew members before save', () => {
    const form = mobileSource('AppointmentFormScreen.tsx');
    expect(form).toContain('useState(false)');
    expect(form).toContain('Multiple technicians required');
    expect(form).toContain(
      'multipleTechniciansRequired && technicianIds.length < 2',
    );
    expect(form).toContain(
      'technicianIds: multipleTechniciansRequired ? technicianIds : undefined',
    );
    expect(form).toContain('selectedCrew.map((member) => member.name).join');
  });

  it('allows crew management while enforcing the two-person minimum', () => {
    const reassign = mobileSource('AppointmentReassignScreen.tsx');
    const details = mobileSource('AppointmentDetailsScreen.tsx');
    expect(details).toContain('Manage Technicians');
    expect(reassign).toContain('selectedTechnicianIds.length < 2');
    expect(reassign).toContain('setSelectedTechnicianIds((ids) =>');
    expect(reassign).toContain('technicianIds: multipleTechniciansRequired');
  });

  it('renders crew names and completion snapshots on appointment and job details', () => {
    const appointment = mobileSource('AppointmentDetailsScreen.tsx');
    const job = mobileSource('JobDetailsScreen.tsx');
    expect(appointment).toContain('appointment.completionCrew');
    expect(job).toContain('appointment.completionCrew');
    expect(job).toContain('getAppointmentTechnicianNames(appointment)');
  });
});
