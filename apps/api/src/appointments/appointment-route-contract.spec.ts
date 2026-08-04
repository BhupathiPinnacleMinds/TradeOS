import {
  APPOINTMENT_TRANSITION_ROUTE_SEGMENTS,
  buildAppointmentTransitionPath,
  type AppointmentTransitionAction,
} from '@tradieos/shared';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('appointment route contract', () => {
  function readFilesRecursively(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        return readFilesRecursively(path);
      }
      return stat.isFile() && /\.(ts|tsx)$/.test(entry) ? [path] : [];
    });
  }

  const transitions: Array<{
    action: AppointmentTransitionAction;
    controllerDecorator: string;
    method: 'POST';
    path: string;
    serviceMethod: string;
    expectedStatuses: string;
  }> = [
    {
      action: 'confirm',
      controllerDecorator: "@Post(':id/confirm')",
      expectedStatuses: 'SCHEDULED -> CONFIRMED',
      method: 'POST',
      path: '/appointments/appointment-1/confirm',
      serviceMethod: "appointments.transition(currentUser, id, 'CONFIRMED')",
    },
    {
      action: 'start-travel',
      controllerDecorator: "@Post(':id/start-travel')",
      expectedStatuses: 'CONFIRMED -> ON_THE_WAY',
      method: 'POST',
      path: '/appointments/appointment-1/start-travel',
      serviceMethod: "appointments.transition(currentUser, id, 'ON_THE_WAY')",
    },
    {
      action: 'arrive',
      controllerDecorator: "@Post(':id/arrive')",
      expectedStatuses: 'ON_THE_WAY -> ARRIVED',
      method: 'POST',
      path: '/appointments/appointment-1/arrive',
      serviceMethod: "appointments.transition(currentUser, id, 'ARRIVED')",
    },
    {
      action: 'start',
      controllerDecorator: "@Post(':id/start')",
      expectedStatuses: 'ARRIVED -> IN_PROGRESS',
      method: 'POST',
      path: '/appointments/appointment-1/start',
      serviceMethod: "appointments.transition(currentUser, id, 'IN_PROGRESS')",
    },
    {
      action: 'pause',
      controllerDecorator: "@Post(':id/pause')",
      expectedStatuses: 'IN_PROGRESS -> PAUSED',
      method: 'POST',
      path: '/appointments/appointment-1/pause',
      serviceMethod: "appointments.transition(currentUser, id, 'PAUSED')",
    },
    {
      action: 'resume',
      controllerDecorator: "@Post(':id/resume')",
      expectedStatuses: 'PAUSED -> IN_PROGRESS',
      method: 'POST',
      path: '/appointments/appointment-1/resume',
      serviceMethod: "appointments.transition(currentUser, id, 'IN_PROGRESS')",
    },
    {
      action: 'complete',
      controllerDecorator: "@Post(':id/complete')",
      expectedStatuses: 'IN_PROGRESS -> COMPLETED',
      method: 'POST',
      path: '/appointments/appointment-1/complete',
      serviceMethod: 'appointments.completeWithWorkLog(currentUser, id, dto)',
    },
    {
      action: 'cancel',
      controllerDecorator: "@Post(':id/cancel')",
      expectedStatuses: 'Non-terminal -> CANCELLED',
      method: 'POST',
      path: '/appointments/appointment-1/cancel',
      serviceMethod: "appointments.transition(currentUser, id, 'CANCELLED')",
    },
  ];

  it.each(transitions)(
    'maps mobile action $action to the registered API route',
    ({ action, path }) => {
      expect(buildAppointmentTransitionPath('appointment-1', action)).toBe(
        path,
      );
      expect(APPOINTMENT_TRANSITION_ROUTE_SEGMENTS[action]).toBe(
        path.split('/').at(-1),
      );
    },
  );

  it('documents every appointment mutation route used by mobile', () => {
    expect(transitions).toMatchInlineSnapshot(`
      [
        {
          "action": "confirm",
          "controllerDecorator": "@Post(':id/confirm')",
          "expectedStatuses": "SCHEDULED -> CONFIRMED",
          "method": "POST",
          "path": "/appointments/appointment-1/confirm",
          "serviceMethod": "appointments.transition(currentUser, id, 'CONFIRMED')",
        },
        {
          "action": "start-travel",
          "controllerDecorator": "@Post(':id/start-travel')",
          "expectedStatuses": "CONFIRMED -> ON_THE_WAY",
          "method": "POST",
          "path": "/appointments/appointment-1/start-travel",
          "serviceMethod": "appointments.transition(currentUser, id, 'ON_THE_WAY')",
        },
        {
          "action": "arrive",
          "controllerDecorator": "@Post(':id/arrive')",
          "expectedStatuses": "ON_THE_WAY -> ARRIVED",
          "method": "POST",
          "path": "/appointments/appointment-1/arrive",
          "serviceMethod": "appointments.transition(currentUser, id, 'ARRIVED')",
        },
        {
          "action": "start",
          "controllerDecorator": "@Post(':id/start')",
          "expectedStatuses": "ARRIVED -> IN_PROGRESS",
          "method": "POST",
          "path": "/appointments/appointment-1/start",
          "serviceMethod": "appointments.transition(currentUser, id, 'IN_PROGRESS')",
        },
        {
          "action": "pause",
          "controllerDecorator": "@Post(':id/pause')",
          "expectedStatuses": "IN_PROGRESS -> PAUSED",
          "method": "POST",
          "path": "/appointments/appointment-1/pause",
          "serviceMethod": "appointments.transition(currentUser, id, 'PAUSED')",
        },
        {
          "action": "resume",
          "controllerDecorator": "@Post(':id/resume')",
          "expectedStatuses": "PAUSED -> IN_PROGRESS",
          "method": "POST",
          "path": "/appointments/appointment-1/resume",
          "serviceMethod": "appointments.transition(currentUser, id, 'IN_PROGRESS')",
        },
        {
          "action": "complete",
          "controllerDecorator": "@Post(':id/complete')",
          "expectedStatuses": "IN_PROGRESS -> COMPLETED",
          "method": "POST",
          "path": "/appointments/appointment-1/complete",
          "serviceMethod": "appointments.completeWithWorkLog(currentUser, id, dto)",
        },
        {
          "action": "cancel",
          "controllerDecorator": "@Post(':id/cancel')",
          "expectedStatuses": "Non-terminal -> CANCELLED",
          "method": "POST",
          "path": "/appointments/appointment-1/cancel",
          "serviceMethod": "appointments.transition(currentUser, id, 'CANCELLED')",
        },
      ]
    `);
  });

  it('keeps mobile runtime free of hard-coded demo appointment fixtures', () => {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const mobileSource = join(repoRoot, 'apps', 'mobile', 'src');
    const suspiciousPatterns = [
      /demo-appointment-/,
      /demoAppointments/,
      /mockAppointments/,
      /fallbackAppointments/,
      /fixtureAppointments/,
      /sampleAppointments/,
    ];

    const matches = readFilesRecursively(mobileSource).flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      return suspiciousPatterns
        .filter((pattern) => pattern.test(content))
        .map((pattern) => `${file}: ${pattern}`);
    });

    expect(matches).toEqual([]);
  });
});
